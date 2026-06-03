---
description: "Turns a problem description or a Slack thread URL into a Jira ticket in seconds using GPT-4o mini."
tags:
  - jira
  - slack
  - productivity
  - project-management
  - openai
  - issue-tracking
capabilities:
  - "Create a Jira task from a plain-text problem description"
  - "Fetch a Slack thread by URL and create a ticket from the conversation content"
  - "Generate a concise title and detailed description using GPT-4o mini"
  - "Return the direct Atlassian URL to the created ticket"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: slack-jira-agent
integrations:
  - OpenAI
---

# Slack to Jira Agent

The bug is sitting in a Slack thread and nobody has filed a ticket yet. Slack to Jira Agent takes a problem description — typed directly or pasted from a conversation — and turns it into a properly formatted Jira task in seconds. Works from the web playground or directly in Slack via the Slack adapter.

## Usage

Send a message in one of two ways:

Describe the problem in plain text — the more context the better:

**Examples:**
- *"Login button broken on mobile Safari — users get a 403 after OAuth redirect"*
- *"Checkout flow crashes when applying a discount code on the order summary page"*

## What happens

1. GPT-4o mini generates a concise ticket title (max 100 chars) and a detailed description
2. The ticket is created in Jira as a `Task` under the configured project
3. The agent returns the direct link to the created ticket

## Slack integration

The agent supports both the **web** and **Slack** adapters. Enable the Slack adapter at deploy time and your team can create Jira tickets directly from any Slack channel by messaging the bot — no copy-pasting into a web form.

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `JIRA_API_KEY` | Jira API token — from Atlassian account security settings |
| `JIRA_USERNAME` | Jira account email address |
| `JIRA_SUBDOMAIN` | Subdomain for your Atlassian instance (e.g. `mycompany`) |
| `JIRA_PROJECT_ID` | Jira project key (e.g. `PROJ`) |

## Limitations

- Creates tickets as `Task` type only; issue type is not configurable at runtime.
- Jira description is plain text (ADF paragraph); rich formatting is not preserved.
- Ticket quality depends on the detail in the description — the more context provided, the better the generated content.
