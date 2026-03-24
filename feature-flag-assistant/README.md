# feature-flag-helper-agent

Identifies stale LaunchDarkly feature flags eligible for cleanup: flags fully rolled out to production for 2+ weeks (code can be removed and hardcoded) and flags with no code references (safe to delete from LaunchDarkly). Sends scheduled audit reports to Slack and answers on-demand questions via web or Slack chat.

## Quick start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the agent locally
ast dev
```

## Project structure

```
feature-flag-helper-agent/
├── agent/
│   └── main.py           # Agent entry point (conversational tools + Slack adapter)
├── ingestion/
│   ├── report.py         # Scheduled report entrypoint (runs as a cron job)
│   ├── Dockerfile        # Ingestion container (lightweight — requests only)
│   └── requirements.txt  # Ingestion dependencies
├── src/
│   └── flags.py          # Shared LaunchDarkly logic used by agent and ingestion
├── astropods.yml         # Agent specification
├── Dockerfile            # Agent container
├── requirements.txt      # Agent Python dependencies
└── .env                  # Environment variables (set via ast configure; not committed)
```

## Configuration

The agent is configured in `astropods.yml`. Key sections:

### Integrations

| Integration | Type | Purpose |
|------------|------|---------|
| Anthropic | Model API | Powers conversational reasoning and tool selection |
| GitHub | Tool | Searches repositories for flag code references |

### Inputs

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAUNCHDARKLY_API_KEY` | Yes | — | LaunchDarkly REST API key with `reader` access to flags and code references |
| `LAUNCHDARKLY_PROJECT_KEY` | No | `default` | LaunchDarkly project key (e.g. your project slug) |
| `LAUNCHDARKLY_PRODUCTION_ENV` | No | `production` | LaunchDarkly environment key for production |
| `GITHUB_REPO` | No | — | GitHub repository to search for flag references (`owner/repo`) |
| `SLACK_NOTIFY_CHANNEL` | No | — | Slack channel ID or name to post scheduled audit reports to |

`SLACK_BOT_TOKEN` is provided automatically by the Slack adapter — no need to set it manually.

Set secrets via `ast configure` — do not commit them.

### Scheduled reports

The bi-weekly flag audit report is sent by the `ingestion/report.py` container, which runs as a platform-managed cron job. The schedule (e.g. every Monday at 9am) is configured at deploy time via the UI schedule picker — no code change required.

### Interfaces
- **Web** — HTTP/SSE endpoint (playground available at `localhost:3000` during dev)
- **Slack** — bot integration via Socket Mode
