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

Supported frameworks today: **LangChain (Python)** and **Mastra (TypeScript)**. For other frameworks, telemetry must be emitted manually via the OTEL SDK using `OTEL_EXPORTER_OTLP_ENDPOINT` (injected by the runner).

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

## Common issues

| Problem | Fix |
|---------|-----|
| Agent responds but no runs appear in the platform | Confirm the entry point calls `serve(...)`, not the framework's invoke/stream directly. Restart with `ast project start` so `OTEL_EXPORTER_OTLP_ENDPOINT` is injected. |
| Mastra: agent can't connect to postgres after storage init | Storage must be initialized **before** `new Mastra()` is constructed — use top-level await on `storage.init()`. |
| Mastra: traces appear but missing tool spans | Ensure tools are registered on the `Agent`/`Mastra` instance, not bound ad-hoc per call — only registered tools are auto-traced. |
| LangChain: streaming feels slow / arrives in chunks | Expected. The LangChain adapter uses `astream(stream_mode="updates")`, so updates land as complete messages. Switch to per-token streaming requires a custom adapter. |
| `serve()` exits immediately on container start | The runner injects `GRPC_SERVER_ADDR` only inside `ast project start`. Outside it, `serve()` has nothing to bind to. |
