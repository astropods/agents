# parrot-agent

A simple parrot agent that repeats back what you say in a playful and enthusiastic way.

## Quick start

```bash
# Install dependencies
bun install

# Start the agent locally
ast dev
```

## Project structure

```
parrot-agent/
├── agent/
│   └── index.ts          # Agent entry point
├── astropods.yml             # Agent specification
├── Dockerfile            # Agent container
├── .env                  # Environment variables (set via ast configure; not committed)
└── package.json
```

## Configuration

The agent is configured in `astropods.yml`. Key sections:

### Model

Self-hosted **anthropic** provider running `claude-sonnet-4-5`.

### Integrations

| Integration | Type | Environment variable |
|------------|------|---------------------|
| Anthropic | Model API | `ANTHROPIC_API_KEY` |

### Interfaces
- **Web** — HTTP/SSE endpoint (playground available at `localhost:3000` during dev)

