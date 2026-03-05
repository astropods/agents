# release-note-helper

Helps craft release notes from Jira issues and GitHub PRs. Queries Jira for completed issues in a date range, lets the user accept/deny candidates, verifies linked PRs on GitHub, and drafts a formatted release note.

Uses Redis (Astro-provided) for per-user preferences and LibSQL for conversation memory.

## Jira provider

Jira is declared as a custom provider in `astropods.yml`. The platform injects:

- `JIRA_BASE_URL` — Jira instance URL
- `JIRA_EMAIL` — Atlassian account email
- `JIRA_API_KEY` — Atlassian API token (secret)
