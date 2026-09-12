# GitHub Issue Analyzer

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/deploy/simon/github-issue-analyzer)

Ingests GitHub issues from a repository into a Neo4j knowledge graph, enriches them with OpenAI analysis, and answers questions using Cypher queries and comment summarization.

Built with [Mastra](https://mastra.ai) and the Astro platform.

## Architecture

```
┌───────────────────────────────────────────────────────┐
│  Ingestion (SYNC_MODE=startup — full sync)            │
│                                                       │
│  GitHub GraphQL ─► Neo4j ─► OpenAI ─► Neo4j           │
│  (fetch issues)    (store)  (analyze)  (store result) │
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

**Nodes:** Issue, Comment, User, Label, Reaction, Category, Subcategory, Competitor, Workaround, Solution, Keyword

**Classification** (properties on `Issue`, written during analysis):
`category` (one of frontend, backend, cli, infra, docs, security, observability,
tooling, other), `subcategory` (from a corpus-derived vocabulary persisted as
`Subcategory` nodes), `severity`, `impact`, `effort`, and `priorityScore` (0-100,
derived from the other three by `src/services/priority.ts`).

**Key relationships:**
- `(Issue)-[:HAS_COMMENT]->(Comment)`
- `(Issue)-[:AUTHORED_BY]->(User)`
- `(Issue)-[:BELONGS_TO_CATEGORY]->(Category)`
- `(Issue)-[:HAS_SOLUTION]->(Solution)`
- `(Issue)-[:HAS_WORKAROUND]->(Workaround)`
- `(Issue)-[:MENTIONS_COMPETITOR]->(Competitor)`

## Quick Start

### Prerequisites

- Astro CLI (`curl -fsSL https://astropods.com/install | sh`)
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

Open http://localhost:3100 (or the URL shown by ast dev) to chat with the agent.

## Using the agent

Ask in plain English. The agent writes its own Cypher against the graph and
picks its own tools, so these are starting points rather than fixed commands.

### Explore the taxonomy

Issues carry two independent axes: a fixed `category` naming the area of the
system, and a `subcategory` naming a concern or work type, drawn from a
vocabulary derived from this repository's own issues. Ask for both, or the
second one is easy to miss:

> Show me the full issue taxonomy as two tables. First, every category with its
> issue count. Second, every subcategory term with its definition and issue
> count. Sort both by count descending, and call out any taxonomy value that has
> zero issues.

Asking for the definitions is what makes the agent read the `Subcategory` nodes
rather than just the distinct values already on issues.

> Cross-tabulate category against subcategory: a matrix of issue counts,
> categories as rows, subcategories as columns. Drop any row or column that is
> all zeros.

### Rank what to work on

> What are the top 15 issues by priority score? Show the category, severity,
> effort, and the one-line rationale for each.

> Group issues by category and show me the highest-priority three in each.

> Which small-effort issues have high severity? Those are the quick wins.

### Sync labels to GitHub

Preview first. This is read-only and cannot write, however it is phrased:

> Preview the GitHub label sync. Show which labels would be created or deleted
> and which issues would change. Do not write anything.

The preview returns 25 per-issue changes by default, so say "list up to 100
changes" for more.

Writing requires asking for it explicitly. The agent is instructed to refuse
unless you request it in your own words, because it reads issue bodies and
comments, which are attacker-influenced text:

> Apply the label sync to GitHub.

The agent shows the diff and pauses for your confirmation before anything is
written. See [Label sync](#label-sync) for what it writes and what it leaves
alone.

For a first write, take a chunk rather than the whole set:

> Apply the label sync to GitHub, but only the first 10 issues.

> Apply the label sync for the security category only.

Chunking needs no bookkeeping. The plan is recomputed against the live labels
each run, so issues already written drop out of it and re-running continues from
where the last chunk stopped. The confirmation says how many issues still
differ.

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
│   ├── instructions.ts             # Prompt, parameterised by owner/repo
│   └── tools/
│       ├── query-neo4j.ts          # Read-only Cypher queries (createTool)
│       ├── summarize-comments.ts   # Fetch + summarize comments (createTool)
│       ├── prioritize-issues.ts    # Ranked / grouped issues
│       ├── preview-label-sync.ts   # Label diff, read-only
│       ├── apply-label-sync.ts     # Label write, gated on confirmation
│       └── __tests__/
├── ingestion/
│   ├── Dockerfile                  # Shared ingestion container
│   ├── Dockerfile.labels           # Label sync container
│   ├── index.ts                    # Entry point (SYNC_MODE selects full/incremental)
│   └── sync-labels.ts              # Label sync entry point (APPLY gates writes)
├── src/services/
│   ├── neo4j.ts                    # Neo4j driver singleton + write operations
│   ├── database.ts                 # Neo4j read operations (issue details)
│   ├── github.ts                   # GitHub GraphQL API client
│   ├── openai.ts                   # OpenAI structured analysis
│   ├── analysis.ts                 # Store analysis results back into Neo4j
│   ├── priority.ts                 # Taxonomy + priority scoring (pure)
│   ├── subcategory.ts              # Corpus-derived subcategory vocabulary
│   ├── github-labels.ts            # Label planning + sync
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

All configuration is in `astropods.yml`.

**Providers** (credentials auto-injected from `.env`):

| Section | Provider | Env var injected |
|---------|----------|------------------|
| `models.openai` | `openai` | `OPENAI_API_KEY` |
| `tools.github` | `github` | `GITHUB_TOKEN` |
| `knowledge.graph` | `neo4j` | `NEO4J_HOST`, `NEO4J_PORT` (auto) |

**Deploy-time inputs** (top-level `inputs` in `astropods.yml`, prompted by `ast configure` and injected into every container, including both ingestion entries):

| Input | Default | Description |
|-------|---------|-------------|
| `GITHUB_OWNER` | none | Repository owner |
| `GITHUB_REPO` | none | Repository name |

**Startup ingestion inputs** (scoped to the `startup` entry, so they reach only that container):

| Input | Default | Values | Description |
|-------|---------|--------|-------------|
| `ISSUE_LIMIT` | `20` | any integer | Max issues to ingest on the first run (0 = all) |
| `ISSUE_STATE` | `open` | `open`, `closed`, `all` | Which issue states to ingest on the first run |

Change either at deploy time to backfill more history or pull in closed issues.
The scheduled sync stays uncapped and set to `all`, so declaring these per-entry
rather than top-level keeps the startup defaults from narrowing incremental runs.

**Ingestion build args** (baked into container images via `astropods.yml`):

| Arg | Value | Description |
|-----|-------|-------------|
| `SYNC_MODE` | `startup` / `schedule` | Full sync or incremental |
| `ISSUE_LIMIT` | `0` (schedule) | Fallback when no input is supplied |
| `ISSUE_STATE` | `all` (schedule) | Fallback when no input is supplied |

The scheduled sync uses `ISSUE_STATE=all` so an issue closed since the last run
is re-fetched and marked `CLOSED` in the graph.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Powers GPT-4o for analysis and the agent |
| `GITHUB_TOKEN` | Yes | GitHub API access for fetching issues |

## Label sync

Pushes the derived classification back to GitHub as namespaced labels:
`area/<category>`, `type/<subcategory>`, and `priority/P0..P3` (score bands at
80, 60, 40). Only labels under those three prefixes are added or removed, so
human-managed labels are never touched.

The repository's label list is reconciled as well, not just the labels on each
issue:

- A label the plan needs but the repository lacks is created, colored by prefix.
- Every label it creates carries the description `Derived by github-issue-analyzer`.
- A label with that description is deleted once no issue or pull request carries
  it, so an emptied category stops cluttering the label picker.
- A label without that description is never deleted, however unused it is (see
  `selectOrphans` in `src/services/github-labels.ts`).

Creations and deletions appear in the preview and in the confirmation diff, so a
cleanup is never a surprise. Both are computed against the repository's live
label list, so the diff you confirm names only labels that really are missing or
really are unused.

Three ways to run it, all of which refuse to write unless explicitly told to:

| Mode | How | Writes? |
|------|-----|---------|
| Explicit job | `ast project trigger sync-labels` | Only when `APPLY=true` |
| Preview tool | Ask the agent to preview the label sync | Never |
| Confirmed write | Ask the agent to apply it | Shows the diff, pauses for your confirmation, then writes |

### Varying a run

Each ingestion entry declares `inputs` that an env file can override, so you can
change what a run does without editing the spec. Credentials are never needed in
such a file: `ast configure` values are merged afterwards and always win.

| Setting | Entry | Purpose |
|---------|-------|---------|
| `ISSUE_LIMIT=0`, `ISSUE_STATE=open` | `startup` | Ingest every open issue |
| `APPLY=false` | `sync-labels` | Print the label diff, write nothing (the default) |
| `APPLY=true` | `sync-labels` | Write the labels to GitHub |
| `LABEL_LIMIT=10` | `sync-labels` | Write at most 10 issues, then stop. Re-run to continue |
| `LABEL_CATEGORY=security` | `sync-labels` | Restrict to one taxonomy category |

Put the settings in a file and pass it, for example:

```bash
printf 'APPLY=true\n' > labels-apply.env
ast project trigger sync-labels --env labels-apply.env
```

Two CLI behaviors to know, both of which fail quietly:

- **The `--env` path must be relative to the project directory.** The CLI joins
  it onto the working directory, so an absolute path is mangled, and a missing
  file is ignored without an error. The run then silently uses spec defaults,
  which for `startup` means ingesting every open issue.
- **`ast project trigger` never rebuilds images.** There is no `--rebuild` flag
  on it (only on `project start`), so it will happily run stale code and report
  success. Rebuild first when you have changed anything under `src/` or
  `ingestion/`.

The confirmed write uses Mastra tool suspension, which the Astro adapter bridges
to an elicitation prompt. Declining or dismissing ends the turn without writing.

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
