# Release Note Helper

An Astro agent that helps craft release notes from Jira issues and GitHub pull requests. It queries Jira for completed issues, lets you curate the list interactively, verifies linked PRs on GitHub, and drafts a formatted release note matching your team's style.

## Workflow

1. **Query Jira** — Fetch issues moved to "Done" for a project and time range (e.g. "all PROJ issues in the past 2 weeks")
2. **Candidate selection** — The agent evaluates each issue against your stored criteria and recommends includes/skips
3. **User review** — Accept, reject, or override recommendations interactively
4. **PR verification** — Check GitHub for linked PRs, merge status, and release versions
5. **Draft release note** — Generate a formatted release note matching your saved example

The agent remembers your preferences (default project, GitHub repo, selection criteria, release note format) across sessions using Redis-backed storage.

## Quick start

```bash
# Configure credentials (Jira, Anthropic, GitHub, Slack)
ast configure

# Start the agent locally
ast dev
```

On first use the agent will walk you through onboarding to set your default project, GitHub repo, selection criteria, and a release note example.

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed for running the agent.

| Variable | Source | Description |
|----------|--------|-------------|
| `ANTHROPIC_API_KEY` | `ast configure` | Anthropic model API key |
| `GITHUB_TOKEN` | `ast configure` | GitHub integration token |
| `REDIS_HOST` / `REDIS_PORT` | Auto-injected (redis knowledge) | Redis for user preferences |
| `JIRA_BASE_URL` | `ast configure` (input) | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | `ast configure` (input) | Atlassian account email |
| `JIRA_API_KEY` | `ast configure` (input) | Atlassian API token (secret) |

The `.env.example` file is only needed for running evals locally (requires `ANTHROPIC_API_KEY`).

## Testing

Unit tests cover the three client modules and all five tool wrappers, using mocked `fetch` and Redis. Agent-level evals use Mastra scorers with mocked tools (no external services required).

```bash
# Run unit tests
bun x vitest run --project unit

# Run evals (needs ANTHROPIC_API_KEY in .env)
bun x vitest run --project evals
```

Copy `.env.example` and fill in your Anthropic key to run evals. All other credentials are handled by `ast configure`.

**Evals:**
- **Answer relevancy** — LLM-graded check that responses are relevant to prompts
- **Tool usage** — Verifies the agent calls tools instead of hallucinating data
- **Completeness** — Checks that all accepted issues appear in the generated release note

## Project structure

```
release-note-helper/
├── agent/
│   ├── index.ts              # Agent definition, instructions, and tool registration
│   └── tools/
│       ├── jira.ts           # searchJiraIssues, getJiraIssueDetails tools
│       ├── github.ts         # checkGithubPRs tool
│       └── preferences.ts   # loadPreferences, savePreferences tools
├── src/
│   ├── jira-client.ts        # Jira REST API client (search, issue details)
│   ├── github-client.ts      # GitHub REST API client (PR search, tags)
│   └── preferences-store.ts  # Redis-backed user preferences
├── test/evals/
│   ├── agent.eval.ts         # Agent-level evals (relevancy, tool usage, completeness)
│   ├── fixtures.ts           # Canned data and mocked tools for evals
│   └── setup.ts              # Loads .env for eval runs
├── vitest.config.ts          # Test runner config (unit + evals projects)
├── astropods.yml             # Agent specification (models, integrations, knowledge stores)
├── Dockerfile                # Agent container image
├── .env.example              # Environment variable template (Anthropic key for evals)
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Bot integration via Socket Mode (mention the bot or reply in a thread)

## Model

Uses `anthropic/claude-sonnet-4-5` via the Astro-managed Anthropic integration.

## Persistent storage

- **Conversation memory** — LibSQL (`file:./data/memory.db`) for chat history across sessions
- **User preferences** — Redis for structured settings (project, repo, criteria, release note example)
