---
description: "Fetches industry news from configured sources in parallel, deduplicates, and delivers an AI briefing via web or Slack."
tags:
  - news
  - industry-intelligence
  - openai
  - product-management
  - research
capabilities:
  - "Fetch news in parallel from any configured sources (NewsAPI, GNews, The Guardian, MediaStack)"
  - "Deduplicate articles across sources by title"
  - "Summarise all deduplicated articles into a structured briefing using GPT-4o mini"
  - "Deliver output as summary, deep analysis, or key insights"
  - "Work with any combination of API keys — all sources are optional"
  - "Report clearly when no news sources are configured"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: industry-news-agent
integrations:
  - OpenAI
---

# Industry News Agent

Keeping up with your industry means checking four different news sites every morning. Industry News Agent does it in one shot — fetching from NewsAPI, GNews, The Guardian, and MediaStack in parallel, removing duplicates, and handing the result to GPT-4o mini for a structured briefing. Ask for a summary, a deep analysis, or just the key insights.

## Usage

Send a topic — optionally append a format keyword:

| Message | Effect |
|---------|--------|
| `AI news` | Key themes, top stories, takeaway (default summary) |
| `startup funding analysis` | Market signals, key players, risks & opportunities |
| `fintech key insights` | 5-7 actionable bullet points + what to watch |

**Examples:**
- *"electric vehicles Europe"* — latest EV news summarised
- *"quantum computing analysis"* — deep analytical breakdown
- *"SaaS pricing key insights"* — direct, actionable bullets

## Output formats

| Format | Triggered by | Structure |
|--------|-------------|-----------|
| **Summary** | default | Key themes · Top stories · Takeaway |
| **Analysis** | `analysis` / `analyse` / `analyze` | Market signals · Key players · Risks & opportunities · Verdict |
| **Key insights** | `key insights` / `insights` | 5-7 action-verb bullets · What to watch |

## Sources

| Source | Key required | Get a key |
|--------|-------------|-----------|
| NewsAPI | `NEWS_API_KEY` | [newsapi.org](https://newsapi.org) |
| GNews | `GNEWS_API_KEY` | [gnews.io](https://gnews.io) |
| The Guardian | `GUARDIAN_API_KEY` | [open-platform.theguardian.com](https://open-platform.theguardian.com/access/) |
| MediaStack | `MEDIASTACK_API_KEY` | [mediastack.com](https://mediastack.com) |

All four API keys are **optional** — configure any combination and the agent will only query the sources you've set up. If none are configured, the agent will tell you which keys to add. Sources that are configured but encounter an error (quota exceeded, outage) are skipped gracefully.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEWS_API_KEY` | Optional | NewsAPI key — configured at deploy time |
| `GNEWS_API_KEY` | Optional | GNews API key — configured at deploy time |
| `GUARDIAN_API_KEY` | Optional | The Guardian Open Platform key — configured at deploy time |
| `MEDIASTACK_API_KEY` | Optional | MediaStack API key — configured at deploy time |
| `OPENAI_API_KEY` | Required | Auto-injected by Astropods |

## Slack integration

The agent supports both the **web** and **Slack** adapters. At deploy time, choose which adapter(s) to enable — the Slack adapter handles authentication and delivery automatically.

## Limitations

- Up to 10 articles per source (40 total before dedup); all deduplicated articles are sent to the summariser.
- Article descriptions are truncated at 200 characters before being sent to OpenAI.
- Deduplication matches on exact (lowercased, trimmed) title only — near-duplicate headlines are not merged.
- The full briefing is returned once all sources are queried and summarised; per-source progress is not streamed.
