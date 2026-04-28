# hello-astro — agent harness guide

This is an Astropods agent project. The agent echoes messages and appends a random joke — no LLM required. Use it as a reference for the project structure and conventions.

## Project structure

```
hello-astro/
├── agent/
│   └── index.ts        # Agent entry point — implement your logic here
├── astropods.yml        # Agent spec: name, interfaces, inputs, dev config
├── Dockerfile           # Container build — usually needs no changes
├── AGENT.md             # Agent card: description, tags, capabilities for the catalog
└── package.json
```

## How the agent works

`agent/index.ts` exports an `AgentAdapter` and calls `serve(adapter)` from `@astropods/adapter-core`. The adapter implements:

- `stream(prompt, hooks, options)` — handles each incoming message. Call `hooks.onChunk(text)` to stream response tokens, `hooks.onFinish()` when done, `hooks.onError(err)` on failure.
- `getConfig()` — returns static config: `systemPrompt`, `tools`.

## Making changes

To change the agent's behaviour, edit `agent/index.ts`. To add inputs (API keys, config values), add them to `astropods.yml` under the `inputs` section and access them via `process.env.KEY_NAME` at runtime.

## Running locally

```bash
ast project configure   # set any required inputs
ast project start       # start containers; hot-reload if dev.command is set
ast project logs        # tail agent logs
```

## Spec reference

Run `ast docs` for the full `astropods.yml` spec reference and agent development guide.
