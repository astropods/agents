---
description: "Receives Zendesk ticket webhooks, applies relevant tags using AI, and routes urgent tickets to the correct PagerDuty team."
tags:
  - zendesk
  - pagerduty
  - support
  - triage
  - routing
  - openai
  - customer-support
capabilities:
  - "Analyse ticket content and apply relevant Zendesk tags automatically"
  - "Route urgent tickets (outage, security, P1/P2) to the correct PagerDuty service"
  - "Create PagerDuty incidents with the Zendesk ticket URL in the description"
  - "Accept Zendesk webhooks via the agent's HTTPS endpoint or ticket IDs via chat"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: route-urgent-tickets-agent
integrations:
  - OpenAI
  - Zendesk
  - PagerDuty
---

# Route Urgent Tickets Agent

Automatically triages incoming Zendesk tickets. Uses GPT-4.1 to analyse ticket content, apply relevant tags, and route urgent issues to the correct PagerDuty service (e.g. IAM, Platform). Standard tickets are tagged only — no escalation.

## How it works

**New ticket webhook:**
1. Reads ticket ID and description from the webhook payload
2. Fetches all existing Zendesk tags and selects the most relevant ones
3. Updates the ticket with the selected tags
4. Assesses urgency from the description and tags:
   - **Urgent** (outage, security, data loss, P1/P2) → fetches PagerDuty services → creates incident routed to the correct team
   - **Standard** → stops after tagging

## Webhook setup

Configure a Zendesk webhook to `POST` to your agent's URL:
- **Trigger:** Ticket created → send to `https://<your-agent-url>`

**Payload format** (set this as the webhook body template in Zendesk):

```json
{
  "detail": {
    "id": "{{ticket.id}}",
    "description": "{{ticket.description}}"
  }
}
```

Zendesk automatically signs each request with an HMAC-SHA256 signature using your `WEBHOOK_SECRET` and adds the `x-zendesk-webhook-signature` and `x-zendesk-webhook-signature-timestamp` headers. The agent verifies these on every request.

**Testing locally** — generate the signature manually:

```bash
SECRET="your-webhook-secret"
TIMESTAMP=$(date -u +%s)
BODY='{"detail":{"id":"12345","description":"The login page returns a 500 error for all users. Service is completely down."}}'
SIG=$(printf '%s' "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -X POST https://<agent-url>/ \
  -H "Content-Type: application/json" \
  -H "x-zendesk-webhook-signature: $SIG" \
  -H "x-zendesk-webhook-signature-timestamp: $TIMESTAMP" \
  -d "$BODY"
```

## Usage via web chat or Slack

| Message | Effect |
|---------|--------|
| `12345` | Triage ticket #12345 |
| `check ticket 12345` | Any text containing a ticket ID |
| `{"detail":{"id":"12345","description":"..."}}` | Full webhook payload |

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `ZENDESK_SUBDOMAIN` | The `{subdomain}` in `https://{subdomain}.zendesk.com` |
| `ZENDESK_USERNAME` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | Zendesk API token |
| `ZENDESK_TICKET_URL` | Base ticket URL e.g. `https://mycompany.zendesk.com/agent/tickets` |
| `PAGERDUTY_API_KEY` | PagerDuty REST API key |
| `PAGERDUTY_FROM_EMAIL` | Email for PagerDuty `From` header (required by PagerDuty API) |
| `WEBHOOK_SECRET` | Zendesk webhook signing secret — used to verify HMAC-SHA256 signatures on incoming requests |
