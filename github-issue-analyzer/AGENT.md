---
description: GitHub Issue Analyzer — ingests GitHub issues into a Neo4j knowledge graph with OpenAI-powered analysis
model: openai/gpt-4o
interfaces: [web, slack]
integrations: [github, neo4j]
knowledge: graph (Neo4j)
---

Analyzes GitHub issues from a repository by ingesting them into a Neo4j knowledge graph, enriching each issue with structured OpenAI analysis, and answering questions using Cypher queries and comment summarization.

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
