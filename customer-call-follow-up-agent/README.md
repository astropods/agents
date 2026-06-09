# Customer Call Follow-Up Agent

An Astro agent that automates post-call follow-up for sales reps. Give it a Zoom meeting ID and it fetches the transcript, extracts action items, raises Zendesk tickets for any issues, creates a Notion call summary page, and returns a formatted action list ready for Slack.

## Workflow

1. **Receive meeting ID** — via webhook POST to port 3000 or direct chat/Slack message
2. **Fetch transcript** — Zoom OAuth refresh → GET recording files → download VTT transcript
3. **Analyse** — GPT-4.1 identifies the account name, action items, and support issues
4. **Create tickets** — Zendesk ticket per support issue found (0 or more)
5. **Update Notion** — Create a child page with the call summary and full action item list
6. **Return response** — Formatted action list with ticket links and Notion page URL, delivered via the platform adapter

## Quick start

```bash
# Configure credentials (Zoom, Zendesk, Notion, OpenAI)
ast configure

# Start the agent locally
ast dev
```

## Usage

**Via chat or Slack** — send the Zoom meeting ID:

> *"87654321098"*

**Via webhook** — POST from an automation (e.g. Zapier, Zoom webhook on recording ready):

```bash
curl -X POST https://<agent-url>:3000 \
  -H "Content-Type: application/json" \
  -d '{"meetingId": "87654321098"}'
```

The webhook returns `{ "ok": true }` immediately and processes asynchronously.

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `ZOOM_CLIENT_ID` | `ast configure` | Zoom marketplace app client ID — from [Zoom App Marketplace](https://marketplace.zoom.us) |
| `ZOOM_CLIENT_SECRET` | `ast configure` | Zoom marketplace app client secret |
| `ZOOM_REFRESH_TOKEN` | `ast configure` | OAuth2 refresh token from Zoom authorization |
| `ZENDESK_URL` | `ast configure` | Zendesk subdomain (e.g. `mycompany`) |
| `ZENDESK_AGENT_EMAIL` | `ast configure` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | `ast configure` | Zendesk API token — from Zendesk Admin > Apps & Integrations > API |
| `NOTION_API_KEY` | `ast configure` | Notion internal integration secret — from [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| `NOTION_PARENT_PAGE_ID` | `ast configure` | ID of the Notion page that holds all call summary pages |
| `WEBHOOK_SECRET` | `ast configure` | Optional bearer token to authenticate incoming webhook requests (treated as a secret) |

## Testing

```bash
bun test
```

Unit tests cover Zoom OAuth token refresh, transcript fetching, Zendesk auth encoding, ticket creation, and Notion page creation — all with mocked `fetch`.

## Project structure

```
customer-call-follow-up-agent/
├── agent/
│   ├── index.ts        # Agent definition, tools, webhook server, serve()
│   ├── utils.ts        # Zoom, Zendesk, and Notion API helpers
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Bot integration via Socket Mode; send the meeting ID directly to the bot
- **Webhook** — POST `{ meetingId }` to port `3000` from any automation tool

## Model

Uses `openai/gpt-4.1` via the Astro-managed OpenAI integration.
