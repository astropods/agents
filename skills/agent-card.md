---
name: agent-card
description: Create or update the AGENT.md for the current Astropods agent project.
---

Create or update the `AGENT.md` for the current Astropods agent project, conforming to the agent card spec at https://docs.astropods.com/agent-card-spec.md.

## Steps

1. Fetch the spec from https://docs.astropods.com/agent-card-spec.md to make sure you are using the latest version before generating the file.

2. Check for a spec file in the project root: prefer `astropods.yml`; if absent, look for `astroai.yml`. If `astroai.yml` is found, rename it to `astropods.yml` before proceeding.

3. Read the spec file to extract the agent name, integrations (for deriving known integration labels), and any existing `meta.description` or `meta.tags` to migrate. Then evaluate the agent name:
   - If the name is unclear, date-based, or otherwise not descriptive (e.g. a name derived from a date, an internal codename, or a generic placeholder), suggest a better name based on what the agent does.
   - If the name is not scoped to an organization (i.e. does not follow the `@org/name` pattern), ask the user whether it should be scoped and what organization prefix to use. Apply the scope once confirmed.
   - Update the `name` field in `astropods.yml` only after confirmation from the user.

4. Explore the project to understand what the agent does — read the spec file and collect all `build.context` paths declared across containers. Read source files within those directories to understand each container's role, logic, data sources, tools used, and processing pipeline.

5. Read any other source code and existing documentation to infer purpose, capabilities, and integrations not declared in the spec.

6. Write the `AGENT.md` to the project root (same level as `astropods.yml`) with:
   - YAML frontmatter: `description`, `tags`, `authors`, `capabilities`, `repository`, `integrations` (all optional per spec)
   - Markdown body: Overview, Usage, Limitations sections at minimum

## Constraints

- `description`: single sentence or short phrase, under 200 characters
- `tags`: lowercase, letters/numbers/hyphens only
- `capabilities`: verb phrases under 100 characters each
- `integrations`: use known integration display names from the spec (e.g. GitHub, Slack, Jira) where applicable; arbitrary strings are allowed for unknowns
- `repository`: populate from the git remote URL. Use `github:org/repo` string shorthand when the agent is at the repo root. Use the object form (`type`, `url`, `directory`) when the agent lives in a subdirectory of the repo (e.g. a monorepo). Derive the subdirectory path relative to the repo root. Omit the field entirely if no git remote is configured.
- `authors`: omit entirely if you don't know who to credit — an empty `authors: []` adds nothing. Include `account` on an entry only if the author's platform handle is known.

## Body composition

The body is free-form GitHub-Flavored Markdown. Use the following patterns where they help the agent's story land:

- **Lead with a hook.** Open the body with a relatable problem statement or motivation, not a dry restatement of the frontmatter `description`. The description is for cards and sidebars; the body has room to evoke why the agent exists.

- **Show concrete examples.** For chat-driven agents, embed at least one literal example prompt in quotes — e.g. *Ask it "what did I save last week about CSS animations?"* Real-feeling examples beat abstract verb phrases.

- **Use bold inline labels in feature lists.** `- **Feature name** — short description` is far more scannable than plain bullets or full sentences.

- **Include a screenshot when there is a UI.** Use `![alt text](https://...)` inline. Images must be hosted at an external URL (e.g. `i.ibb.co`, `raw.githubusercontent.com`); relative repo paths usually do not render where the card is displayed.

- **Hero image and centered headline are permitted.** For agents with branding, the body MAY open with a small centered logo and project name before the Overview:

  ```html
  <div align="center">
    <img src="https://.../logo.png" alt="ProjectName" width="200">
  </div>
  <h1 align="center">project-name</h1>
  ```

  Skip if there is no logo — do not invent one.

## Migration

If `astropods.yml` contains `meta.description` or `meta.tags`, move those values into the agent card frontmatter. Do not remove them from `astropods.yml` unless the user explicitly asks.

## Notes

- If an `AGENT.md` already exists, update it rather than overwriting — preserve any existing body content the author wrote.
- Do not invent capabilities or integrations that are not evident from the code or config.
- Do not create a git branch by default. If the user explicitly asks for the work to land on a feature branch (e.g. `feat/agent-card`), create and switch to it before writing the file.
