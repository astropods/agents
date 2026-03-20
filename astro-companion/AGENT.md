---
description: "Your friendly guide to building and publishing Astro agents — from idea to live registry entry, step by step."
tags: ["productivity", "developer-tools", "astro"]
authors:
  - name: Taylor Green
    account: taylor
capabilities:
  - "Gathers agent requirements through conversational questions"
  - "Generates complete astropods.yml specs with correct schema"
  - "Writes runnable agent/index.ts with a detailed system prompt and Mastra setup"
  - "Writes AGENT.md cards with description, tags, and capabilities"
  - "Walks through scaffold, configure, dev, validate, and push steps interactively"
  - "Explains and troubleshoots any ast CLI command"
integrations:
  - "anthropic"
---

## Overview

Astro Companion guides you from a rough idea to a live entry in the Astro registry. It generates all three files you need — `astropods.yml`, `agent/index.ts`, and `AGENT.md` — then walks you through every step interactively: scaffold, configure, dev, validate, and push.

It meets you where you are. Starting from scratch? It'll take you through the whole flow. Already mid-process? Jump in at any step.

## Usage

Describe your agent idea and Astro Companion will ask a few focused questions:

- What it does and who it's for
- What models, knowledge stores, or integrations it needs
- What inputs users need to configure (API keys, options, etc.)
- A few example prompts

Then it generates all three files and guides you step by step through `ast create`, `ast configure`, `ast dev`, `ast playground`, and `ast push`.

## Example Prompts

- "I'm new to Astro — where do I start?"
- "Walk me through building my first agent"
- "I want to build an agent that reviews Figma designs and gives UX feedback"
- "Make me a spec for a Slack bot that summarizes long threads on demand"
- "I need an agent that answers questions about our internal docs stored in Notion"
- "Build a spec for a code review agent that checks PRs against our style guide"

## Limitations

- Assumes TypeScript/Bun (Mastra) as the runtime
- Generated agent logic is a strong starting point but may need tuning for complex tool integrations
