# Route Urgent Tickets Agent

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/route-urgent-tickets-agent)

An Astro agent that automatically triages incoming Zendesk tickets. It analyses each ticket, applies relevant tags, and routes urgent issues (outages, security incidents, P1/P2) to the correct PagerDuty team — all triggered by a webhook.

## Workflow

1. **Receive webhook** — Zendesk POSTs a new ticket payload to port `3000`
2. **Tag** — Fetches all existing Zendesk tags, selects the most relevant ones, and updates the ticket
3. **Assess urgency** — Determines whether the ticket is urgent (outage, security, data loss, P1/P2)
4. **Route** — If urgent: fetches PagerDuty services and creates an incident routed to the correct team
5. **Skip** — If standard: stops after tagging; no PagerDuty action

## Quick start

```bash
# Configure credentials (Zendesk, PagerDuty, OpenAI)
ast configure

# Start the agent locally
ast dev
```

## Webhook setup

Configure a Zendesk webhook to `POST` to your agent URL on port `3000`:

- **Trigger:** Ticket created → `https://<agent-url>:3000/`
- **Signing:** Enable webhook signing in Zendesk and copy the signing secret into `WEBHOOK_SECRET`. The agent verifies the `x-zendesk-webhook-signature` HMAC-SHA256 header on every request and rejects anything that doesn't match.

## Usage via chat

You can also trigger the agent manually from the web playground or Slack:

| Message | Effect |
|---------|--------|
| `12345` | Triage ticket #12345 |
| `check ticket 12345` | Any message containing a ticket ID |
| `{"detail":{"id":"12345","description":"..."}}` | Full webhook payload |

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `ZENDESK_SUBDOMAIN` | `ast configure` | The `{subdomain}` in `https://{subdomain}.zendesk.com` |
| `ZENDESK_USERNAME` | `ast configure` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | `ast configure` | Zendesk API token — from Zendesk Admin > Apps & Integrations > API |
| `ZENDESK_TICKET_URL` | `ast configure` | Base ticket URL e.g. `https://mycompany.zendesk.com/agent/tickets` |
| `PAGERDUTY_API_KEY` | `ast configure` | PagerDuty REST API key — from [PagerDuty API access](https://support.pagerduty.com/docs/api-access-keys) |
| `PAGERDUTY_FROM_EMAIL` | `ast configure` | Email for PagerDuty `From` header (required by PagerDuty API) |
| `WEBHOOK_SECRET` | `ast configure` | Zendesk webhook signing secret — copy from Zendesk Admin > Webhooks > your webhook > Signing Secret |

## Testing

```bash
bun test
```

Unit tests cover the pure utility functions: Zendesk URL and auth builders, webhook payload parsing, and HMAC signature verification.

## Project structure

```
route-urgent-tickets-agent/
├── agent/
│   ├── index.ts        # Agent definition, tools, and Zendesk webhook server
│   ├── utils.ts        # Zendesk and PagerDuty API helpers
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Webhook** — Zendesk sends `POST` payloads to port `3000`

## Observability

The webhook handler responds `200` immediately and processes tickets asynchronously. Each outcome emits a structured JSON log line searchable by `ticket_id`:

| `event` | Meaning |
|---------|---------|
| `webhook.processed` | Agent completed successfully |
| `webhook.failed` | Agent threw — ticket was received but **not** processed |

**Important:** there is no retry mechanism. If processing fails (LLM error, Zendesk/PagerDuty API down, missing env var), the ticket is dropped. Monitor your logs for `webhook.failed` entries and re-trigger manually if needed. For production use, consider routing the webhook through a queue (e.g. SQS, BullMQ) with retry and dead-letter support.

## Model

Uses `openai/gpt-4.1` via the Astro-managed OpenAI integration.

## Agent directory

View this agent on Astropods: [astropods.com/astro-ai/route-urgent-tickets-agent](https://astropods.com/astro-ai/route-urgent-tickets-agent)
