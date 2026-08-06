---
description: Port a net-new project to the Astropods platform by adding astropods.yml, Dockerfile, and AGENT.md. No agent logic is modified.
---

# Migrate Agent to Astropods

Use this skill to port a project that does not yet run on Astropods. It adds the files needed to run an existing agent with `ast project start`: `astropods.yml`, `Dockerfile`, and optionally `AGENT.md`. **No agent logic is modified.**

If the project already runs on Astropods but is missing the platform's telemetry adapter, use [`wire-astropods-telemetry`](../wire-astropods-telemetry/SKILL.md) instead — that skill installs the adapter and wires up `serve()` so OpenTelemetry traces flow back to the platform.

Confirm the plan before performing any actions.

---

## Tips to remember

These trip up nearly every migration. Read before writing any YAML.

- **`agent.interfaces.frontend: true` requires the container to listen on port 80.** No other port works for the frontend interface.
- **`ASTRO_EXTERNAL_AGENT_URL` is injected automatically.** Read it from env when the agent needs its own public URL (callbacks, redirects, links in emails). Do **not** declare your own `APP_URL` input.
- **`agent.interfaces.messaging: true` is a boolean.** It is not the same field as `dev.interfaces.messaging.adapters: [web]` (which is an object — for local-dev playground). Both can coexist; don't confuse them.
- **Decide "managed knowledge or BYO database?" before writing any YAML.** If the user already has a hosted DB (Supabase, Neon, RDS), declare it as a secret input and skip the `knowledge:` block entirely. Don't sink time into local postgres debugging when an external option exists.
- **`ast dev` on Docker Desktop (macOS) cannot reach IPv6-only DB hosts.** vpnkit routes only IPv4 to the internet, regardless of daemon IPv6 settings. Supabase's direct connection URL (`db.*.supabase.co`) is IPv6-only and will fail with `gaierror`. Use the IPv4 Session/Transaction Pooler endpoints.
- *(Python)* **Use `os.environ["KEY"]` (subscript) for required env vars.** `.get()` returns `None` silently when the var is missing; subscript crashes loudly so you find misconfig immediately instead of debugging a `NoneType` error five layers deep.
- *(Postgres drivers)* **Don't log raw exception messages from `asyncpg`/`psycopg`.** They embed the full DSN, password included. Log `type(e).__name__` instead.
- *(Postgres URLs)* **`.strip()` connection strings copied from dashboards.** A trailing newline causes `gaierror: No address associated with hostname` — a real time-waster because the URL looks correct in logs.

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

Link to the Astropods spec documentation: https://docs.astropods.com/astropods-package-spec
Link to the Astropods spec schema: https://astropods.com/schema/package.json
If the project already includes an `astropods.yml`, check if it needs to be updated.

```yaml
# yaml-language-server: $schema=https://astropods.com/schema/package.json
spec: blueprint/v1
name: "<agent-name>"         # kebab-case; org-scoped: "@your-account/agent-name"

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
    display-as: short-text   # short-text | long-text | select
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

**Rules** — the CLI is BETA and the schema shifts between minor versions, so treat `ast spec validate` as the source of truth over anything written here. Re-verified on CLI 0.15.10.

- `spec` must be `blueprint/v1`. **The validator does not enforce this value** (any
  non-empty string passes `ast spec validate`, though omitting `spec` entirely is
  caught), so a wrong value here is a silent defect — check it by eye. RFC-1 §2 is
  authoritative for this value regardless of what an older cached copy of the JSON
  schema says. Same rule, same wording in
  [`build-astropods-agent`](../build-astropods-agent/SKILL.md) §2
  (*astropods.yml essentials*) — keep the two in sync.
- Top-level `inputs` must be a **map** (not a list); each key is the env var name,
  injected into every container. The **list** form is a *different field* used for
  nested inputs (`agent.inputs`, `knowledge[].inputs`, etc.), injected only into
  that container — see [`build-astropods-agent`](../build-astropods-agent/SKILL.md) §2
  (*astropods.yml essentials*). The type follows the placement
  (top-level → map; nested → list); using both in one file is expected, not a
  conflict.
- Omit `models`, `integrations`, `knowledge`, or `inputs` entirely if not needed.
- Model provider keys (openai, anthropic) inject the corresponding API key automatically.
- Built-in integrations (firecrawl, github) inject their credentials automatically. Anything else goes in `inputs`.
- **The whole `meta` block is deprecated — omit it in new specs.** `meta.description`/`meta.tags`
  went first (spec v1.2, §2.1: *'Moved to Agent Card frontmatter'*); `meta.visibility` followed
  in spec v1.5 (*'Visibility is managed via the platform UI and API, not the spec.'*). All three
  are **DEPRECATED, not removed** — they still **pass `ast spec validate`**, and the platform
  still reads `meta.description`/`meta.tags` as a fallback when no `AGENT.md` is present. So
  porting an old spec does not break; migrating is a SHOULD, not a hard requirement. But don't
  ship them in new work: move description/tags to `AGENT.md` frontmatter (step 5), and set
  visibility with `ast push --visibility public|private`, the platform UI, or the API — see the
  rules under *Headless / scheduled workers* below. `meta.visibility` is accepted but has no
  effect — verified by pushing `meta.visibility: private` to a public blueprint and watching it
  stay public.
- An org-scoped `name` (`@your-account/...`) must match your **active Astropods
  account** at `ast push` time (or pass `--allow-account-override`). Nothing checks
  this locally, so it surfaces on first push.
- If the agent posts to Slack, consider the platform's Slack adapter (bot
  credentials live in the messaging sidecar — see
  [`build-astropods-agent`](../build-astropods-agent/SKILL.md) §8 *The Slack adapter*)
  instead of declaring a `SLACK_BOT_TOKEN` input.

#### Interfaces (`agent.interfaces` vs `dev.interfaces`)

`agent.interfaces` declares what the **platform** exposes in production. `dev.interfaces` (shown above) controls what `ast project start` spins up locally. They are different fields with different shapes — easy to confuse.

```yaml
agent:
  build:
    context: .
    dockerfile: Dockerfile
  interfaces:
    frontend: true        # public frontend served from the container's port 80
    messaging: true       # boolean — NOT { adapters: [...] }
