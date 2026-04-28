# hello-astro

A zero-config starter agent that echoes every message and appends a random joke. No LLM required — deploy immediately.

## Quick start

```bash
ast project start
```

## Project structure

```
hello-astro/
├── agent/
│   └── index.ts        # Agent entry point
├── astropods.yml        # Agent specification
├── Dockerfile           # Agent container
└── package.json
```

## Push and deploy

```bash
ast login
ast blueprint push hello-astro
ast blueprint deploy hello-astro
```
