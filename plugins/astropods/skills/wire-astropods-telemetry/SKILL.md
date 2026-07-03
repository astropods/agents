---
description: Wire up an Astropods adapter on an existing agent so the platform can record OpenTelemetry traces and metrics from runs.
---

# Wire Astropods Telemetry

Use this skill when an agent already runs on Astropods (has `astropods.yml` and a `Dockerfile`) but is missing the framework adapter that publishes OpenTelemetry traces back to the platform. Without the adapter, the agent works but the platform records no run-level telemetry.

If the project does not yet adopt Astropods at all, start with [`migrate-to-astropods`](../migrate-to-astropods/SKILL.md) first, then return here.

Confirm the plan before performing any actions.

---

## When this applies

- `astropods.yml` exists and the agent builds/runs under `ast project start`, **but**
- The entry point still calls the framework directly (`agent.invoke(...)`, `mastra.getAgent(...).stream(...)`, etc.) instead of an Astropods adapter's `serve()`.
- The platform's run/trace views are empty even though the agent responds.

Supported frameworks today: **LangChain (Python)** and **Mastra (TypeScript)**. For other frameworks, telemetry must be emitted manually via the OTEL SDK using `OTEL_EXPORTER_OTLP_ENDPOINT` (injected by the runner)—see [Manual instrumentation](#manual-instrumentation). The same applies to a **frontend agent** that serves its own HTTP surface (`interfaces.frontend: true`, no messaging sidecar, hence no `serve()`): its OTEL SDK is the entire telemetry path.

---

## Steps

### 1. Identify the framework and entry point

Find the current entry point — the file referenced by `CMD` in the `Dockerfile` (e.g. `python -m agent.main`, `bun run agent/index.ts`). Confirm which framework constructs the agent:

- **LangChain**: imports from `langchain`, `langgraph`, or `langchain_*`; uses `create_agent`, `AgentExecutor`, or LangGraph.
- **Mastra**: imports `@mastra/core`, constructs `new Agent({...})` or `new Mastra({...})`.

### 2. Install the adapter

```bash
# Python / LangChain
pip install astropods-adapter-langchain        # add to requirements.txt

# TypeScript / Mastra (Bun)
bun add @astropods/adapter-mastra

# TypeScript / Mastra (npm)
npm install @astropods/adapter-mastra
```

### 3. Wire up `serve()`

Replace the existing entry-point invocation with the adapter's `serve()` call. **The agent's construction code stays untouched** — tools, prompts, models, memory all keep working.

#### LangChain (Python)

```python
from astropods_adapter_langchain import LangChainAdapter, serve

# existing agent setup stays untouched
agent = create_agent(llm, tools=tools, system_prompt=system_prompt)

adapter = LangChainAdapter(agent, name="my-agent", system_prompt=system_prompt, tools=tools)
serve(adapter)
```

Notes:
- Uses `astream(stream_mode="updates")` — responses arrive as complete messages, not token-by-token.
- `options.conversation_id` is passed as `thread_id` automatically — LangGraph memory/checkpointing works across turns.
- `tools` passed to `LangChainAdapter` is only for playground display; actual tool wiring stays in `create_agent`.

#### Mastra (TypeScript/Bun)

For a simple agent:

```typescript
import { Agent } from '@mastra/core/agent';
import { serve } from '@astropods/adapter-mastra';

const agent = new Agent({
  name: 'My Agent',
  instructions: 'You are a helpful assistant.',
  model: openai('gpt-4o'),
  tools: { ... },
});

serve(agent);
```

For a full Mastra app (`new Mastra({...})`), pass the agent to `serve()` and ensure storage is initialized **before** the Mastra instance is constructed — Mastra queries storage on construction and will race ahead of any lazy init:

```typescript
import { Mastra } from '@mastra/core/mastra';
import { serve } from '@astropods/adapter-mastra';

// Initialize storage first — Mastra queries it immediately on construction
await storage.init();

export const mastra = new Mastra({ agents: { myAgent }, storage, ... });

serve(myAgent);
```

Notes:
- Uses `fullStream` — responses stream token-by-token.
- `options.conversationId` is passed as the memory `thread` automatically.
- OTEL tracing is auto-configured when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (the runner injects it).

### 4. Update the `Dockerfile` `CMD` if needed

If the entry-point filename changed, update the final `CMD` line to match. If you kept the same filename and only replaced its contents, the `Dockerfile` does not need changes.

### 5. Verify telemetry

Run `ast project start`, send a request through the messaging interface, then check the platform's runs/traces view. You should see a new run with spans for the agent's LLM calls and tool invocations.

If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (running outside `ast project start`), the adapter falls back to no-op tracing — agent works, telemetry is silently dropped.

---

## Manual instrumentation

For an agent with no first-party adapter (a different framework, raw LLM calls, or a frontend agent that owns its own HTTP surface and never calls `serve()`), there is nothing to auto-wire tracing — the OTEL SDK is the whole telemetry path.

1. **Initialize the SDK first**, before any instrumented code runs. Export over OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT` (the runner injects it; unset locally → no-op). Set `service.name` from `ASTRO_AGENT_NAME` and `service.version` from `ASTRO_AGENT_BUILD`.
2. **Wrap meaningful work in spans** — the request, each LLM call, each tool call.
3. **Set the attributes the backend reads.** It recognizes a specific set; anything else lands in raw metadata rather than the dedicated input/output/user/usage fields:

| Purpose                          | Span attribute(s)                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Input                            | `langfuse.observation.input`, `langfuse.trace.input` (also `gen_ai.input`, `input.value`) |
| Output                           | `langfuse.observation.output`, `langfuse.trace.output` (also `gen_ai.output`, `output.value`) |
| User (filterable)                | `langfuse.user.id` — a stable, non-PII identifier                                 |
| Session (groups a conversation)  | `langfuse.session.id`                                                             |
| LLM generation                   | `langfuse.observation.type = "generation"` + `gen_ai.request.model`               |
| Token usage                      | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`                         |

On a root (or `workflow`-kind) span, observation-level input/output is promoted to the trace-level fields automatically; otherwise set the `langfuse.trace.*` keys directly.

- **Cost.** Usage is recorded as token counts. A monetary cost renders only when the backend has a price for the reported model — the gateway emits raw usage and does not compute cost. For per-trace cost, register a model price in the backend for the model name you report.
- **Redaction.** With prompt redaction enabled on the collector, the content keys (`langfuse.observation.input`/`output`, `langfuse.trace.input`/`output`, `gen_ai.prompt`/`completion`/`input`/`output`, `llm.prompts`/`completions`) become `[REDACTED]`; usage, model, user, and session are left intact.
- **Streaming responses.** If the handler returns before the reply finishes streaming (work continues in a stream callback), the request span has already ended — open a dedicated span around the streaming work so the generation and tool calls are captured under it.

---

## Common issues

| Problem | Fix |
|---------|-----|
| Agent responds but no runs appear in the platform | Confirm the entry point calls `serve(...)`, not the framework's invoke/stream directly. Restart with `ast project start` so `OTEL_EXPORTER_OTLP_ENDPOINT` is injected. |
| Mastra: agent can't connect to postgres after storage init | Storage must be initialized **before** `new Mastra()` is constructed — use top-level await on `storage.init()`. |
| Mastra: traces appear but missing tool spans | Ensure tools are registered on the `Agent`/`Mastra` instance, not bound ad-hoc per call — only registered tools are auto-traced. |
| LangChain: streaming feels slow / arrives in chunks | Expected. The LangChain adapter uses `astream(stream_mode="updates")`, so updates land as complete messages. Switch to per-token streaming requires a custom adapter. |
| `serve()` exits immediately on container start | The runner injects `GRPC_SERVER_ADDR` only inside `ast project start`. Outside it, `serve()` has nothing to bind to. |
| Manual instrumentation: user / input / output blank in a trace | You're setting non-recognized attribute keys. Use the `langfuse.*` / `gen_ai.*` keys from [Manual instrumentation](#manual-instrumentation); anything else lands in raw metadata, not the dedicated fields. |
| Tokens show but cost is blank | Usage is recorded, but the backend has no price for the model. Register a model price for the reported model name; the gateway emits raw usage and does not compute cost. |
