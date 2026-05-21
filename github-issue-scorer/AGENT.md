---
description: "Scores GitHub issues by priority and sentiment using GPT-4o mini, surfacing competitor mentions and workarounds — via web or Slack."
tags:
  - github
  - triage
  - sentiment-analysis
  - slack
  - product-management
  - openai
  - issues
capabilities:
  - "Fetch and analyse up to 50 open GitHub issues in a single run"
  - "Score each issue HIGH, MEDIUM, or LOW priority using GPT-4o mini"
  - "Detect user sentiment: frustration, urgency, neutral, or positive"
  - "Surface competitor mentions and user-reported workarounds"
  - "Deliver ranked priority report via web chat or Slack adapter"
  - "Analyse a single issue by number (owner/repo#123)"
repository:
  type: github
  url: https://github.com/artur-malec-apptimia/agents
  directory: github-issue-scorer
integrations:
  - GitHub
  - OpenAI
---

# GitHub Issue Scorer

Your backlog is full of open issues and you don't know where to start. GitHub Issue Scorer reads every issue — body and all comments — then uses GPT-4o mini to rank them by priority, surface frustrated users, flag competitor mentions, and collect workarounds your community already found. Results arrive sorted high to low, whether you're using the web chat or Slack adapter.

## Usage

Send a message:

| Message | Effect |
|---------|--------|
| `owner/repo` | Analyse top 5 open issues |
| `owner/repo 20` | Analyse top 20 open issues (max 50) |
| `owner/repo#123` | Analyse a single issue |

**Examples:**
- *"pallets/flask"* — score the 5 most recent open issues in Flask
- *"vercel/next.js 15"* — deep-dive the top 15 Next.js issues
- *"rails/rails#50234"* — analyse one specific Rails issue

## What the report includes

For each issue:
- **Priority** — `HIGH`, `MEDIUM`, or `LOW` with a one-sentence justification
- **Sentiment** — `FRUSTRATION`, `URGENCY`, `NEUTRAL`, or `POSITIVE` with details
- **Summary** — 2-3 sentence description of the bug or request
- **Reactions** — upvotes, total reactions, comment count
- **Competitor mentions** — other tools users compared against (if any)
- **Workarounds** — solutions users found themselves (if any)

Issues are sorted high to low in the final report.

## Priority definitions

| Priority | Criteria |
|----------|----------|
| `HIGH` | Security vulnerability, data loss, crash, or blocker |
| `MEDIUM` | Significant bug, degraded UX, or important feature request |
| `LOW` | Minor bug, cosmetic issue, nice-to-have, or question |

## Slack integration

The agent supports both the **web** and **Slack** adapters. At deploy time, choose which adapter(s) to enable — the Slack adapter handles authentication and message delivery automatically, no extra configuration needed in the agent itself.

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `GITHUB_TOKEN` | Auto-injected by Astropods GitHub integration |

## Limitations

- Analyses open issues only; closed issues and pull requests are excluded.
- Analysis is capped at 50 issues per run to stay within token limits.
- Comment bodies are truncated at 500 characters each; very long comment threads may lose detail.
- Requires a GitHub token with at least read access to the target repository.
- The full report is returned once all issues are processed; per-issue progress is not streamed.
