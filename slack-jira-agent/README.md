# Slack to Jira Agent

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/slack-jira-agent)

An Astro agent that turns a problem description into a Jira ticket in seconds. Describe the issue in plain text — from the web playground or directly in Slack — and the agent generates a concise title and detailed description, creates the ticket, and returns the link.

## Workflow

1. **Receive message** — User sends a problem description via web chat or Slack
2. **Generate content** — GPT-4o mini drafts a concise title (max 100 chars) and a detailed ticket description
3. **Create ticket** — POSTs the ticket to Jira as a `Task` under the configured project
4. **Return link** — Responds with the direct Atlassian URL to the created ticket

## Quick start

```bash
# Configure credentials (Jira, OpenAI, Slack)
ast configure

# Start the agent locally
ast dev
```

## Usage

Send a problem description or a Slack thread URL — the more context the better:

**Examples:**
- *"Login button broken on mobile Safari — users get a 403 after OAuth redirect"*
- *"Checkout flow crashes when applying a discount code on the order summary page"*
- *"Need to add rate limiting to the /api/export endpoint — currently no limits in place"*
- *`https://myworkspace.slack.com/archives/C01234/p1234567890123456`* — paste a thread URL to create a ticket directly from the conversation (requires `SLACK_BOT_TOKEN`)

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `JIRA_API_KEY` | `ast configure` | Jira API token — from [Atlassian account security settings](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_USERNAME` | `ast configure` | Jira account email address |
| `JIRA_SUBDOMAIN` | `ast configure` | Subdomain for your Atlassian instance (e.g. `mycompany`) |
| `JIRA_PROJECT_ID` | `ast configure` | Jira project key (e.g. `PROJ`) |
| `SLACK_BOT_TOKEN` | `ast configure` | *(Optional)* Slack Bot token (`xoxb-…`) — required only when pasting a Slack thread URL; needs `channels:history` scope |

## Testing

```bash
bun test
```

Unit tests cover the Jira API client and ticket creation helpers using mocked `fetch`.

## Project structure

```
slack-jira-agent/
├── agent/
│   ├── index.ts        # Agent definition, instructions, and tool registration
│   ├── utils.ts        # Jira API helpers
│   └── utils.test.ts   # Unit tests
├── astropods.yml        # Agent specification (models, integrations)
├── Dockerfile           # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Bot integration via Socket Mode; your team can create Jira tickets from any channel by messaging the bot

## Model

Uses `openai/gpt-4o-mini` via the Astro-managed OpenAI integration.

## Agent directory

View this agent on Astropods: [astropods.com/astro-ai/slack-jira-agent](https://astropods.com/astro-ai/slack-jira-agent)
