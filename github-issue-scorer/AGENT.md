---
description: "Fetches GitHub issues with all comments, analyses priority and sentiment using GPT-4o mini, and optionally posts the report to Slack."
---

# GitHub Issue Scorer

Analyses GitHub issues to help product teams triage faster. For each issue the agent fetches the full body and all comments, then uses GPT-4o mini to produce a structured report with priority score, sentiment, competitor mentions, and reported workarounds. Results are sorted by priority and optionally posted to a Slack channel.

## Usage

Send a message via web chat with one of the following formats:

| Message | Effect |
|---------|--------|
| `owner/repo` | Analyse top 5 open issues |
| `owner/repo 20` | Analyse top 20 open issues |
| `owner/repo#123` | Analyse a single issue |

## What the report includes

For each issue:
- **Priority** — `HIGH`, `MEDIUM`, or `LOW` with a one-sentence justification
- **Sentiment** — `FRUSTRATION`, `URGENCY`, `NEUTRAL`, or `POSITIVE` with details
- **Summary** — 2–3 sentence description of the bug or request
- **Reactions** — upvotes, total reactions, comment count
- **Competitor mentions** — other tools users compared against (if any)
- **Workarounds** — solutions users found themselves (if any)

Issues are sorted high → medium → low in the final report.

## Priority definitions

| Priority | Criteria |
|----------|----------|
| `high` | Security vulnerability, data loss, crash, or blocker |
| `medium` | Significant bug, degraded UX, or important feature request |
| `low` | Minor bug, cosmetic issue, nice-to-have, or question |

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `GITHUB_TOKEN` | Auto-injected by Astropods GitHub integration |
| `SLACK_POSTING_TOKEN` | *(optional)* Slack bot token (`xoxb-...`) for posting results to a channel |
| `SLACK_CHANNEL` | *(optional)* Slack channel ID to post to (e.g. `C1234567890`) |
