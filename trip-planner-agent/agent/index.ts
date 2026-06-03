import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { getTodaysDate } from "./tools/date";
import {
  addWeatherToNotionDatabase,
  createNotionTripPlanTemplate,
} from "./tools/notion";
import { getHistoricalWeather, getWeatherForecast } from "./tools/weather";
import { searchYelp } from "./tools/yelp";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getTodaysDateTool = createTool({
  id: "get_todays_date",
  description:
    "Returns today's date and day of week. Use this to determine whether trip dates are in the past (use historical weather) or future (use forecast).",
  inputSchema: z.object({}),
  execute: async () => JSON.stringify(getTodaysDate()),
});

const getWeatherForecastTool = createTool({
  id: "get_weather_forecast",
  description:
    "Gets weather forecast for future dates at a location. Resolve city names to latitude/longitude from your training knowledge.",
  inputSchema: z.object({
    latitude: z.number().describe("Latitude of the destination"),
    longitude: z.number().describe("Longitude of the destination"),
    start_date: z.string().describe("Start date in YYYY-MM-DD format"),
    end_date: z.string().describe("End date in YYYY-MM-DD format"),
  }),
  execute: async ({
    latitude,
    longitude,
    start_date,
    end_date,
  }: {
    latitude: number;
    longitude: number;
    start_date: string;
    end_date: string;
  }) =>
    JSON.stringify(
      await getWeatherForecast(latitude, longitude, start_date, end_date),
    ),
});

const getHistoricalWeatherTool = createTool({
  id: "get_historical_weather",
  description: "Gets historical weather data for past dates at a location.",
  inputSchema: z.object({
    latitude: z.number().describe("Latitude of the destination"),
    longitude: z.number().describe("Longitude of the destination"),
    start_date: z.string().describe("Start date in YYYY-MM-DD format"),
    end_date: z.string().describe("End date in YYYY-MM-DD format"),
  }),
  execute: async ({
    latitude,
    longitude,
    start_date,
    end_date,
  }: {
    latitude: number;
    longitude: number;
    start_date: string;
    end_date: string;
  }) =>
    JSON.stringify(
      await getHistoricalWeather(latitude, longitude, start_date, end_date),
    ),
});

const searchYelpTool = createTool({
  id: "search_yelp",
  description:
    'Searches Yelp for local businesses, activities, and restaurants at the destination. Call multiple times for different categories (e.g. "restaurants", "museums", "outdoor activities").',
  inputSchema: z.object({
    term: z
      .string()
      .describe(
        'Search term e.g. "restaurants", "museums", "outdoor activities"',
      ),
    location: z.string().describe("City or address to search near"),
    limit: z.number().min(1).max(50).describe("Max results to return (1-50)"),
  }),
  execute: async ({
    term,
    location,
    limit,
  }: {
    term: string;
    location: string;
    limit: number;
  }) => JSON.stringify(await searchYelp(term, location, limit)),
});

const createNotionTripPlanTemplateTool = createTool({
  id: "create_notion_trip_plan_template",
  description:
    "Creates a Notion page with a Trip Schedule database and Packing List. Call this FIRST before adding daily entries. Returns trip_page_id and trip_schedule_database_id needed for subsequent calls.",
  inputSchema: z.object({
    trip_page_title: z
      .string()
      .describe('Title for the trip page e.g. "Paris Trip - June 2025"'),
    packing_list: z
      .array(z.string())
      .describe("List of items to pack for the trip"),
  }),
  execute: async ({
    trip_page_title,
    packing_list,
  }: {
    trip_page_title: string;
    packing_list: string[];
  }) =>
    JSON.stringify(
      await createNotionTripPlanTemplate(trip_page_title, packing_list),
    ),
});

const addWeatherToNotionDatabaseTool = createTool({
  id: "add_weather_to_notion_database",
  description:
    "Adds a single day's entry to the Notion trip schedule database. Call once per day of the trip after create_notion_trip_plan_template.",
  inputSchema: z.object({
    trip_schedule_database_id: z
      .string()
      .describe("Database ID returned by create_notion_trip_plan_template"),
    day_of_week: z.string().describe('e.g. "Monday"'),
    trip_date: z.string().describe("Date in YYYY-MM-DD format"),
    weather_summary: z.string().describe("Weather description for the day"),
    activities_planned: z.string().describe("Activities planned for the day"),
    dining_plan: z.string().describe("Dining plans for the day"),
  }),
  execute: async ({
    trip_schedule_database_id,
    day_of_week,
    trip_date,
    weather_summary,
    activities_planned,
    dining_plan,
  }: {
    trip_schedule_database_id: string;
    day_of_week: string;
    trip_date: string;
    weather_summary: string;
    activities_planned: string;
    dining_plan: string;
  }) =>
    JSON.stringify(
      await addWeatherToNotionDatabase(
        trip_schedule_database_id,
        day_of_week,
        trip_date,
        weather_summary,
        activities_planned,
        dining_plan,
      ),
    ),
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "trip-planner",
  name: "Trip Planner",
  instructions:
    "You are a trip planning agent. Use the tools available to you to plan a trip and fulfill the user request. Make sure to use all info to account for how to best answer their question.",
  model: "openai/gpt-4.1",
  memory,
  tools: {
    get_todays_date: getTodaysDateTool,
    get_weather_forecast: getWeatherForecastTool,
    get_historical_weather: getHistoricalWeatherTool,
    search_yelp: searchYelpTool,
    create_notion_trip_plan_template: createNotionTripPlanTemplateTool,
    add_weather_to_notion_database: addWeatherToNotionDatabaseTool,
  },
});

new Mastra({ agents: { "trip-planner": agent } });

serve(new MastraAdapter(agent));
