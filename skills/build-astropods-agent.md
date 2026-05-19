---
name: build-astropods-agent
description: Recipes for building an AI agent for the Astropods platform.
---

# build-astropods-agent — recipes for building a Mastra + Astropods agent

Use this skill when the user asks how to build, extend, or troubleshoot an
agent on the Astropods platform.

Be concise. Lead with the answer and the file/symbol to change. Only quote
sections of this skill that are directly relevant to the question.

---

## 1. Project skeleton

`ast create` scaffolds:

```
myagent/
├── agent/index.ts          # entry point: Mastra agent + serve()
├── astropods.yml           # spec — declares interfaces, models, knowledge, inputs
├── Dockerfile              # bun:1 base, copies agent/ and skills/
├── package.json            # bun + @mastra/* + @astropods/*
├── tsconfig.json
└── AGENT.md, AGENTS.md, CLAUDE.md, README.md
```

The built-in runtimes are either generated in Python or Bun. This skill is focused
on Bun using Mastra for the agent framework.

## 2. astropods.yml essentials

Validate every change with `ast spec validate`. The full schema lives at
<https://astropods.com/schema/package.json>.

```yaml
# yaml-language-server: $schema=https://astropods.com/schema/package.json
spec: package/v1
name: myagent

agent:
  build: { context: ., dockerfile: Dockerfile }
  interfaces:
    messaging: true       # gRPC sidecar; required for chat / cron
    frontend: true        # optional, if present agent must EXPOSE 80 and serve port 80
  inputs:
    - name: MY_API_KEY
      datatype: string
      secret: true
      description: ...

models:
  anthropic:
    provider: anthropic   # injects ANTHROPIC_API_KEY

knowledge:
  cache:
    provider: redis       # built-in providers: qdrant, redis, postgres, neo4j

dev:
  interfaces:
    messaging:
      adapters: [web, slack]
      slack: { socket_mode: true, auto_thread: true }
    frontend: { port: 80 }
```

Pitfalls:

- `agent.interfaces.frontend: true` requires the container to bind port 80.
  In production the platform always routes to 80; only override locally with
  `dev.interfaces.frontend.port`.
- `interfaces:` MUST be nested under `agent:`. Top-level placement is
  silently ignored.

## 3. Knowledge stores (Redis, Postgres, Qdrant, …)

**Built-in provider** (preferred):

```yaml
knowledge:
  cache: { provider: redis }
```

Injects `REDIS_HOST`, `REDIS_PORT`, **`REDIS_URL`** into the agent
container. The platform also provisions a persistent volume automatically.

**Custom container** (use when no built-in fits):

```yaml
knowledge:
  qdrant:
    container:
      image: qdrant/qdrant:latest
      port: 6333
      volume: /qdrant/storage
```

Custom containers inject `KNOWLEDGE_{NAME}_HOST` / `KNOWLEDGE_{NAME}_PORT`
— **no `_URL`** — and you must declare the volume yourself. The naming
difference is the single biggest gotcha when an agent fails to connect.

