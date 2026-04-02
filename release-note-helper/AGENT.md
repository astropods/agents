---
description: An agent that helps you craft release notes from Jira issues and GitHub PRs
model: anthropic/claude-sonnet-4-5
interfaces: [web, slack]
integrations: [jira, github]
knowledge: preferences (Redis)
repository:
  type: git
  url: "https://github.com/astropods/agents"
  directory: release-note-helper
---

Guides you through the full release note workflow: queries Jira for completed issues, helps you curate which ones belong in the release, verifies linked GitHub PRs, and drafts a formatted release note matching your team's style.

Remembers your preferences (default project, GitHub repo, selection criteria, release note format) across sessions.

## What you can ask

- "Draft release notes for PROJ issues closed in the last 2 weeks"
- "Show me all Done issues for the API project since Monday"
- "Skip internal issues and infrastructure changes"
- "Check if the linked PRs are merged"
- "Format this like our last release note"
- "Save this format as my default"

## Workflow

1. **Query Jira** — fetch issues moved to "Done" for a project and date range
2. **Candidate selection** — agent evaluates each issue against your saved criteria
3. **User review** — accept, reject, or override recommendations interactively
4. **PR verification** — confirm GitHub PRs are merged and tagged
5. **Draft** — generate a formatted release note matching your saved example

## Tools

| Tool | Description |
|------|-------------|
| `searchJiraIssues` | Search Jira for issues by project, status, and date range |
| `getJiraIssueDetails` | Fetch full details for a specific issue |
| `checkGithubPRs` | Look up linked PRs, merge status, and release tags |
| `loadPreferences` | Read saved preferences from Redis |
| `savePreferences` | Persist preferences (project, repo, criteria, format) to Redis |

## Persistent storage

- **Conversation memory** — LibSQL for chat history across sessions
- **User preferences** — Redis for structured settings (survives restarts)

## Guardrails

Input prompt-injection detection via Lakera Guard.
