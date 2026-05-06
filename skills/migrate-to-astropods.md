# Migrate Agent to Astropods

Add the files needed to run an existing agent with `ast project start`: `astropods.yml`, `Dockerfile`, and optionally `AGENT.md`. **No agent logic is modified.**

---

## Steps

### 1. Explore the existing agent

Read the code to understand:
- Language and runtime (Python version, Node version, Bun, etc.)
- How to run it (entry point command, e.g. `python -m agent.main`, `bun run agent/index.ts`)
- What LLM providers it uses (OpenAI, Anthropic, etc.)
- What external services/secrets it needs (API keys, tokens)
- What storage it uses (database, vector store, key-value store)
- Any system-level dependencies (e.g. `git`, `ffmpeg`, native binaries)
- Existing `requirements.txt`, `package.json`, or equivalent

### 2. Create `astropods.yml`

Link to the astropods spec: https://docs.astropods.com/astropods-package-spec

```yaml
# yaml-language-server: $schema=https://astropods.ai/schema/package.json
spec: astro/v1
name: "<agent-name>"         # kebab-case; org-scoped: "@postman/agent-name"

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
- Omit `models`, `integrations`, `knowledge`, or `inputs` entirely if not needed.
- Model provider keys (openai, anthropic) inject the corresponding API key automatically.
- Built-in integrations (firecrawl, github) inject their credentials automatically. Anything else goes in `inputs`.
- `meta.description` does NOT go in `astropods.yml` — put it in `AGENT.md` frontmatter (see step 5).

#### Adding a database (`knowledge`)

If the agent needs persistent storage, declare it under `knowledge`. The platform manages the service and injects connection details.

```yaml
knowledge:
  db:
    provider: postgres      # platform-managed postgres; injects POSTGRES_HOST/PORT/USER/PASSWORD/DB
    persistent: true

  vectors:
    provider: qdrant        # platform-managed qdrant; injects QDRANT_HOST/PORT/API_KEY
    persistent: true

  cache:
    provider: redis         # platform-managed redis; injects REDIS_HOST/PORT/PASSWORD
    persistent: true
```

For vector workloads requiring pgvector, use a custom container instead of provider mode (provider postgres does not include pgvector):

```yaml
knowledge:
  pg:
    container:
      image: pgvector/pgvector:pg17
      port: 5432
      volume: /var/lib/postgresql/data
    persistent: true
    inputs:
      - name: POSTGRES_DB
        datatype: string
        default: mydb
      - name: POSTGRES_USER
        datatype: string
        default: postgres
      - name: POSTGRES_PASSWORD
        datatype: string
        default: postgres
      - name: POSTGRES_HOST_AUTH_METHOD
        datatype: string
        default: trust
      - name: PGDATA
        datatype: string
        default: /var/lib/postgresql/data/pgdata
```

Container mode does **not** inject `POSTGRES_HOST` — the platform injects `KNOWLEDGE_{UPPER(name)}_HOST` and `KNOWLEDGE_{UPPER(name)}_PORT` instead (e.g. `KNOWLEDGE_PG_HOST`). If no env vars are injected, connect using the knowledge key as the hostname (e.g. `knowledge-pg`).

#### Adding custom provider credentials (`providers`)

For third-party services that aren't built-in (Jira, Gong, Salesforce, etc.), use `providers` to group credentials:

```yaml
providers:
  jira:
    scope: [integrations]
    variables:
      - name: API_KEY
        description: Jira API token
        datatype: string
        secret: true
      - name: BASE_URL
        description: Jira instance base URL
        datatype: string

integrations:
  jira:
    provider: jira           # references the custom provider above
```

### 3. Create `Dockerfile`

Match the runtime the agent already uses. Don't change how it runs, just containerize it.

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
COPY package.json bun.lock ./
RUN bun install
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app ./
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

### 4. Wire up an adapter (if applicable)

If the agent uses a supported framework, replace the entry point with the adapter's `serve()` call. **No other agent code changes are needed.**

Install the adapter for your framework first:

```bash
# Python / LangChain
pip install astropods-adapter-langchain        # then add to requirements.txt

