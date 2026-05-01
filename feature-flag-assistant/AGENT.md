---
description: "Identifies feature flag code that can be removed and old feature flags to be deleted"
tags: ["feature-flags", "launchdarkly", "cleanup"]
capabilities:
  - "Identify LaunchDarkly flags fully rolled out to 100% in production for 2+ weeks"
  - "Identify LaunchDarkly flags with zero code references"
  - "Search GitHub for code references to a specific flag"
  - "Preview or manually send bi-weekly scheduled flag audit reports to Slack"
integrations:
  - "LaunchDarkly"
  - "GitHub"
  - "Slack"
repository:
  type: git
  url: "https://github.com/astropods/agents"
  directory: feature-flag-assistant
---

# Feature Flag Helper Agent

Helps engineering teams identify stale LaunchDarkly feature flags for cleanup.

## Capabilities

### Fully Rolled Out Flags
Flags that have been serving 100% of production traffic to their "on" variation for 2+ weeks.
The surrounding conditional code can be deleted and the "on" path hardcoded.

### Orphaned Flags (No Code References)
Flags that appear in LaunchDarkly but have zero references in any scanned repository.
These can be deleted directly from LaunchDarkly.

### Scheduled Slack Reports
A bi-weekly audit report is automatically posted to a configured Slack channel. The report highlights flags that newly crossed the 2-week rollout threshold and the 5 oldest flags still awaiting cleanup. The report schedule is configured at deploy time via the UI.

## Required Configuration

Set the following secrets before running:

| Variable | Required | Description |
|---|---|---|
| `LAUNCHDARKLY_API_KEY` | Yes | LD REST API key with `reader` role |
| `LAUNCHDARKLY_PROJECT_KEY` | No | LD project key (default: `default`) |
| `LAUNCHDARKLY_PRODUCTION_ENV` | No | LD production environment key (default: `production`) |
| `GITHUB_REPO` | No | Repository to search for flag code references (`owner/repo`) |
| `SLACK_NOTIFY_CHANNEL` | No | Slack channel ID or name to post scheduled audit reports to |

The LaunchDarkly API key needs:
- `reader` access to Flags
- `reader` access to Code References (for the no-code-refs tool)

Code References must be enabled in your LaunchDarkly project and at least one repository
scan must have run for the orphaned-flag tool to return data.

## Example Prompts

- "Which feature flags can I clean up?"
- "Show me flags that have been fully rolled out to production for over 2 weeks"
- "List all flags with no code references"
- "Give me details on the flag `my-flag-key`"
