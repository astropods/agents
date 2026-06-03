# Incident Manager Agent

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/incident-management-agent)

An Astro agent that tracks incidents in Notion, triggered from Slack. Declare an incident with a slash command and the agent logs it immediately — then keeps the detail summary, engineering update, and support update current as the conversation unfolds.

## Workflow

1. **Declare** — Send `/incident-management <name>` in Slack to create a new Notion incident page
2. **Track** — As messages arrive, the agent checks existing incidents and decides whether to create a new one or update an existing one
3. **Update** — Writes a timestamped detail summary, engineering update, and support update to the Notion page
4. **Close** — Marks the incident as Done when resolved; reopens if new information warrants it

## Quick start

```bash
# Configure credentials (Notion, OpenAI, Slack)
ast configure

# Start the agent locally
ast dev
```

## Webhook setup

Configure your Slack app to send slash command and event payloads to your agent on port `3000`:

- **Slash command URL:** `https://<agent-url>:3000/`
- **Event subscription URL:** `https://<agent-url>:3000/`

Required Slack app scopes: `channels:history`, `channels:read`, `chat:write`, `commands`
Required event subscription: `message.channels`

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `NOTION_API_KEY` | `ast configure` | Notion integration secret — from [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| `NOTION_DATABASE_ID` | `ast configure` | ID of the Notion database used as the incident log (treated as a secret) |

## Testing

```bash
bun test
```

Unit tests cover the Notion API helpers (fetch, create, update) and `validateNotionId` using mocked `fetch`.

## Project structure

```
incident-manager-agent/
├── agent/
│   ├── index.ts        # Agent definition, tools, and Slack webhook server
│   ├── utils.ts        # Notion API helpers and type definitions
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Receives slash commands and message events via webhook on port `3000`

## Model

Uses `openai/gpt-4.1` via the Astro-managed OpenAI integration.

## Agent directory

View this agent on Astropods: [astropods.com/astro-ai/incident-management-agent](https://astropods.com/astro-ai/incident-management-agent)
