# Migrate Agent to Astropods

Add the two files needed to run an existing agent with `ast dev`: `astropods.yml` and `Dockerfile`. **No agent code is modified.**

---

## Steps

### 1. Explore the existing agent

Read the code to understand:
- Language and runtime (Python version, Node version, Bun, etc.)
- How to run it (entry point command, e.g. `python -m agent.main`, `bun run agent/index.ts`)
- What LLM providers it uses (OpenAI, Anthropic, etc.)
- What external services/secrets it needs (API keys, tokens)
- Any system-level dependencies (e.g. `git`, `ffmpeg`)
- Existing `requirements.txt`, `package.json`, or equivalent

### 2. Create `astropods.yml`

```yaml
# yaml-language-server: $schema=https://astropods.ai/schema/package.json
spec: package/v1
name: "<agent-name>"         # kebab-case; org-scoped: "@postman/agent-name"

meta:
  description: "<one-line description>"

agent:
  build:
    context: .
    dockerfile: Dockerfile

models:
  openai:                    # include only providers the agent actually uses
    provider: openai
  anthropic:
    provider: anthropic

integrations:                # built-in providers that auto-inject credentials
  firecrawl:
    provider: firecrawl
  github:
    provider: github

inputs:                      # everything else — secrets and config
  TAVILY_API_KEY:
    name: TAVILY_API_KEY
    datatype: string
    secret: true
    description: "Tavily API key for web search"
    display-as: short-text   # short-text | select | textarea
  SOME_OPTION:
    name: SOME_OPTION
    datatype: string
    description: "Which backend to use"
    default: "tavily"
    optional: true
    display-as: select
    options: [tavily, openai, none]

dev:
  interfaces:
    messaging:
      adapters: [web]        # web | slack (can list both)
```

**Rules:**
- `inputs` must be a **map** (not a list). Each key is the env var name.
- Omit `models`, `integrations`, or `inputs` entirely if not needed.
- Model provider keys (openai, anthropic) inject the corresponding API key automatically.
- Built-in integrations (firecrawl, github) inject their credentials automatically. Anything else goes in `inputs`.

### 3. Create `Dockerfile`

Match the runtime the agent already uses. Don't change how it runs — just containerize it.

**Python:**
```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN adduser --disabled-password --uid 1000 agent
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
# Add system deps if needed:
# RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY . .
USER agent
CMD ["python", "-m", "agent.main"]   # ← match the actual entry point
```

**TypeScript/Bun:**
```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/package.json ./
# Add system deps if needed:
# RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN chown -R bun:bun /app
USER bun
CMD ["bun", "run", "agent/index.ts"]  # ← match the actual entry point
```

**Node.js/npm:**
```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/ ./
USER node
CMD ["node", "agent/index.js"]        # ← match the actual entry point
```

### 4. Verify

Run `ast dev` in the agent directory. It should load the spec, build the container, and expose a messaging interface.

---

## Common issues

| Problem | Fix |
|---------|-----|
| `cannot unmarshal !!seq into map[string]spec.Input` | `inputs` is a list — convert to map syntax (step 2) |
| Container exits immediately | Check `CMD` matches the real entry point |
| Missing system dep | Add `apt-get install` to the runtime stage of the Dockerfile |
| Agent can't find `GRPC_SERVER_ADDR` | Normal outside `ast dev` — it's injected automatically by the runner |
