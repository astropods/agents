---
description: "Plans multi-day trips: fetches live weather, searches Yelp for activities and dining, writes a structured itinerary and packing list to Notion"
tags:
  - travel
  - planning
  - notion
  - yelp
  - weather
  - openai
capabilities:
  - "Plan a multi-day trip itinerary from a natural language request"
  - "Fetch live weather forecasts (future trips) or historical weather (past dates)"
  - "Search Yelp for local activities and restaurant recommendations"
  - "Write the full itinerary to Notion: daily schedule database and packing list"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: trip-planner-agent
integrations:
  - OpenAI
  - "Open-Meteo"
  - "Yelp Fusion"
  - Notion
---

# Trip Planner

Describe a destination and travel dates in plain language — the agent does the rest. It checks the weather, scours Yelp for activities and restaurants, and writes a structured itinerary directly to your Notion workspace: a day-by-day schedule database and a packing list, all in one shot.

## Usage

Provide a destination, travel dates, and any preferences:

> *"Plan a 3-day trip to Paris from June 10–12. I enjoy art museums and fine dining."*

> *"I'm going to Tokyo next weekend, October 18–20. Suggest outdoor activities and ramen spots."*

The agent will:

1. Check today's date to determine whether to use forecast or historical weather data
2. Fetch weather for each day of the trip via Open-Meteo
3. Search Yelp for activities and restaurants matching your preferences
4. Create a Notion page with a day-by-day schedule database and a packing list

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `YELP_API_KEY` | Yelp Fusion API key — from the Yelp Developer portal |
| `NOTION_BEARER_TOKEN` | Notion integration token — from Notion integration settings |
| `NOTION_PARENT_PAGE_ID` | ID of the Notion page under which trip pages will be created |

## Limitations

- Weather uses Open-Meteo free tier; coordinates are resolved from GPT-4.1 training knowledge (not geocoding API). Timezone is inferred automatically from coordinates.
- Yelp results depend on the `YELP_API_KEY` having access to the Yelp Fusion API.
- Notion output uses a fixed schema (Day of Week, Date, Weather, Activities Planned, Dining); column layout is not configurable.
- Creates `Task` entries in Notion only — sub-tasks or nested pages are not supported.
