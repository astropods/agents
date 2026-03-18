---
description: Account research assistant searches Gong call transcripts and Salesforce data to answer questions about customer accounts
model: anthropic/claude-sonnet-4-5
interfaces: [web]
integrations: [gong, salesforce]
knowledge: vectors (Qdrant)
---

Researches customer accounts by combining Gong call transcript search with Salesforce CRM data. Surfaces relevant context from past conversations and deal history to help sales, CS, and leadership answer questions about any account.

## What you can ask

- "What has Acme Corp said about our pricing in recent calls?"
- "What's the current ARR and renewal date for Globex?"
- "Who are the main contacts at Initech and what do they care about?"
- "Summarize the last 3 calls with Wayne Enterprises"
- "Are there any open opportunities for Umbrella Corp?"
- "What competitors came up in calls with Hooli this quarter?"

## Tools

| Tool | Description |
|------|-------------|
| `gongSemanticSearch` | Semantic vector search over Gong call transcript chunks in Qdrant. Supports filtering by account name, date range, and call ID. |
| `salesforceAccountLookup` | SOSL account search with intent-based field filtering (general info, ARR, usage, team, sales context, business info) |
| `salesforceOpportunityLookup` | Opportunity lookup by account, ID, or name with intent filtering (general, win/loss details, ARR, competitors, deal details) |

## Ingestion

Runs on startup. Fetches Gong calls via the Extensive Calls API (with CRM context for account name matching), pulls transcripts, chunks them with speaker awareness (~600 tokens, 75-token overlap), embeds via OpenAI `text-embedding-3-small`, and upserts into Qdrant.

Use `MAX_CALLS` to cap ingestion during development (e.g. `MAX_CALLS=50`).

## Salesforce authentication

Uses OAuth `refresh_token` flow. Configure `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, and `SF_REFRESH_TOKEN` via `ast configure`.
