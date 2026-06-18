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
  - "Fetch a Zoom meeting transcript via OAuth2"
  - "Extract action items from the call, prepended with the account name"
  - "Create Zendesk support tickets for issues identified in the call"
  - "Create a Notion page with the call summary and action items"
  - "Return a Slack-formatted action item list with ticket links"
  - "Accept a meeting ID via webhook POST or direct chat message"
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

Send a Zoom meeting ID via chat or Slack:

> *"87654321098"*

Or trigger it via webhook (e.g. from a Zoom recording-ready automation):

```bash
curl -X POST https://<agent-url> \
  -H "Content-Type: application/json" \
  -d '{"meetingId": "87654321098"}'
```

## What the response includes

- **Action items** — numbered list, each prepended with the account name
- **Zendesk tickets** — ID and link for any support issue raised during the call
- **Notion page** — link to the newly created call summary page

## Tools

| Tool | Description |
|---|---|
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
| `WEBHOOK_SECRET` | Optional bearer token to authenticate incoming webhook requests (treated as a secret) |

## Limitations

- Fetches cloud recordings only; local Zoom recordings are not supported.
- Requires a completed transcript (`status: completed`) — in-progress or processing recordings will return an error.
- Zendesk tickets are created with the agent email as requester; the sales rep is not automatically assigned unless configured in Zendesk automation rules.
- Notion output is plain text paragraphs; rich formatting (tables, checkboxes) is not used.
