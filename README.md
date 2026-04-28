# Astropods Agents

Pre-built agents packages as Astropods you can run locally with `ast dev`.

- **CLI [docs](https://docs.astropods.com)**
- **Read our [blog](https://blog.astropods.com)**
- **Build and deploy to Astro [get started](https://astropods.com)**

## Agents

| Agent | Description |
|-------|-------------|
| [hello-astro](./hello-astro) | Minimal starter agent that echoes a greeting. Use it as a template for building your own Astropod. |
| [github-issue-analyzer](./github-issue-analyzer) | Ingests GitHub issues into a Neo4j knowledge graph, enriches with OpenAI analysis, and answers questions via Cypher and comment summarization. Requires `GITHUB_TOKEN` and `OPENAI_API_KEY`. |
| [release-note-helper](./release-note-helper) | Queries Jira for completed issues, lets you curate candidates interactively, verifies linked GitHub PRs, and drafts a formatted release note matching your team's style. Remembers preferences across sessions via Redis. Requires `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_KEY`, `GITHUB_TOKEN`, and `ANTHROPIC_API_KEY`. |
| [sales-research-agent](./sales-research-agent) | Researches customer accounts by searching Gong call transcripts (semantic vector search via Qdrant) and Salesforce data. Requires `GONG_ACCESS_KEY`, `GONG_ACCESS_KEY_SECRET`, and Salesforce OAuth credentials. |
| [feature-flag-assistant](./feature-flag-assistant) | Identifies stale LaunchDarkly feature flags for cleanup: flags fully rolled out to 100% production for 2+ weeks and flags with zero code references. Sends bi-weekly scheduled audit reports to Slack. Requires `LAUNCHDARKLY_API_KEY`, `GITHUB_TOKEN`, and `SLACK_BOT_TOKEN`. |

## Quick start

Clone the repo and run an agent:

```bash
git clone https://github.com/astropods/agents.git
cd agents/hello-astro            # or replace with another agent
ast dev
```

Open http://localhost:3000 to chat with the agent.

See each agent's README for setup details and prerequisites.