# TypeScript / Mastra (Bun)
bun add @astropods/adapter-mastra

# TypeScript / Mastra (npm)
npm install @astropods/adapter-mastra
```

#### LangChain (Python)

Add `astropods-adapter-langchain` to `requirements.txt`, then update the entry point:

```python
from astropods_adapter_langchain import LangChainAdapter, serve

# existing agent setup stays untouched
agent = create_agent(llm, tools=tools, system_prompt=system_prompt)

adapter = LangChainAdapter(agent, name="my-agent", system_prompt=system_prompt, tools=tools)
serve(adapter)
```

Notes:
- Uses `astream(stream_mode="updates")` — responses arrive as complete messages, not token-by-token
- `options.conversation_id` is passed as `thread_id` automatically — LangGraph memory/checkpointing works across turns
- `tools` passed to `LangChainAdapter` is only for playground display; actual tool wiring stays in `create_agent`

#### Mastra (TypeScript/Bun)

Add `@astropods/adapter-mastra` to `package.json`. For a simple agent, update the entry point:

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
- Uses `fullStream` — responses stream token-by-token
- `options.conversationId` is passed as the memory `thread` automatically
- OTEL tracing is auto-configured when `OTEL_EXPORTER_OTLP_ENDPOINT` is set

### 5. Create `AGENT.md` (recommended)

`AGENT.md` populates the agent's catalog card for discovery. Use YAML frontmatter:

```markdown
---
description: "One-line summary of what the agent does (max 200 chars)"
tags: [productivity, coding, data]
authors:
  - name: Your Name
    account: your-github-handle
capabilities:
  - "Does X when given Y"
  - "Integrates with Z to accomplish W"
repository: github:your-org/your-repo
integrations:
  - GitHub
  - Slack
---

## Overview
What the agent does and why it's useful.

## Usage
How to interact with it. Example prompts.

## Limitations
Known gaps or constraints.
```

### 6. Verify

Run `ast project start` in the agent directory. It should build the container, start all services, and expose a messaging interface.

---

## Common issues

| Problem | Fix |
|---------|-----|
| `cannot unmarshal !!seq into map[string]spec.Input` | `inputs` is a list — convert to map syntax (step 2) |
| Container exits immediately | Check `CMD` matches the real entry point |
| Missing system dep | Add `apt-get install` to the runtime stage of the Dockerfile |
| Agent can't find `GRPC_SERVER_ADDR` | Normal outside `ast project start` — it's injected automatically by the runner |
| Postgres container fails: `POSTGRES_PASSWORD not specified` | Add `POSTGRES_HOST_AUTH_METHOD: trust` and `PGDATA: /var/lib/postgresql/data/pgdata` to knowledge inputs; avoid `secret: true` on inputs that need defaults |
| Postgres container fails: `chmod Operation not permitted` | Set `PGDATA` to a subdirectory (e.g. `/var/lib/postgresql/data/pgdata`) so postgres creates it with correct ownership instead of chmod-ing the mount root |
| Agent can't connect to postgres after storage init | Storage must be initialized before `new Mastra()` is constructed — use top-level await on `storage.init()` |
| Native module missing (e.g. `tokenizers-linux-arm64-gnu`) | Add `--platform=linux/amd64` to both Dockerfile `FROM` lines to force x86_64 if the package has no ARM64 binary |
| `secret: true` input default not applied by platform | Remove `secret: true` for internal service credentials (like postgres password) where the default should always apply; use `secret: true` only for user-supplied credentials |
| Container mode postgres host unknown | Platform injects `KNOWLEDGE_{UPPER(name)}_HOST/PORT` (e.g. `KNOWLEDGE_PG_HOST`). If not injected, use the knowledge key name as the hostname (e.g. `knowledge-pg`) |
