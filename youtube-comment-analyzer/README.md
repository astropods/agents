# YouTube Comment Analyzer

An Astro agent that classifies YouTube comments by sentiment using GPT-4o mini. It fetches comments in bulk, processes them in batches of 30, and returns a breakdown of how your audience feels — with representative examples per category and a list of unreplied comments to prioritise.

## Workflow

1. **Extract video ID** — Accepts any YouTube URL format or a bare 11-character video ID
2. **Fetch comments** — Pages through the YouTube Data API v3 to collect up to 500 top-level comments
3. **Classify in batches** — Sends batches of 30 to GPT-4o mini for sentiment classification (`positive`, `neutral`, `negative`)
4. **Compile report** — Aggregates counts, percentages, representative examples, and unreplied comments
5. **Deliver summary** — Returns the full report via web chat or Slack

## Quick start

```bash
# Configure credentials (YouTube, OpenAI, Slack)
ast configure

# Start the agent locally
ast dev
```

## Usage

Send a message with a YouTube video URL or ID:

| Message | Effect |
|---------|--------|
| `https://www.youtube.com/watch?v=VIDEO_ID` | Analyse top 100 comments |
| `https://youtu.be/VIDEO_ID` | Analyse top 100 comments |
| `https://www.youtube.com/shorts/VIDEO_ID` | Analyse top 100 comments |
| `VIDEO_ID` | Bare 11-character ID |
| `VIDEO_ID 200` | Analyse up to 200 comments |

**Examples:**
- *"https://youtu.be/dQw4w9WgXcQ"* — analyse the top 100 comments
- *"dQw4w9WgXcQ 300"* — go deeper with 300 comments

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `YOUTUBE_API_KEY` | `ast configure` | YouTube Data API v3 key — get one at [console.cloud.google.com](https://console.cloud.google.com) |

## Testing

```bash
bun test
```

Unit tests cover video ID extraction, batch message building, JSON sentiment parsing, and report formatting using mocked API responses.

## Project structure

```
youtube-comment-analyzer/
├── agent/
│   ├── index.ts        # Agent definition, instructions, and tool registration
│   ├── utils.ts        # Video ID extraction, batch helpers, report formatter
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