```

When `frontend: true`:
- The container **must** listen on port 80. Other ports will not be reachable as the frontend.
- The platform injects `ASTRO_EXTERNAL_AGENT_URL` with the public URL. Read this for any callback/redirect/link-in-email need — do not declare your own `APP_URL`.

#### External database (bring your own)

If the agent already uses a hosted database (Supabase, Neon, RDS, etc.), skip the `knowledge:` block entirely and declare the connection string as a secret input. The container reads it from env and connects directly. This is by far the simplest path when an external DB is available.

```yaml
inputs:
  POSTGRES_URL:
    name: POSTGRES_URL
    datatype: string
    secret: true
    description: "PostgreSQL connection string"
```

See the troubleshooting table below for the IPv6 caveat when the host name is IPv6-only.

#### Adding a database (`knowledge`)

If the agent needs persistent storage, declare it under `knowledge`. The platform manages the service and injects connection details. Persistence is automatic — derived from the provider's mount path, or `container.volume` in container mode.

```yaml
knowledge:
  db:
    provider: postgres      # platform-managed postgres; injects POSTGRES_HOST/PORT/USER/PASSWORD/DB

  vectors:
    provider: qdrant        # platform-managed qdrant; injects QDRANT_HOST/PORT/API_KEY

  cache:
    provider: redis         # platform-managed redis; injects REDIS_HOST/PORT/PASSWORD
```

For vector workloads requiring pgvector, use a custom container instead of provider mode (provider postgres does not include pgvector):

```yaml
knowledge:
  pg:
    container:
      image: pgvector/pgvector:pg17
      port: 5432
      volume: /var/lib/postgresql/data   # mount path — this is what makes the store persistent
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

### 4. Create `AGENT.md` (recommended)

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

### 5. Verify

First validate the spec — this catches schema mistakes (invalid `display-as`,
malformed `inputs`, etc.) before any containers build. Re-run it after every
`ast upgrade`; the CLI is BETA and the schema shifts between minor versions.

```bash
ast spec validate
```

Then run `ast project start` in the agent directory. It should build the container, start all services, and expose a messaging interface.

Once running, the agent works end-to-end but the platform records no run telemetry. To enable OpenTelemetry traces, follow up with [`wire-astropods-telemetry`](../wire-astropods-telemetry/SKILL.md).

#### Headless / scheduled workers

Not every migrated project is conversational. For a cron-style worker nobody
chats with:
- `agent.interfaces: { frontend: false, messaging: false }` is a valid shape —
  the worker just runs its own schedule inside the container. Note `ast deploy`
  defaults to `--adapter web`; confirm how a no-interface blueprint is surfaced
  before relying on it in production.
- Alternatively, declare the job under `ingestion:` with `type: schedule` and let
  the **platform** own the timer instead of an in-container scheduler
  (trigger locally with `ast project trigger`).
- A worker can also use `messaging: true` for **egress only** (e.g. posting Slack
  digests via the messaging sidecar) without implementing `serve()` — inbound
  chat will go unanswered, so say so in `AGENT.md`.
- Internal workers rarely belong in the public catalog. Pushes default to **private**, so
  a plain `ast push` already does the right thing — there is no pick-one prompt on a normal
  private push. The rules worth knowing:
  - `ast push --visibility public|private` (`-V`) sets it explicitly.
  - An agent already public on the server **stays public** on re-push unless you pass
    `--visibility private`.
  - The confirm prompt fires only when going public, or demoting a public agent to
    private; `-y` skips it.
  - `meta.visibility` is deprecated (spec v1.5) and has no effect — see the `meta` rule
    above.

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
| Native module missing (e.g. `tokenizers-linux-arm64-gnu`) | Add `--platform=linux/amd64` to both Dockerfile `FROM` lines to force x86_64 if the package has no ARM64 binary |
| `secret: true` input default not applied by platform | Remove `secret: true` for internal service credentials (like postgres password) where the default should always apply; use `secret: true` only for user-supplied credentials |
| Container mode postgres host unknown | Platform injects `KNOWLEDGE_{UPPER(name)}_HOST/PORT` (e.g. `KNOWLEDGE_PG_HOST`). If not injected, use the knowledge key name as the hostname (e.g. `knowledge-pg`) |
| `ast dev` can't reach external DB host (`gaierror`, "No address associated with hostname") | (1) Check for trailing whitespace in the connection URL — strip it. (2) If the host is IPv6-only (e.g. Supabase's `db.*.supabase.co` direct URL), Docker Desktop on macOS cannot route it via vpnkit even with daemon IPv6 enabled. Switch to an IPv4 endpoint (Supabase Session Pooler on port 5432 or Transaction Pooler on 6543). |
| `provider: postgres` starts the container but `POSTGRES_HOST/USER/PASSWORD/DB` never reach the agent | Provider mode injection has been observed to silently fail in some environments. Fall back to container mode using the `image: postgres:16` recipe above with `POSTGRES_HOST_AUTH_METHOD: trust` and a `PGDATA` subdirectory. |
