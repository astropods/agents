# Trip Planner Agent

[![Deploy on Astropods](../assets/deploy-button.svg)](https://astropods.com/astro-ai/trip-planner-agent)

An Astro agent that plans multi-day trips from a plain language request. It checks the weather, searches Yelp for activities and restaurants, and writes a structured day-by-day itinerary and packing list directly to your Notion workspace.

## Workflow

1. **Parse request** — Extracts destination, travel dates, and preferences from your message
2. **Weather** — Fetches live forecast data (future trips) or historical weather (past dates) via Open-Meteo
3. **Yelp search** — Finds local activities and dining options matching your preferences
4. **Write to Notion** — Creates a trip page with a day-by-day schedule database and a packing list

## Quick start

```bash
# Configure credentials (Yelp, Notion, OpenAI)
ast configure

# Start the agent locally
ast dev
```

## Usage

Describe your trip in plain language:

> *"Plan a 3-day trip to Paris from June 10–12. I enjoy art museums and fine dining."*

> *"I'm going to Tokyo next weekend, October 18–20. Suggest outdoor activities and ramen spots."*

The more context you provide (travel style, interests, dietary preferences), the better the itinerary.

## Tools

| Tool | Description |
|------|-------------|
| `get_todays_date` | Returns today's date and day of week |
| `get_weather_forecast` | 7-day forecast from Open-Meteo |
| `get_historical_weather` | Past weather from Open-Meteo archive |
| `search_yelp` | Search local businesses via Yelp Fusion |
| `create_notion_trip_plan_template` | Create a Notion page and daily schedule database |
| `add_weather_to_notion_database` | Add a daily row to the schedule database |

## Environment variables

All runtime credentials are managed by `ast configure` — no manual `.env` file needed.

| Variable | Source | Description |
|----------|--------|-------------|
| `OPENAI_API_KEY` | Auto-injected | OpenAI model API key |
| `YELP_API_KEY` | `ast configure` | Yelp Fusion API key — from [Yelp Developer portal](https://www.yelp.com/developers) |
| `NOTION_BEARER_TOKEN` | `ast configure` | Notion integration token — from [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| `NOTION_PARENT_PAGE_ID` | `ast configure` | ID of the Notion page under which trip pages will be created |

## Testing

```bash
bun test
```

Unit tests cover weather helpers, Yelp search, and Notion page creation using mocked `fetch`.

## Project structure

```
trip-planner-agent/
├── agent/
│   ├── index.ts            # Agent definition, instructions, and tool registration
│   ├── tools/
│   │   ├── date.ts         # Today's date helper
│   │   ├── weather.ts      # Open-Meteo forecast and historical weather
│   │   ├── yelp.ts         # Yelp Fusion search
│   │   └── notion.ts       # Notion page, database, and entry creation
│   └── tests/
│       ├── date.test.ts
│       ├── weather.test.ts
│       ├── yelp.test.ts
│       └── notion.test.ts
├── astropods.yml            # Agent specification (models, integrations)
├── Dockerfile               # Agent container image
├── tsconfig.json
└── package.json
```

## Interfaces

- **Web** — Playground available at `localhost:3000` during `ast dev`
- **Slack** — Bot integration via Socket Mode (mention the bot or reply in a thread)

## Model

Uses `openai/gpt-4.1` via the Astro-managed OpenAI integration.

## Agent directory

View this agent on Astropods: [astropods.com/astro-ai/trip-planner-agent](https://astropods.com/astro-ai/trip-planner-agent)
