---
description: Understand what's happening in your GitHub repository — surface issue trends, categories, competitor mentions, and solutions without writing a single query
tags: ["github", "issues", "knowledge-graph", "analytics"]
capabilities:
  - "Query GitHub issues using natural language via a Neo4j knowledge graph"
  - "Surface issue trends, categories, competitor mentions, and workarounds"
  - "Summarize comments on a specific issue"
  - "Group issues into a fixed taxonomy and rank them by derived priority"
  - "Push category, subcategory, and priority back to GitHub as labels, on confirmation"
  - "Run incremental or full syncs of repository issues into the graph"
integrations:
  - "GitHub"
  - "Neo4j"
repository:
  type: git
  url: "https://github.com/astropods/agents"
  directory: github-issue-analyzer
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
| `prioritizeIssues` | Ranks issues by priority score, filtered or grouped by category |
| `previewLabelSync` | Shows which GitHub labels would change, which would be created, and which unused ones would be deleted. Read-only |
| `applyLabelSync` | Writes those labels, creates the ones it needs, and deletes the unused ones it created, all after you confirm the diff |

## Knowledge graph

Issues are stored as nodes with rich relationships:

- **Category** — one of frontend, backend, cli, infra, docs, security,
  observability, tooling, other
- **Subcategory** — a concern or work type, from a vocabulary derived from this
  repository's own issue titles
- **Priority** — severity, impact, and effort judged per issue, combined into a
  0-100 score
- **Categories** — legacy free-text categories (AI-assigned, noisy)
- **Competitors** — any competitor tools mentioned in the issue body or comments
- **Workarounds / Solutions** — extracted by OpenAI and stored as linked nodes
- **Keywords** — salient terms for search and clustering
- **Users** — authors and commenters

## Ingestion

Runs automatically on startup. Set `SYNC_MODE=schedule` for incremental syncs (only fetches issues updated since the last run). The target repo is set via the top-level `GITHUB_OWNER` / `GITHUB_REPO` inputs in `astropods.yml` (configured at deploy time with `ast configure`); the startup sync takes two deploy-time inputs: `ISSUE_STATE` (default `open`) and
`ISSUE_LIMIT` (default 20, 0 = all).
