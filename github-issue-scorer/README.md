# GitHub Issue Scorer

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/github-issue-scorer)

An Astro agent that scores open GitHub issues by priority and sentiment using GPT-4o mini. It reads every issue — body and all comments — then ranks them by priority, surfaces frustrated users, flags competitor mentions, and collects workarounds the community has already found.

## Workflow

1. **Fetch issues** — Pull up to 50 open issues (with comments) from any public or private GitHub repository
2. **Score each issue** — GPT-4o mini assigns `HIGH`, `MEDIUM`, or `LOW` priority with a one-sentence justification
3. **Detect sentiment** — Classify user tone as `FRUSTRATION`, `URGENCY`, `NEUTRAL`, or `POSITIVE`
4. **Surface signals** — Flag competitor mentions and user-reported workarounds
5. **Deliver report** — Return issues sorted high to low via web chat or Slack

## Quick start

```bash
# Configure credentials (GitHub, OpenAI, Slack)
ast configure

# Start the agent locally
ast dev
```

## Usage

Send a message in chat or Slack:

| Message | Effect |
|---------|--------|
| `owner/repo` | Analyse top 5 open issues |
| `owner/repo 20` | Analyse top 20 open issues (max 50) |
| `owner/repo#123` | Analyse a single issue |

**Examples:**
- *"pallets/flask"* — score the 5 most recent open issues in Flask
- *"vercel/next.js 15"* — deep-dive the top 15 Next.js issues
- *"rails/rails#50234"* — analyse one specific Rails issue

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `GITHUB_TOKEN` | `ast configure` | GitHub integration token (read access) |

## Testing

```bash
bun test
```

Unit tests cover the GitHub API client and all scoring/analysis utilities using mocked `fetch`.

## Project structure

```
github-issue-scorer/
├── agent/
│   ├── index.ts        # Agent definition, instructions, and tool registration
│   ├── utils.ts        # GitHub API client and scoring helpers
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

## Agent directory

View this agent on Astropods: [astropods.com/astro-ai/github-issue-scorer](https://astropods.com/astro-ai/github-issue-scorer)
