---
description: Understand what's happening in your GitHub repository — surface issue trends, categories, competitor mentions, and solutions without writing a single query
model: openai/gpt-4o
interfaces: [web, slack]
integrations: [github, neo4j]
knowledge: graph (Neo4j)
---

Reading through hundreds of GitHub issues to spot patterns, find workarounds, or understand what competitors are mentioned takes hours. This agent does it for you — it ingests your repository's issues into a knowledge graph, enriches them with AI analysis, and lets you ask questions in plain English to get instant answers.

## What you can ask

- "What are the most common categories of open issues?"
- "Are there any issues mentioning competitor X?"
- "Summarize the comments on issue #42"
- "Which issues have no workaround yet?"
- "What bugs have the most reactions?"
- "Show me all issues in the 'performance' category"

## Tools

| Tool | Description |
|------|-------------|
| `queryNeo4j` | Runs read-only Cypher queries against the knowledge graph |
| `summarizeComments` | Fetches and summarizes comments for a specific issue |

## Knowledge graph

Issues are stored as nodes with rich relationships:

- **Categories** — bug, feature, performance, docs, etc. (AI-assigned)
- **Competitors** — any competitor tools mentioned in the issue body or comments
- **Workarounds / Solutions** — extracted by OpenAI and stored as linked nodes
- **Keywords** — salient terms for search and clustering
- **Users** — authors and commenters

## Ingestion

Runs automatically on startup. Set `SYNC_MODE=schedule` for incremental syncs (only fetches issues updated since the last run). Control scope with `GITHUB_OWNER`, `GITHUB_REPO`, and `ISSUE_LIMIT` build args in `astropods.yml`.
