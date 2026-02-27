# GitHub Issue Analyzer

Ingests GitHub issues from a repository into a Neo4j knowledge graph, enriches them with OpenAI analysis, and answers questions using Cypher queries and comment summarization.

Built with [Mastra](https://mastra.ai) and the Astro platform.

## Architecture

```
┌───────────────────────────────────────────────────────┐
│  Ingestion (SYNC_MODE=startup — full sync)            │
│                                                       │
│  GitHub GraphQL ─► Neo4j ─► OpenAI ─► Neo4j           │
│  (fetch issues)    (store)   (analyze)  (store result) │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│  Ingestion (SYNC_MODE=schedule — incremental)         │
│                                                       │
│  Same pipeline, only fetches issues updated since     │
│  the last successful run.                             │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│  Agent                                                │
│                                                       │
│  User ─► Playground ─► Messaging ─► Agent             │
│                                      ├─ queryNeo4j    │
│                                      └─ summarize     │
└───────────────────────────────────────────────────────┘
```

### Knowledge Graph Schema

**Nodes:** Issue, Comment, User, Label, Reaction, Category, Competitor, Workaround, Solution, Keyword

**Key relationships:**
- `(Issue)-[:HAS_COMMENT]->(Comment)`
- `(Issue)-[:AUTHORED_BY]->(User)`
- `(Issue)-[:BELONGS_TO_CATEGORY]->(Category)`
- `(Issue)-[:HAS_SOLUTION]->(Solution)`
- `(Issue)-[:HAS_WORKAROUND]->(Workaround)`
- `(Issue)-[:MENTIONS_COMPETITOR]->(Competitor)`

## Quick Start

### Prerequisites

- Astro CLI (`curl -fsSL https://astropods.ai/install | sh`)
- Docker
- A GitHub token and OpenAI API key

### Setup

```bash
git clone https://github.com/astropods/agents.git
cd agents/github-issue-analyzer
ast configure
```

### Run

```bash
ast dev
```

This will:
1. Start Neo4j (persistent volume, no auth)
2. Start the messaging service and playground UI
3. Build and run the startup ingestion (full sync: fetches issues, analyzes with OpenAI, stores in Neo4j)
4. Start the agent

Open http://localhost:3000 to chat with the agent.

## Project Structure

```
github-issue-analyzer/
├── astropods.yml                   # Astro agent spec
├── Dockerfile                      # Agent container
├── vitest.config.ts                # Test configuration (unit + evals)
├── tsconfig.json                   # TypeScript config
├── .env.example                    # Required env vars template
├── agent/
│   ├── index.ts                    # Mastra Agent + serve() entry point
│   └── tools/
│       ├── query-neo4j.ts          # Read-only Cypher queries (createTool)
│       ├── summarize-comments.ts   # Fetch + summarize comments (createTool)
│       └── __tests__/
│           ├── query-neo4j.test.ts
│           └── summarize-comments.test.ts
├── ingestion/
│   ├── Dockerfile                  # Shared ingestion container
│   └── index.ts                    # Entry point (SYNC_MODE selects full/incremental)
├── src/services/
│   ├── neo4j.ts                    # Neo4j driver singleton + write operations
│   ├── database.ts                 # Neo4j read operations (issue details)
│   ├── github.ts                   # GitHub GraphQL API client
│   ├── openai.ts                   # OpenAI structured analysis
│   ├── analysis.ts                 # Store analysis results back into Neo4j
│   └── pipeline.ts                 # Orchestrates the full ingestion flow
└── test/
    ├── dump-fixtures.ts            # Export Neo4j data to seed.cypher
    ├── fixtures/
    │   └── seed.cypher             # Neo4j fixture data (generated)
    └── evals/
        ├── setup.ts                # Loads .env for vitest
        └── agent.eval.ts           # Agent-level Mastra evals
```

## Configuration

All configuration is in `astroai.yml`.

**Providers** (credentials auto-injected from `.env`):

| Section | Provider | Env var injected |
|---------|----------|------------------|
| `models.openai` | `openai` | `OPENAI_API_KEY` |
| `tools.github` | `github` | `GITHUB_TOKEN` |
| `knowledge.graph` | `neo4j` | `NEO4J_HOST`, `NEO4J_PORT` (auto) |

**Ingestion build args** (baked into container images via `astroai.yml`):

| Arg | Default | Description |
|-----|---------|-------------|
| `SYNC_MODE` | `startup` / `schedule` | Full sync or incremental |
| `GITHUB_OWNER` | *(required)* | Repository owner |
| `GITHUB_REPO` | *(required)* | Repository name |
| `ISSUE_LIMIT` | `100` (startup) / `0` (schedule) | Max issues to process (0 = all) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Powers GPT-4o for analysis and the agent |
| `GITHUB_TOKEN` | Yes | GitHub API access for fetching issues |

## Testing

### Unit tests (fast, no Docker, no API keys)

Tests the agent tools with mocked Neo4j and OpenAI:

```bash
bun run test:unit
```

### Capture fixture data

Exports ~50 real issues from a running dev Neo4j into `test/fixtures/seed.cypher`:

```bash
ast dev                  # start the dev environment first
bun run test:dump        # connect and export
```

Re-run anytime to refresh.

### Agent evals (requires Docker + API keys)

Spins up a Neo4j testcontainer, seeds it with the fixture data, then runs the agent against test prompts and scores the results using Mastra scorers:

```bash
bun run test:evals
```

**Scorers used:**
- **Answer relevancy** — does the response actually address the question?
- **Tool usage** — did the agent use `queryNeo4j` / `summarizeComments` instead of hallucinating?

### Run everything

```bash
bun run test
```
