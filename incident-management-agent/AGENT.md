---
description: "Slack-triggered incident management agent that tracks incidents in Notion and keeps summaries updated in real time."
tags:
  - slack
  - notion
  - incident-management
  - openai
  - devops
capabilities:
  - "Create a new incident record in Notion when triggered by an @mention in Slack"
  - "Track all incidents in a Notion database with status and severity"
  - "Generate and update detail summary, engineering update, and support update per incident"
  - "Detect duplicate incidents based on timestamps and existing Notion records"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: incident-management-agent
integrations:
  - OpenAI
  - Slack (via built-in adapter)
  - Notion
---

# Incident Manager Agent

An incident is declared in Slack — the agent takes it from there. It logs the incident in Notion and keeps the detail summary, engineering update, and support update current as the conversation unfolds.

## Triggers

- **@mention in Slack** (`@incident-manager start incident: <name>`): Creates a new incident page in Notion.
- **Follow-up @mentions**: Uses conversation context to determine whether to create a new incident or update an existing one.

## Tools

| Tool | Description |
|---|---|
| `fetch_list_of_incidents_from_notion` | Lists all incidents from the Notion database |
| `create_new_incident_in_notion` | Creates a new incident page in Notion |
| `update_notion_incident_page` | Updates status, severity, and summary blocks on an existing page |

## Environment variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `NOTION_API_KEY` | Notion integration secret |
| `NOTION_DATABASE_ID` | Notion database ID for the incident log (treated as a secret) |
