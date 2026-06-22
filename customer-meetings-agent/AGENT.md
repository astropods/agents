---
description: "Daily pre-meeting brief agent that fetches Google Calendar events, looks up Zendesk tickets and HubSpot deals per attendee, and posts a customer brief to Slack each weekday morning."
tags:
  - google-calendar
  - zendesk
  - hubspot
  - slack
  - openai
  - cron
capabilities:
  - "Fetch today's Google Calendar events"
  - "Look up open Zendesk tickets per meeting attendee"
  - "Look up active HubSpot deals per meeting attendee"
  - "Post a formatted pre-meeting customer brief to Slack on a cron schedule"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: customer-meetings-agent
integrations:
  - OpenAI
  - Google Calendar
  - Zendesk
  - HubSpot
  - Slack (via built-in adapter)
---

# Customer Meetings Agent

Runs every weekday morning and posts a pre-meeting brief to Slack. For each calendar event with external attendees, the agent looks up open Zendesk tickets and active HubSpot deals for those customers and formats a concise per-meeting summary.

## Triggers

- **Cron job** (default `0 8 * * 1-5`): Automatically generates and posts the brief each weekday at 8 AM. Override with the `CRON_SCHEDULE` env var.
- **Chat message**: Request a brief on demand via the web or Slack adapter.

## Tools

| Tool | Description |
|---|---|
| `get_calendar_events` | Fetches events from Google Calendar for a given date (defaults to today) |
| `get_zendesk_tickets` | Searches Zendesk for open tickets matching a customer name or email |
| `get_hubspot_deals` | Searches HubSpot for active deals matching a company name |

## Environment variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token for Calendar access |
| `GOOGLE_CALENDAR_ID` | Calendar ID to read events from (`primary` or a calendar email address) |
| `ZENDESK_URL` | Zendesk instance URL (e.g. `https://yourcompany.zendesk.com`) |
| `ZENDESK_EMAIL` | Zendesk agent email address (treated as a secret) |
| `ZENDESK_API_KEY` | Zendesk API token |
| `HUBSPOT_API_KEY` | HubSpot private app access token |
| `SLACK_CHANNEL` | Slack channel ID for the daily brief (optional) |
| `CRON_SCHEDULE` | Cron expression (default: `0 8 * * 1-5`) |
