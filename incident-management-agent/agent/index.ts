import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import {
  createIncidentInNotion,
  fetchIncidentsFromNotion,
  updateIncidentInNotion,
} from "./utils";

// ---------------------------------------------------------------------------
// Env guards
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = ["NOTION_API_KEY", "NOTION_DATABASE_ID"] as const;
const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}`,
  );
}

function notionApiKey(): string {
  return process.env.NOTION_API_KEY ?? "";
}

function notionDatabaseId(): string {
  return process.env.NOTION_DATABASE_ID ?? "";
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const fetchIncidentsFromNotionTool = createTool({
  id: "fetch_list_of_incidents_from_notion",
  description: "Fetches the list of all incidents from the Notion database.",
  inputSchema: z.object({}),
  execute: async () => {
    return JSON.stringify(
      await fetchIncidentsFromNotion(notionApiKey(), notionDatabaseId()),
    );
  },
});

const createIncidentInNotionTool = createTool({
  id: "create_new_incident_in_notion",
  description:
    "Creates a new incident page in Notion with properties and summary blocks.",
  inputSchema: z.object({
    name: z.string().describe("Incident name"),
    incident_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
      .describe("Date in YYYY-MM-DD format"),
    status: z
      .enum(["Not started", "In progress", "Done"])
      .describe("Incident status"),
    severity_level: z
      .enum(["Critical", "High", "Medium", "Low"])
      .describe("Incident severity"),
    detail_summary: z.string().describe("Detailed summary of the incident"),
    engineering_update: z.string().describe("Update for the engineering team"),
    support_update: z.string().describe("Update for the support team"),
    slack_channel_id: z.string().describe("Slack channel ID for this incident"),
  }),
  execute: async (data: {
    name: string;
    incident_date: string;
    status: string;
    severity_level: string;
    detail_summary: string;
    engineering_update: string;
    support_update: string;
    slack_channel_id: string;
  }) => {
    return JSON.stringify(
      await createIncidentInNotion(notionApiKey(), notionDatabaseId(), data),
    );
  },
});

const updateIncidentInNotionTool = createTool({
  id: "update_notion_incident_page",
  description:
    "Updates an existing Notion incident page with new status, severity, and summary blocks.",
  inputSchema: z.object({
    page_id: z.string().describe("Notion page ID of the incident"),
    status: z
      .enum(["Not started", "In progress", "Done"])
      .describe("Incident status"),
    severity_level: z
      .enum(["Critical", "High", "Medium", "Low"])
      .describe("Incident severity"),
    detail_summary: z.string().describe("Detailed summary of the incident"),
    engineering_update: z.string().describe("Update for the engineering team"),
    support_update: z.string().describe("Update for the support team"),
  }),
  execute: async ({
    page_id,
    ...data
  }: {
    page_id: string;
    status: string;
    severity_level: string;
    detail_summary: string;
    engineering_update: string;
    support_update: string;
  }) => {
    return JSON.stringify(
      await updateIncidentInNotion(notionApiKey(), page_id, data),
    );
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are responsible for managing ongoing incidents. You are triggered by @mentions in Slack.

When a user declares a new incident (e.g. "@incident-manager start incident: DB outage"), create a new incident in Notion using the provided name. Do nothing else for this step.

For all other messages, use the conversation context to decide whether to create a new incident or update an existing one — check existing incidents and take timestamps into account.

Only update Notion when you have genuinely useful information. Don't update with filler content.

Acceptable values:
- status: Not started, In progress, Done
- severity_level: Critical, High, Medium, Low

Provide a detail_summary, engineering_update, and support_update as of the current timestamp.
Summary timestamps should be in the format: yyyy-mm-dd hh:mm am/pm (human readable).

Once an incident is resolved, close it. Only reopen if new information warrants it.`;

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "incident-manager-agent",
  name: "Incident Manager Agent",
  instructions: INSTRUCTIONS,
  model: "openai/gpt-4.1",
  memory,
  tools: {
    fetch_list_of_incidents_from_notion: fetchIncidentsFromNotionTool,
    create_new_incident_in_notion: createIncidentInNotionTool,
    update_notion_incident_page: updateIncidentInNotionTool,
  },
});

new Mastra({ agents: { "incident-manager-agent": agent } });

serve(new MastraAdapter(agent));
