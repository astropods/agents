---
description: "Fetches a Zoom call transcript, extracts action items, creates Zendesk tickets for issues, and writes a call summary to Notion."
tags:
  - zoom
  - zendesk
  - notion
  - sales
  - customer-success
  - openai
  - follow-up
capabilities:
  - "Accept a meeting ID via webhook POST, chat, or Slack — extracts it from natural language automatically"
  - "Fetch a Zoom meeting transcript via OAuth2"
  - "Extract action items from the call, prepended with the account name"
  - "Create Zendesk support tickets for issues identified in the call"
  - "Create a Notion page with the call summary and action items"
  - "Return a clear summary with action items, ticket links, and Notion page link"
  - "Report a friendly error when the transcript is still processing"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: customer-call-follow-up-agent
integrations:
  - OpenAI
  - Zoom
  - Zendesk
  - Notion
  - Slack (via built-in adapter)
---

# Customer Call Follow-Up Agent

Your call just ended and the action items are still in your head. Customer Call Follow-Up Agent reads the Zoom transcript, pulls out every commitment and next step, raises Zendesk tickets for any issues that came up, and drops a clean summary into Notion — then posts the formatted action list wherever you're working.

## Usage

### Chat or Slack

Send a message containing the Zoom meeting ID — it can be a plain ID or natural language:

> *"87654321098"*
> *"Can you process my call with Acme from this morning — meeting 876 5432 1098"*

The agent extracts and validates the meeting ID (9–11 digit number) from your message automatically.

### Webhook

Trigger the agent programmatically by posting the meeting ID explicitly (e.g. from a Zoom recording-ready automation):

```bash
curl -X POST https://<agent-url> \
  -H "Content-Type: application/json" \
  -d '{"meetingId": "87654321098"}'
```

If `WEBHOOK_SECRET` is set, include the bearer token:

```bash
curl -X POST https://<agent-url> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-secret>" \
  -d '{"meetingId": "87654321098"}'
```

If the transcript is still processing, the agent will respond with a clear message to try again in a few minutes.

## What the response includes

- **Action items** — numbered list, each prepended with the account name
- **Zendesk tickets** — ID and link for any support issue raised during the call
- **Notion page** — link to the newly created call summary page

## Tools

| Tool | Description |
|---|---|
| `extract_meeting_id` | Extracts and validates a Zoom meeting ID (9–11 digit number) from free-form text |
| `get_zoom_transcript` | Refreshes OAuth token and downloads the VTT transcript for the meeting |
| `create_zendesk_ticket` | Creates a support ticket for issues found in the call |
| `update_notion_page` | Creates a Notion child page with the call summary and action items |

## Environment variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `ZOOM_CLIENT_ID` | Zoom marketplace app client ID |
| `ZOOM_CLIENT_SECRET` | Zoom marketplace app client secret |
| `ZOOM_REFRESH_TOKEN` | OAuth2 refresh token — obtained by completing Zoom OAuth authorization |
| `ZENDESK_SUBDOMAIN` | Zendesk subdomain (the `{subdomain}` in `https://{subdomain}.zendesk.com`) |
| `ZENDESK_AGENT_EMAIL` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | Zendesk API token |
| `NOTION_API_KEY` | Notion internal integration secret — from [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| `NOTION_PARENT_PAGE_ID` | ID of the Notion page that holds all call summary pages |
| `WEBHOOK_SECRET` | Bearer token to authenticate incoming webhook requests — required; all requests without a valid `Authorization: Bearer <token>` header are rejected with 401 |

## Limitations

- Meeting IDs must be 9–11 digit numbers (standard Zoom format). Vanity meeting URLs are not supported.
- Fetches cloud recordings only; local Zoom recordings are not supported.
- Requires a completed transcript (`status: completed`) — processing recordings return a friendly error; retry once Zoom finishes processing.
- Zendesk tickets are created with the agent email as requester; the sales rep is not automatically assigned unless configured in Zendesk automation rules.
- Notion output is plain text paragraphs; rich formatting (tables, checkboxes) is not used.
