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
| [github-issue-scorer](./github-issue-scorer) | Scores open GitHub issues by priority and sentiment using GPT-4o mini — ranking by urgency, surfacing frustrated users, flagging competitor mentions, and collecting community workarounds. Requires `GITHUB_TOKEN` and `OPENAI_API_KEY`. |
This repo contains pre-built agents you can run locally with `ast dev`. You can also try these agents directly from [astropods.com/explore](https://astropods.com/explore) with one-click deploys.

- For local development or to contribute, you will need the Astropods [**CLI called `ast`**](https://docs.astropods.com)
- To deploy your own agents or try one that is pre-built, create an account to **[get started](https://astropods.com)**

## Explore Agents

<table>
  <thead>
    <tr>
      <th width="250">Agent</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="./hello-astro">hello-astro</a></td>
      <td>Minimal starter agent that echoes a greeting. Use it as a template for building your own Astropod.</td>
    </tr>
    <tr>
      <td><a href="./github-issue-analyzer">github-issue-analyzer</a></td>
      <td>Ingests GitHub issues into a Neo4j knowledge graph, enriches with OpenAI analysis, and answers questions via Cypher and comment summarization. Requires <code>GITHUB_TOKEN</code> and <code>OPENAI_API_KEY</code>.</td>
    </tr>
    <tr>
      <td><a href="./release-note-helper">release-note-helper</a></td>
      <td>Queries Jira for completed issues, lets you curate candidates interactively, verifies linked GitHub PRs, and drafts a formatted release note matching your team's style. Remembers preferences across sessions via Redis. Requires <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code>, <code>JIRA_API_KEY</code>, <code>GITHUB_TOKEN</code>, and <code>ANTHROPIC_API_KEY</code>.</td>
    </tr>
    <tr>
      <td><a href="./sales-research-agent">sales-research-agent</a></td>
      <td>Researches customer accounts by searching Gong call transcripts (semantic vector search via Qdrant) and Salesforce data. Requires <code>GONG_ACCESS_KEY</code>, <code>GONG_ACCESS_KEY_SECRET</code>, and Salesforce OAuth credentials.</td>
    </tr>
    <tr>
      <td><a href="./feature-flag-assistant">feature-flag-assistant</a></td>
      <td>Identifies stale LaunchDarkly feature flags for cleanup: flags fully rolled out to 100% production for 2+ weeks and flags with zero code references. Sends bi-weekly scheduled audit reports to Slack. Requires <code>LAUNCHDARKLY_API_KEY</code>, <code>GITHUB_TOKEN</code>, and <code>SLACK_BOT_TOKEN</code>.</td>
    </tr>
    <tr>
      <td><a href="./youtube-comment-analyzer">youtube-comment-analyzer</a></td>
      <td>Classifies YouTube video comments by sentiment using GPT-4o mini. Fetches up to 500 comments via the YouTube Data API, batches them for classification, and returns a breakdown with representative examples and unreplied comments to prioritise. Requires <code>OPENAI_API_KEY</code> and <code>YOUTUBE_API_KEY</code>.</td>
    </tr>
    <tr>
      <td><a href="./industry-news-agent">industry-news-agent</a></td>
      <td>Fetches industry news from up to four sources in parallel (NewsAPI, GNews, The Guardian, MediaStack), deduplicates, and delivers an AI briefing as a summary, deep analysis, or key insights. All API keys are optional. Requires <code>OPENAI_API_KEY</code>.</td>
    </tr>
  </tbody>
</table>

## Quick start

Clone the repo and run an agent:

```bash
git clone https://github.com/astropods/agents.git
cd agents/hello-astro            # or replace with another agent
ast dev
```

Open http://localhost:3100 (or the URL shown by ast dev) to chat with the agent.

See each agent's README for setup details and prerequisites.

## For Contributors

### Pre-commit hook

The repo ships an opt-in pre-commit hook at `.githooks/pre-commit` that runs the same lint, typecheck, and test checks as CI — but only for the agent directories with staged changes. Non-agent paths (`plugins/`, `skills/`, etc.) are skipped automatically.

Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

You'll need `bun`, `ruff`, and `ast` on your `PATH` for the checks to run. A missing `ast` produces a warning with install instructions; missing `bun` or `ruff` fails the affected agent's checks.

**Escape hatches** for when you need to commit fast:

```bash
SKIP_TYPECHECK=1 git commit ...   # skip tsc --noEmit
SKIP_TESTS=1     git commit ...   # skip bun run test:unit
git commit --no-verify ...        # bypass the hook entirely
```

### Claude Code plugin

This repository is also a [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces). These skills will help you create a new Astropods project from scratch, or, help you migrate an existing agent to run on Astropods.

Run these commands to add the skills to your Claude Code:
```
/plugin marketplace add astropods/agents
/plugin install astropods@astroai
```

See [`plugins/astropods/README.md`](./plugins/astropods/README.md) for what's included.
