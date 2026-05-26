# astropods

Claude Code skills for building, migrating, and documenting agents on the [Astropods](https://astropods.com) platform. Distributed as a [Claude Code plugin](https://code.claude.com/docs/en/plugins).

| Skill | Purpose |
|-------|---------|
| `agent-card` | Create or update an `AGENT.md` for an Astropods agent, conforming to the agent card spec. |
| `build-astropods-agent` | Recipes for building a Mastra + Astropods agent — project layout, `astropods.yml`, interfaces, models, knowledge, tools. |
| `migrate-to-astropods` | Port a net-new project to Astropods by adding `astropods.yml`, a `Dockerfile`, and `AGENT.md`. No agent logic is modified. |
| `wire-astropods-telemetry` | Wire up an Astropods adapter on an existing project so the platform can record OpenTelemetry traces and metrics. |

## Install

From inside Claude Code:

```
/plugin marketplace add astropods/agents
/plugin install astropods@astroai
```

## Use

Claude invokes a skill automatically when your prompt matches its description. Each skill below shows a natural-language prompt that auto-routes to it and the equivalent explicit slash command.

### `agent-card` — write or refresh `AGENT.md`

```
> Generate an AGENT.md for this project
> Update the agent card now that I've added a Slack integration
```

Explicit: `/astropods:agent-card`

Reads `astropods.yml` + source, writes/updates `AGENT.md` with the required frontmatter (`description`, `tags`, `capabilities`, `repository`, `integrations`) plus an Overview / Usage / Limitations body.

### `build-astropods-agent` — recipes for a Mastra agent

```
> Add a Postgres knowledge store to this agent
> How do I declare a custom Jira provider in astropods.yml?
> Set up the messaging interface so this agent runs in the playground
```

Explicit: `/astropods:build-astropods-agent`

Project layout, `astropods.yml` fragments, interfaces, models, knowledge, and tool wiring for Mastra + Astropods agents.

### `migrate-to-astropods` — port a net-new project

```
> Migrate this Python LangChain agent to Astropods
> Containerize this Mastra agent so I can run it with `ast project start`
```

Explicit: `/astropods:migrate-to-astropods`

Adds `astropods.yml`, a `Dockerfile`, and (optionally) `AGENT.md`. Does not modify agent code.

### `wire-astropods-telemetry` — add adapter + OpenTelemetry

```
> This agent runs on Astropods but no traces show up in the platform
> Wire up the Mastra adapter so runs are recorded
```

Explicit: `/astropods:wire-astropods-telemetry`

Installs the framework adapter (LangChain or Mastra) and replaces the entry point with `serve(...)` so OTEL traces flow to the platform. Agent construction code is untouched.

## Local development

Test changes without pushing to GitHub:

```
# point Claude Code at your working copy (the repo root, not the plugin dir)
/plugin marketplace add /path/to/agents

# install the plugin from the local marketplace
/plugin install astropods@astroai

# after editing a SKILL.md, refresh:
/plugin marketplace update astroai
```

To uninstall:

```
# remove just the plugin, keep the marketplace registered
/plugin uninstall astropods@astroai

# or remove the whole marketplace (also uninstalls plugins from it)
/plugin marketplace remove astroai
```

The marketplace name (`astroai`) comes from `marketplace.json`, not the local path you passed to `add`. Use `/plugin marketplace list` to confirm.

Validate the manifest and skill frontmatter from the shell:

```bash
claude plugin validate .                          # marketplace.json
claude plugin validate ./plugins/astropods        # plugin.json + each SKILL.md
```

## Authoring

Each skill lives under `skills/<name>/SKILL.md` with YAML frontmatter:

```markdown
---
description: One sentence describing when this skill applies.
---

Body — steps Claude should follow, constraints to respect, and anything it
would otherwise have to rediscover each session.
```

The directory name (`<name>`) is the skill's identifier. Keep `description` specific — Claude matches on it to decide whether the skill applies.
