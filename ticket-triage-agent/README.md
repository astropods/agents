# Customer Ticket Triage Agent

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/ticket-triage-agent)

An Astro agent that automatically triages incoming Zendesk support tickets. It searches a Pinecone vector knowledge base to auto-resolve common questions, escalates unresolved tickets via Slack, and learns from human-solved tickets by indexing new Q&A pairs back into Pinecone.

## Workflow

**New ticket (`ticket.created`):**
1. Fetch full ticket details from Zendesk
2. Search Pinecone for similar known Q&A pairs
3. If confident match (score > 0.85) — reply and set status to `pending`
4. If no match — reply that a human agent will follow up, set status to `open`

**Solved ticket (`ticket.status_changed → SOLVED`):**
1. Fetch all ticket comments
2. Check if resolved by a human agent (not a bot)
3. Search Pinecone to avoid duplicate entries
4. If human-solved and unique — index the new Q&A pair into Pinecone

## Quick start

```bash
# Configure credentials (Zendesk, Pinecone, OpenAI)
ast configure

# Start the agent locally
ast dev
```

## Webhook setup

Configure two Zendesk webhooks to `POST` to your agent URL on port `3000`:

- **Trigger 1:** Ticket created → `https://<agent-url>:3000`
- **Trigger 2:** Ticket status changed to Solved → `https://<agent-url>:3000`
- **Signing:** Enable webhook signing in Zendesk and copy the signing secret into `WEBHOOK_SECRET`. The agent verifies the `x-zendesk-webhook-signature` HMAC-SHA256 header on every request and rejects anything that doesn't match.

## Usage via chat

You can also trigger the agent manually from the web playground or Slack:

| Message | Effect |
|---------|--------|
| `12345` | Triage ticket #12345 |
| `check ticket 12345` | Any message containing a ticket ID |
| `{"type":"zen:event-type:ticket.created","detail":{"id":"12345"}}` | Full webhook payload |

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | Used for both reasoning (GPT-4o mini) and embeddings |
| `ZENDESK_SUBDOMAIN` | `ast configure` | The `{subdomain}` in `https://{subdomain}.zendesk.com` |
| `ZENDESK_AGENT_EMAIL` | `ast configure` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | `ast configure` | Zendesk API token — from Zendesk Admin > Apps & Integrations > API |
| `PINECONE_HOST` | `ast configure` | Full Pinecone index host URL — from [Pinecone console](https://app.pinecone.io) |
| `PINECONE_API_KEY` | `ast configure` | Pinecone API key — from [Pinecone console](https://app.pinecone.io) |
| `WEBHOOK_SECRET` | `ast configure` | Zendesk webhook signing secret — copy from Zendesk Admin > Webhooks > your webhook > Signing Secret |

## Testing

```bash
bun test
```

Unit tests cover the pure utility functions: Zendesk URL and auth builders, webhook payload parsing, and HMAC signature verification.

## Project structure

```
ticket-triage-agent/
├── agent/
│   ├── index.ts        # Agent definition, tools, and Zendesk webhook server
│   ├── utils.ts        # Zendesk and Pinecone API helpers
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Deploy with the Slack adapter to receive escalation notifications directly in a channel
- **Webhook** — Zendesk sends `POST` payloads to port `3000`

## Model

Uses `openai/gpt-4o-mini` via the Astro-managed OpenAI integration.

## Agent directory

View this agent on Astropods: [astropods.com/astro-ai/ticket-triage-agent](https://astropods.com/astro-ai/ticket-triage-agent)
