---
description: "Fetches industry news from four sources in parallel, deduplicates, and delivers an AI briefing via web or Slack."
tags:
  - news
  - industry-intelligence
  - sentiment-analysis
  - openai
  - product-management
  - research
capabilities:
  - "Fetch news in parallel from NewsAPI, GNews, The Guardian, and MediaStack"
  - "Deduplicate articles across sources by title"
  - "Summarise up to 20 articles into a structured briefing using GPT-4o mini"
  - "Deliver output as summary, deep analysis, or key insights"
  - "Degrade gracefully when individual sources are unavailable"
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

| Source | Key required |
|--------|-------------|
| NewsAPI | `NEWS_API_KEY` |
| GNews | `GNEWS_API_KEY` |
| The Guardian | `GUARDIAN_API_KEY` |
| MediaStack | `MEDIASTACK_API_KEY` |

All four are queried in parallel. If a source fails (quota, invalid key, outage), it is skipped and the remaining results are used.

## Environment variables

| Variable | Description |
|----------|-------------|
| `NEWS_API_KEY` | NewsAPI key — configured at deploy time |
| `GNEWS_API_KEY` | GNews API key — configured at deploy time |
| `GUARDIAN_API_KEY` | The Guardian Open Platform key — configured at deploy time |
| `MEDIASTACK_API_KEY` | MediaStack API key — configured at deploy time |
| `OPENAI_API_KEY` | Auto-injected by Astropods |

## Slack integration

The agent supports both the **web** and **Slack** adapters. At deploy time, choose which adapter(s) to enable — the Slack adapter handles authentication and delivery automatically.

## Limitations

- Up to 10 articles per source (40 total before dedup); summarisation uses the top 20 after dedup.
- Article descriptions are truncated at 200 characters before being sent to OpenAI.
- Deduplication matches on exact (lowercased, trimmed) title only — near-duplicate headlines are not merged.
- The full briefing is returned once all sources are queried and summarised; per-source progress is not streamed.
