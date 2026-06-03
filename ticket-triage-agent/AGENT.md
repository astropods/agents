---
description: "Automatically triages Zendesk support tickets using AI — resolves with Pinecone knowledge base or escalates to human agents via Slack."
tags:
  - zendesk
  - support
  - triage
  - pinecone
  - openai
  - customer-support
capabilities:
  - "Auto-resolve common support tickets using a Pinecone vector knowledge base"
  - "Escalate unresolved tickets by notifying via the active adapter (web or Slack)"
  - "Learn from human-solved tickets by indexing new Q&A pairs into Pinecone"
  - "Accept Zendesk webhooks directly on port 3000 or ticket IDs via chat"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: ticket-triage-agent
integrations:
  - OpenAI
  - Zendesk
  - Pinecone
  - Slack (via built-in adapter)
---

# Customer Ticket Triage Agent

Automatically triages incoming Zendesk support tickets. Uses a Pinecone vector knowledge base to auto-resolve common questions, escalates to human agents via Slack when unsure, and learns from human-solved tickets.

## How it works

**New ticket (`ticket.created`):**
1. Fetches full ticket details from Zendesk
2. Searches Pinecone for similar known Q&A pairs
3. If confident match found (score > 0.85) — replies professionally and sets status to `pending`
4. If no confident match — replies that a human agent will follow up, sets status to `open`

**Solved ticket (`ticket.status_changed → SOLVED`):**
1. Fetches all ticket comments
2. Checks if the ticket was resolved by a human agent (not a bot)
3. Searches Pinecone to avoid duplicate entries
4. If human-solved and not a duplicate — adds clean Q&A pair to Pinecone

## Ticket status meanings

| Status | Meaning |
|--------|---------|
| `open` | Pending on customer support |
| `pending` | Waiting on the customer |
| `solved` | Customer is happy with the resolution |

## Webhook setup

Configure a Zendesk webhook to `POST` to your agent's URL on port `3000`:
- **Trigger 1:** Ticket created → send to `https://<your-agent-url>:3000`
- **Trigger 2:** Ticket status changed to Solved → send to `https://<your-agent-url>:3000`

## Usage

**Via Slack DM or web chat — send any of:**

| Message | Effect |
|---------|--------|
| `12345` | Triage ticket #12345 |
| `check ticket 12345` | Any text containing a ticket ID |
| `{"type":"zen:event-type:ticket.created","detail":{"id":"12345"}}` | Full webhook payload |

## Required environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods — used for both reasoning (GPT-4o mini) and embeddings |
| `ZENDESK_SUBDOMAIN` | The `{subdomain}` in `https://{subdomain}.zendesk.com` |
| `ZENDESK_AGENT_EMAIL` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | Zendesk API token |
| `PINECONE_HOST` | Full Pinecone index host URL |
| `PINECONE_API_KEY` | Pinecone API key |
| `WEBHOOK_SECRET` | Zendesk webhook signing secret — used to verify HMAC-SHA256 signatures on incoming requests |

## Slack integration

Deploy with the Slack adapter to enable direct Slack interaction. When the agent cannot resolve a ticket, it replies in the channel — no separate Slack bot token required. Enable at deploy time via `ast project configure`.
