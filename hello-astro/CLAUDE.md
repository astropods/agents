# hello-astro — Claude Code guide

See `AGENTS.md` for the full project overview, structure, and conventions.

## Key files

- `agent/adapter.ts` — agent logic; implement `stream()` and `getConfig()` on the `AgentAdapter`
- `agent/index.ts` — entry point; enables tracing and calls `serve()`
- `astropods.yml` — spec: name, interfaces, inputs, dev config
- `AGENT.md` — catalog card: description, tags, capabilities

## Running locally

```bash
ast project start    # start containers
ast project logs     # tail logs
ast project stop     # stop containers
```

## Spec reference

Run `ast docs` for the full `astropods.yml` spec and agent development guide.
