---
description: "A starter example that demonstrates the key concepts of an Astropods project — zero config, deploy immediately"
tags: ["demo", "starter"]
capabilities:
  - "Echo the user's message back verbatim"
  - "Fetch and return a random safe joke from JokeAPI"
integrations:
  - "JokeAPI"
---

# Hello Astro

This is a starter example project, not a real agent. It is intentionally simple — it echoes messages and fetches a random joke — so you can focus on understanding the project structure, spec format, and deployment workflow without any domain logic getting in the way.

Use it to verify your local setup, learn how the adapter API works, and as a starting point for building your own agent.

## Getting Started

No configuration required. Push and deploy immediately:

```bash
ast blueprint push hello-astro
ast blueprint deploy hello-astro
```

## What it demonstrates

- Project layout: `astropods.yml`, `Dockerfile`, `agent/index.ts`, `AGENT.md`
- The `AgentAdapter` interface: `stream()`, `hooks.onChunk()`, `hooks.onFinish()`
- Local development with `ast project start`
- Pushing a blueprint and deploying an agent end-to-end
