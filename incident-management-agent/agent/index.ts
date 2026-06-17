import { createHmac, timingSafeEqual } from "node:crypto";
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

function notionApiKey(): string {
  const k = process.env.NOTION_API_KEY;
  if (!k) throw new Error("NOTION_API_KEY is not set");
  return k;
}

function notionDatabaseId(): string {
  const d = process.env.NOTION_DATABASE_ID;
  if (!d) throw new Error("NOTION_DATABASE_ID is not set");
  return d;
}

function slackSigningSecret(): string {
  const s = process.env.SLACK_SIGNING_SECRET;
  if (!s) throw new Error("SLACK_SIGNING_SECRET is not set");
  return s;
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

const INSTRUCTIONS = `You are responsible for managing an ongoing incident.

When you receive a slash command (check for the "command" field), use the command text as the incident name and create a new incident in Notion. Do nothing else for this step.

When you receive message events (no "command" field), use the conversation context to decide whether to create a new incident or update an existing one — check existing incidents and take timestamps into account.

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

// ---------------------------------------------------------------------------
// Slack webhook HTTP server (port 3000)
// ---------------------------------------------------------------------------

Bun.serve({
  port: 3000,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Read raw body first — HMAC is computed on the raw bytes.
    const rawBody = await req.text();

    // Slack signature verification per https://api.slack.com/authentication/verifying-requests-from-slack
    const ts = req.headers.get("x-slack-request-timestamp") ?? "";
    const sig = req.headers.get("x-slack-signature") ?? "";

    // Reject requests older than 5 minutes to prevent replay attacks.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      return new Response("Unauthorized", { status: 401 });
    }

    const expected = `v0=${createHmac("sha256", slackSigningSecret()).update(`v0:${ts}:${rawBody}`).digest("hex")}`;
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (
      sigBuf.length !== expectedBuf.length ||
      !timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Slack URL verification handshake — required when saving Event Subscription URL.
    if (
      typeof payload === "object" &&
      payload !== null &&
      (payload as Record<string, unknown>).type === "url_verification"
    ) {
      const challenge = (payload as Record<string, unknown>).challenge;
      return new Response(JSON.stringify({ challenge }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Respond immediately to Slack (<3s required), process async.
    // NOTE: failures are logged but not retried — monitor logs for
    // webhook.failed events to catch dropped payloads.
    const eventTs =
      (payload as { event?: { ts?: string } })?.event?.ts ?? "unknown";
    agent
      .generate(JSON.stringify(payload))
      .then((result) =>
        console.log(
          JSON.stringify({
            event: "webhook.processed",
            event_ts: eventTs,
            summary: result.text?.slice(0, 200),
          }),
        ),
      )
      .catch((err) =>
        console.error(
          JSON.stringify({
            event: "webhook.failed",
            event_ts: eventTs,
            error: err instanceof Error ? err.message : String(err),
          }),
          err,
        ),
      );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});

console.log("Slack webhook server listening on :3000");

serve(new MastraAdapter(agent));
