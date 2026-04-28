---
description: "A zero-config starter agent that echoes every message and responds with a random joke — no setup required, deploy immediately"
tags: ["echo", "jokes", "demo", "starter"]
capabilities:
  - "Echo the user's message back verbatim"
  - "Fetch and return a random safe joke from JokeAPI"
integrations:
  - "JokeAPI"
---

# Hello World

A zero-config starter agent that echoes every message it receives and appends a random joke fetched from [JokeAPI](https://jokeapi.dev). No LLM is used — responses are generated purely in code.

## Getting Started

No configuration or arguments are required. Push and deploy immediately:

```bash
ast blueprint push hello-astro
ast blueprint deploy hello-astro
```

That's it. The agent is ready to run as-is.

## Usage

Send any message and the agent will respond with:

1. Your message echoed back, prefixed with `Echo: `
2. A random safe-mode joke from JokeAPI

## Limitations

- Jokes are fetched from the public JokeAPI — availability depends on the external service
- No conversation memory or context tracking
- Does not interpret or respond to message content beyond echoing it
