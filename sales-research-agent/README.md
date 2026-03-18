# Sales Research Agent

An AI agent that researches customer accounts using Gong call transcripts and Salesforce data. It runs on the Astro platform using the Mastra framework with Claude Sonnet 4.5.

## Architecture

```
sales-research-agent/
├── agent/                        # Mastra agent + tools
│   ├── index.ts                  # Agent entry point (Claude Sonnet 4.5)
│   └── tools/
│       ├── gong-search.ts        # Semantic search over Gong transcripts in Qdrant
│       ├── salesforce-account.ts # Salesforce account lookup (SOSL + field filtering)
│       └── salesforce-opportunity.ts  # Salesforce opportunity lookup
├── ingestion/
│   └── startup/
│       ├── index.ts              # Ingestion entry point (runs on startup)
│       └── Dockerfile
├── src/services/
│   ├── gong.ts                   # Gong API client (extensive endpoint, transcripts)
│   ├── salesforce.ts             # Salesforce REST client (OAuth, SOSL, SOQL)
│   ├── vectors.ts                # Qdrant vector store (query + upsert)
│   ├── embeddings.ts             # OpenAI text-embedding-3-small
│   ├── chunker.ts                # Speaker-aware transcript chunking
│   └── pipeline.ts               # Ingestion orchestrator
├── astropods.yml                  # Astro platform configuration
├── Dockerfile                    # Agent container
├── package.json
└── tsconfig.json
```

## How It Works

**Agent** — Answers questions about customer accounts by:
1. Looking up the account in Salesforce (SOSL search → full record → intent-based field filtering)
2. Fetching all opportunities for that account
3. Searching Gong call transcripts via semantic search in Qdrant
4. Synthesizing findings with inline citations

**Ingestion** — Populates the Qdrant vector store by:
1. Discovering calls via Gong's extensive API (with CRM context for account names)
2. Fetching transcripts for each call
3. Chunking transcripts with speaker awareness (~600 tokens, 75-token overlap)
4. Generating embeddings via OpenAI text-embedding-3-small
5. Upserting vectors with rich metadata to Qdrant

## Setup

```bash
ast configure   # interactive setup for all credentials and inputs
ast dev
```

## Configuration

All credentials and inputs are declared in `astropods.yml` and managed via `ast configure`. No manual `.env` file is needed.

### Built-in Providers

| Provider | Section | Auto-injected Env Vars | Purpose |
|----------|---------|----------------------|---------|
| `anthropic` | models | `ANTHROPIC_API_KEY` | Agent LLM (Claude Sonnet 4.5) |
| `openai` | models | `OPENAI_API_KEY` | Embeddings (text-embedding-3-small) |
| `qdrant` | knowledge | `QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_URL` | Vector store (self-hosted sidecar) |

### Custom Providers

| Provider | Injected Env Vars | Purpose |
|----------|------------------|---------|
| `gong` | `GONG_ACCESS_KEY`, `GONG_ACCESS_KEY_SECRET`, `GONG_BASE_URL`, `GONG_APP_URL` | Gong call transcript API |
| `sf` | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REFRESH_TOKEN`, `SF_DOMAIN`, `SF_BASE_URL`, `SF_API_VERSION` | Salesforce REST API |

### Inputs

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CALLS` | unlimited | Cap on Gong calls to ingest (useful for faster dev cycles) |

### Ingestion Build Args

| Arg | Default | Description |
|-----|---------|-------------|
| `GONG_START_DATE` | `2024-07-22` | Start of date range for call discovery |
| `GONG_END_DATE` | today | End of date range for call discovery |

## Tools

### `gongSemanticSearch`
Searches Gong call transcripts using semantic vector search in Qdrant. Supports filtering by account name, date range, and specific call ID. Returns transcript chunks with metadata and Gong links.

### `salesforceAccountLookup`
Looks up accounts in Salesforce using SOSL search. Returns intent-filtered data: general info, metrics/ARR, usage, team, sales context, or business info.

### `salesforceOpportunityLookup`
Looks up opportunities by account ID, opportunity ID, or name. Returns intent-filtered data: general, win details, loss details, ARR, competitors, or deal details. Includes opportunity contact roles.
