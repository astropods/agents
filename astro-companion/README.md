# astro-companion

Your friendly guide to building and publishing Astro agents — from idea to live registry entry.

## Quick start

```bash
bun install
ast dev
```

## Project structure

```
astro-companion/
├── agent/
│   └── index.ts          # Agent entry point
├── astropods.yml          # Agent specification
├── Dockerfile             # Agent container
├── .env                   # Environment variables (set via ast configure; not committed)
└── package.json
```

## Configuration

| Integration | Type | Environment variable |
|------------|------|---------------------|
| Anthropic | Model API | `ANTHROPIC_API_KEY` |
