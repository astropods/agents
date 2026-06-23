# Customer Meetings Agent

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/daily-customer-briefs)

An Astro agent that runs every weekday morning and posts a pre-meeting customer brief to Slack. For each calendar event with external attendees, it looks up open Zendesk tickets and active HubSpot deals, then formats a concise per-meeting summary.

## Workflow

1. **Fetch calendar** — Queries Google Calendar for today's events (or a specified date)
2. **Identify external attendees** — Skips internal-only meetings; extracts company/domain for each external participant
3. **Look up context** — Searches Zendesk for open tickets and HubSpot for active deals per attendee
4. **Compose brief** — One section per meeting: attendees, open tickets, active deals
5. **Post to Slack** — Delivers the brief via the platform's built-in Slack adapter

## Quick start

```bash
# Configure credentials (Google, Zendesk, HubSpot, OpenAI)
ast configure

# Start the agent locally
ast dev
```

## Triggers

- **Cron job** (default `0 8 * * 1-5`): Automatically generates and posts the brief each weekday at 8 AM. Override with `CRON_SCHEDULE`.
- **Chat message**: Request a brief on demand via the web or Slack adapter.

## Environment variables

All runtime credentials are managed by `ast configure`.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `GOOGLE_CLIENT_ID` | `ast configure` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `ast configure` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | `ast configure` | Google OAuth refresh token for Calendar access |
| `GOOGLE_CALENDAR_ID` | `ast configure` | Calendar ID (`primary` or calendar email address) |
| `ZENDESK_URL` | `ast configure` | Zendesk instance URL (e.g. `https://yourcompany.zendesk.com`) |
| `ZENDESK_EMAIL` | `ast configure` | Zendesk agent email address (treated as a secret) |
| `ZENDESK_API_KEY` | `ast configure` | Zendesk API token |
| `HUBSPOT_API_KEY` | `ast configure` | HubSpot private app access token — from [HubSpot developer portal](https://developers.hubspot.com) |
| `SLACK_CHANNEL` | `ast configure` | Slack channel ID for the daily brief (optional — omit to skip Slack posting) |
| `CRON_SCHEDULE` | `ast configure` | Cron expression (default: `0 8 * * 1-5`) |

## Testing

```bash
bun test
```

Unit tests cover Google OAuth token refresh, Calendar event mapping (including all-day events and missing fields), Zendesk search, HubSpot deal mapping, and `buildZendeskAuth` using mocked `fetch`.

## Project structure

```
customer-meetings-agent/
├── agent/
│   ├── index.ts        # Agent definition, tools, cron job, and Slack egress
│   ├── utils.ts        # Google, Zendesk, and HubSpot API helpers
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Bot integration via Socket Mode; the cron job posts the brief to a configured channel automatically

## Model

Uses `openai/o3` via the Astro-managed OpenAI integration.