For Postgres specifically: always read all five env vars (`POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).
`POSTGRES_URL` is also injected but isn't reliable with every client.

## 4. The Mastra agent + serve() wiring

```ts
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';
import { MastraAdapter } from '@astropods/adapter-mastra';
import { serve } from '@astropods/adapter-core';

const memory = new Memory({ storage: new LibSQLStore({ id: 'memory', url: ':memory:' }) });

const agent = new Agent({
  id: 'myagent',
  name: 'MyAgent',
  instructions: () => renderInstructions(),  // function = dynamic system prompt
  model: 'anthropic/claude-sonnet-4-5',
  memory,
  tools: { my_tool: myTool },
  defaultOptions: {
    tracingOptions: {
      tags: ['astro', 'agent:myagent'],
      metadata: { agent_id: 'myagent' },
    },
  },
});

// Construct Mastra even if you call serve() directly — the constructor
// registers agents/observability plugins at startup.
new Mastra({ agents: { myagent: agent }, observability });

serve(new MastraAdapter(agent));
```

`instructions` can be `string | (() => string | Promise<string>)`. Use the
function form when the prompt needs to reflect mutable state (loaded skills,
current user, schedule list).

## 5. Tools (Mastra)

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const myTool = createTool({
  id: 'my_tool',
  description: 'Plain-language description the LLM uses to decide when to call this.',
  inputSchema: z.object({
    name: z.string().describe('Per-argument description shown to the LLM.'),
  }),
  execute: async ({ context }) => {
    // context = the parsed input
    return { ok: true, result: '...' };
  },
});
```

Patterns that work:

- **Returning context, not side-effects.** A tool that returns the matching
  skill's markdown content (so the LLM applies it in the next turn) is
  cheaper and more debuggable than a tool that nests another LLM call.
- **Tool name routing.** Expose one tool per addressable capability; let the
  LLM pick based on the description. Keep descriptions LLM-readable.

## 6. The AgentAdapter wrapping pattern

Wrap `MastraAdapter` (or any `AgentAdapter`) to add cross-cutting behavior
— slash-command parsing, auth gates, prompt rewriting, conversation context:

```ts
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';

export class MyWrapper implements AgentAdapter {
  readonly name: string;
  constructor(private readonly inner: AgentAdapter) {
    this.name = inner.name;
    if (inner.streamAudio) this.streamAudio = inner.streamAudio.bind(inner);
  }
  streamAudio?: AgentAdapter['streamAudio'];

  async stream(prompt: string, hooks: StreamHooks, options: StreamOptions) {
    // Short-circuit: hooks.onChunk('...'); hooks.onFinish(); return;
    // Pass through with transformation:
    return this.inner.stream(transform(prompt), hooks, options);
  }

  getConfig() { return this.inner.getConfig(); }
}

serve(new MyWrapper(new MastraAdapter(agent)));
```

`options.conversationId` and `options.userId` give you the per-message
context. To carry that into downstream code (e.g. Mastra tools), use
`AsyncLocalStorage` — Mastra runs the tool inside the same async context as
the wrapping adapter call.

## 7. Programmatic invocation: triggering the agent from your own code

Three patterns, depending on what you need to do.

### 7A. In-process invocation (cron, webhooks, scheduled jobs)

**Call `agent.generate()` directly** on the Mastra agent. No messaging-
service round-trip; you stay inside the Mastra pipeline (memory, tools,
tracing) and get the response synchronously.

```ts
import type { Agent } from '@mastra/core/agent';

async function invoke(agent: Agent, prompt: string, convId: string) {
  const result = await agent.generate(prompt, {
    memory: { thread: convId, resource: 'system' },
  });
  return result.text;
}
```

### 7B. Proactive push to a platform adapter (Slack, etc.)

Open a long-lived bidi conversation stream and send an `AgentResponse`
whose `conversationId` matches the target adapter's expected format. The
messaging service broadcasts AgentResponses with unmatched conversation
ids to all registered adapters; the adapter recognising the format
accepts and delivers.

```ts
import { MessagingClient, type ConversationStream } from '@astropods/messaging';

const client = new MessagingClient(process.env.GRPC_SERVER_ADDR || 'localhost:9090');
const ready = client.connectWithRetry({ initialDelayMs: 500, maxDelayMs: 10_000, jitter: true });

let conv: ConversationStream | null = null;
ready.then(() => {
  conv = client.createConversationStream();
  conv.on('error', (e) => console.error('bidi stream error', e));
});

function postToSlack(channelId: string, body: string) {
  if (!conv) return;                                          // still connecting
  conv.sendAgentResponse({ conversationId: channelId, content: { type: 'REPLACE', content: body } });
  conv.sendAgentResponse({ conversationId: channelId, content: { type: 'END', content: '' } });
}
```

`REPLACE` sets the buffer, `END` is what actually triggers the adapter
post. See section 8 for the Slack-specific details.

### 7C. Avoid: `MessagingClient.processMessage()`

`processMessage` is a server-streaming RPC. It does **not** route to
bidi-connected agents the way Slack/web ingress does. Synthetic messages
dispatched this way produce empty 2–4 ms turnarounds (the agent never
processes them) and any "wait for response on our bidi stream" pattern
hangs indefinitely (verified to time out at whatever your client TTL is).
The symptom is a successful return from `processMessage` with zero
`'response'` events and a `'end'` event firing immediately.

Use 7A for invocation; use 7B for outbound delivery.

### Boot ordering

Don't `await connect()` in your boot path. Connect with retry in the
background and gate per-call with `await ready`. Otherwise a slow
messaging sidecar will hang the entire agent (frontend, chat,
everything).

## 8. The Slack adapter

The platform ships a `slack` messaging adapter that handles both ingress
(Slack → agent) and egress (agent → Slack channel). Use it instead of
writing Slack Web API code.

```yaml
agent:
  interfaces: { messaging: true }
dev:
  interfaces:
    messaging:
      adapters: [web, slack]
      slack:
        socket_mode: true       # avoids configuring webhooks for local dev
        auto_thread: true       # thread bot replies under the user message
        # optional ingress filters:
        # actionable_reactions: [ticket]
        # allowed_channel_ids: [C0123, C0456]
        # allowed_user_ids: [U0789]
```

Bot credentials (bot token, app token for socket mode, signing secret) are
managed by the platform — set via `ast project configure` and injected
into the messaging sidecar, **not** into your agent container. **Never
declare your own `SLACK_BOT_TOKEN` input** when you're using the adapter.

### Egress: posting from the agent to a Slack channel

Use the proactive-AgentResponse pattern (section 7B). The Slack adapter
accepts AgentResponses whose `conversationId` matches its format:

- `C0123456789` → posts top-level to channel `C0123456789`
- `C0123456789-1726000000.123456` → posts as a reply in that Slack
  thread (`<channel-id>-<thread_ts>`)
- `REPLACE` sets the message body; `END` triggers the post

```ts
// Cron-fired post:
conv.sendAgentResponse({
  conversationId: process.env.SLACK_CHANNEL!,         // e.g. 'C0123456789'
  content: { type: 'REPLACE', content: output },
});
conv.sendAgentResponse({
  conversationId: process.env.SLACK_CHANNEL!,
  content: { type: 'END', content: '' },
});
```

### Caveats (these will burn you)

- **Use the channel ID, not the name.** Right-click the channel → View
  channel details → ID is at the bottom of the modal. IDs start with
  `C` (public), `G` (private), or `D` (DM).
- **The bot must be a member of the channel.** Slack's `chat.postMessage`
  to a channel where the bot isn't a member returns `not_in_channel` and
  the post is silently dropped — no error surfaces to your code. Run
  `/invite @<botname>` in the channel first, or DM the bot
  (`D…` channels always work).
- **Don't tag your inbound Message with `platform: 'slack'`.** That
  does not coerce the adapter into posting; egress only happens for
  AgentResponses (section 7B) whose `conversationId` matches.
- **Smoke-test the egress at boot.** Send a one-shot "online" message
  after the bidi stream opens but before the first cron tick. If that
  doesn't land in the channel, neither will any cron post — usually
  bot-not-in-channel.

### Bidirectional bonus

Declaring the Slack adapter means Slack users can also `@<bot>` or DM
the agent in any channel where the bot is installed, using the same
dispatch logic (slash routing, run_skill tool) as the web playground —
no extra code.

## 9. Cron jobs

Use `node-cron` (small, works on Bun). Always:

1. Validate every expression with `cron.validate(expr)` before scheduling.
2. Skip overlapping runs with a `Set<string>` keyed by job name.
3. **Invoke the agent in-process via `agent.generate()`** (section 7A) —
   NOT through `MessagingClient.processMessage` (section 7C explains why).
4. If you want results in Slack, push them via section 7B / 8 after the
   `agent.generate()` resolves.
5. Catch + log failures; don't let them crash the process.

```ts
import cron from 'node-cron';
import type { Agent } from '@mastra/core/agent';

const running = new Set<string>();

async function run(agent: Agent, name: string, prompt: string) {
  if (running.has(name)) return;
  running.add(name);
  try {
    const result = await agent.generate(prompt, {
      memory: { thread: `cron:${name}:${Date.now()}`, resource: 'cron-scheduler' },
    });
    console.log(`[cron] ${name}:`, result.text);
    // Optional: push to Slack via the bidi stream (section 7B)
  } catch (e) {
    console.error(`[cron] ${name} failed:`, e);
  } finally {
    running.delete(name);
  }
}

if (cron.validate(expr)) {
  cron.schedule(expr, () => { void run(agent, name, prompt); });
}
```

**Pass the agent into the scheduler module.** `initScheduler(agent)`
must be called after the agent is constructed; otherwise the closure
holds `null`. See section 14.

JSDoc pitfall: a comment containing `*/` (common in cron examples like
`*/15 * * * *`) closes the block comment prematurely and breaks parsing.
Use `// line comments` for any docstring that mentions cron expressions.

## 10. Memory TTL for synthetic conversations

Each `agent.generate()` call with a fresh `conversationId` creates a new
thread in Mastra's `LibSQLStore`. With cron firing every minute, the
in-memory store grows forever. Mastra has no built-in TTL — prune
explicitly.

Pattern:

```ts
const CRON_RESOURCE_ID = 'cron-scheduler';        // shared resourceId for filtering
const CRON_THREAD_PREFIX = 'cron:';               // for parsing timestamps

// When invoking:
await agent.generate(prompt, {
  memory: {
    thread: `${CRON_THREAD_PREFIX}${name}:${Date.now()}`,
    resource: CRON_RESOURCE_ID,
  },
});

// Periodic sweep:
setInterval(async () => {
  const { threads } = await memory.listThreads({
    filter: { resourceId: CRON_RESOURCE_ID }, perPage: false,
  });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const t of threads) {
    const ts = Number(t.id.split(':').pop());
    if (Number.isFinite(ts) && ts < cutoff) await memory.deleteThread(t.id);
  }
}, 60 * 60 * 1000).unref();
```

Setting `memory.resource` to a constant for synthetic invocations gives
you a clean filter for cleanup — `memory.listThreads({ filter: { resourceId } })`
finds all your cron threads and nothing else. Encoding the timestamp in
the thread id (`cron:<name>:<ts>`) lets you age them without reading
each thread's metadata.

## 11. OpenTelemetry tracing

```ts
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';

function resolveOtlpEndpoint(): string {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  try {
    const u = new URL(raw);
    if (!u.pathname || u.pathname === '/') u.pathname = '/v1/traces';
    return u.toString();
  } catch {
    return `${raw.replace(/\/+$/, '')}/v1/traces`;
  }
}

const observability = new Observability({
  configs: {
    otel: {
      serviceName: 'myagent',
      exporters: [new OtelExporter({
        provider: { custom: { endpoint: resolveOtlpEndpoint(), protocol: 'http/protobuf' } },
      })],
    },
  },
});

new Mastra({ agents: { myagent: agent }, observability });
```

Stable per-span tags via `agent.defaultOptions.tracingOptions` make traces
filterable in Jaeger/Tempo/Honeycomb without extra instrumentation.

## 12. Frontend agents (admin UIs, auth gates)

```ts
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const SESSION_TTL = 8 * 60 * 60;
const cookieSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

function sign(expiresAt: number): string {
  const payload = `admin.${expiresAt}`;
  const mac = createHmac('sha256', cookieSecret).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

// constant-time password compare:
function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

Bun.serve({ port: 80, fetch: handle });
```

Production filesystem is **read-only**. Pre-create any writable paths in
the Dockerfile (`RUN touch ./backend/.env && mkdir -p ./writable-dir`).

## 13. Quick commands

```
ast spec validate                 # check astropods.yml
ast project configure             # set env vars / secrets
ast project start                 # boot the local stack (agent + sidecars)
ast project logs                  # tail container logs
ast project stop                  # tear down
ast docs                          # the canonical platform docs
```

The playground is at <http://localhost:3100>. The agent's own frontend (if
declared) is at the URL `ast project start` prints.
