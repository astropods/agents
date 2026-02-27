# Astropods Agents

Pre-built Astro AI agents you can run locally with `ast dev`.

- **CLI [docs](https://docs.astropods.ai)**
- **Read our [blog](https://blog.astropods.ai)**
- **Join the [waitlist](https://blog.astropods.ai/waitlist)**

## Agents

| Agent | Description |
|-------|-------------|
| [github-issue-analyzer](./github-issue-analyzer) | Ingests GitHub issues into a Neo4j knowledge graph, enriches with OpenAI analysis, answers questions via Cypher and comment summarization. Requires `GITHUB_TOKEN` and `OPENAI_API_KEY`. |

## Quick start

Clone the repo and run an agent:

```bash
git clone git@github.com:astropods/agents.git
cd agents/github-issue-analyzer
ast configure   # update required API keys (or edit .env directly)
ast dev
```

Open http://localhost:3000 to chat with the agent.

See each agent's README for setup details and prerequisites.
