# Astropods Skills for Claude Code

A collection of [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills) for building, migrating, and documenting agents on the Astropods platform.

| Skill | Purpose |
|-------|---------|
| [agent-card](./agent-card.md) | Create or update an `AGENT.md` for an Astropods agent, conforming to the agent card spec. |
| [build-astropods-agent](./build-astropods-agent.md) | Recipes for building a Mastra + Astropods agent — project layout, `astropods.yml`, interfaces, models, knowledge, tools. |
| [migrate-to-astropods](./migrate-to-astropods.md) | Port an existing agent to run on Astropods by adding `astropods.yml`, a `Dockerfile`, and adapters for telemetry. |

## What is a skill?

A skill is a single Markdown file with YAML frontmatter that Claude Code loads when its `description` matches the user's request. The frontmatter looks like this:

```markdown
---
name: agent-card
description: Create or update the AGENT.md for the current Astropods agent project.
---

# Steps Claude should follow...
```

The body is plain instructions — Claude reads it the same way it reads any other context.

## Installing these skills

Skills can be installed at the user level (available in every project) or at the project level (committed alongside the code).

### User-level — available everywhere

Copy the files into `~/.claude/skills/`:

```bash
mkdir -p ~/.claude/skills
cp agent-card.md build-astropods-agent.md migrate-to-astropods.md ~/.claude/skills/
```

### Project-level — checked into a repo

Drop them into `.claude/skills/` at the root of the target project:

```bash
mkdir -p .claude/skills
cp agent-card.md build-astropods-agent.md migrate-to-astropods.md .claude/skills/
```

Restart Claude Code (or start a new session) for the skills to be picked up.

## Using a skill

Once installed, Claude Code invokes a skill automatically when your prompt matches its description. You can also trigger one explicitly by name:

```
/agent-card
/migrate-to-astropods
/build-astropods-agent
```

To see which skills are loaded, run `/help` inside Claude Code.

## Authoring your own

Add a new `.md` file with the same frontmatter shape. Keep the `description` specific — it is what Claude matches against to decide whether the skill applies. The body should describe the steps to take, constraints to respect, and anything Claude would otherwise have to rediscover each session.
