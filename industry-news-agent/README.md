# Industry News Agent

An Astro agent that fetches industry news from up to four sources in parallel, deduplicates articles, and delivers a structured AI briefing via web or Slack. All API keys are optional — configure any combination and the agent works with whatever sources you have. Ask for a summary, a deep analysis, or just the key insights.

## Workflow

1. **Fetch in parallel** — Queries NewsAPI, GNews, The Guardian, and MediaStack simultaneously (up to 10 articles each)
2. **Deduplicate** — Removes duplicate articles across sources by title
3. **Summarise** — Sends all unique articles to GPT-4o mini for a structured briefing
4. **Deliver** — Returns the result in your chosen format via web chat or Slack

All API keys are **optional** — configure any combination and only those sources are queried. If no keys are set, the agent will tell you which to add. Sources that error (quota, outage) are skipped gracefully.

## Quick start

```bash
# Configure credentials (news APIs, OpenAI, Slack)
ast configure

# Start the agent locally
ast dev
```

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

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Required | Source | Description | Get a key |
|----------|----------|--------|-------------|-----------|
| `OPENAI_API_KEY` | Yes | Auto-injected | OpenAI model API key | — |
| `NEWS_API_KEY` | No | `ast configure` | NewsAPI key | [newsapi.org](https://newsapi.org) |
| `GNEWS_API_KEY` | No | `ast configure` | GNews API key | [gnews.io](https://gnews.io) |
| `GUARDIAN_API_KEY` | No | `ast configure` | The Guardian Open Platform key | [open-platform.theguardian.com](https://open-platform.theguardian.com/access/) |
| `MEDIASTACK_API_KEY` | No | `ast configure` | MediaStack API key | [mediastack.com](https://mediastack.com) |

## Testing

```bash
bun test
```

Unit tests cover deduplication logic and output format detection using mocked fetch responses.

## Project structure

```
industry-news-agent/
├── agent/
│   ├── index.ts        # Agent definition, instructions, and tool registration
│   ├── utils.ts        # Deduplication and format detection helpers
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Bot integration via Socket Mode (mention the bot or reply in a thread)

## Model

Uses `openai/gpt-4o-mini` via the Astro-managed OpenAI integration.
