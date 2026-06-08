import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { type ConversationStream, MessagingClient } from "@astropods/messaging";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import cron from "node-cron";
import { z } from "zod";
import {
  getCalendarEvents,
  refreshGoogleToken,
  searchHubSpotDeals,
  searchZendeskTickets,
} from "./utils";

// ---------------------------------------------------------------------------
// Env guards
// ---------------------------------------------------------------------------

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getCalendarEventsTool = createTool({
  id: "get_calendar_events",
  description:
    "Fetches calendar events from Google Calendar. Defaults to today. Returns a list of events with attendees.",
  inputSchema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
      .optional()
      .describe("ISO date YYYY-MM-DD to fetch events for. Defaults to today."),
  }),
  execute: async ({ date }: { date?: string }) => {
    const accessToken = await refreshGoogleToken(
      env("GOOGLE_CLIENT_ID"),
      env("GOOGLE_CLIENT_SECRET"),
      env("GOOGLE_REFRESH_TOKEN"),
    );
    const events = await getCalendarEvents(
      accessToken,
      env("GOOGLE_CALENDAR_ID"),
      date,
    );
    return JSON.stringify(events);
  },
});

const getZendeskTicketsTool = createTool({
  id: "get_zendesk_tickets",
  description:
    "Searches Zendesk for open tickets matching a customer name or email domain. Use this to find support context before a meeting.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Customer name, email, or domain to search open tickets for"),
  }),
  execute: async ({ query }: { query: string }) => {
    const tickets = await searchZendeskTickets(
      env("ZENDESK_URL"),
      env("ZENDESK_EMAIL"),
      env("ZENDESK_API_KEY"),
      query,
    );
    return JSON.stringify(tickets);
  },
});

const getHubSpotDealsTool = createTool({
  id: "get_hubspot_deals",
  description:
    "Searches HubSpot for open deals matching a company name. Use this to find sales context before a meeting.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Company or deal name to search active deals for"),
  }),
  execute: async ({ query }: { query: string }) => {
    const deals = await searchHubSpotDeals(env("HUBSPOT_API_KEY"), query);
    return JSON.stringify(deals);
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are a pre-meeting assistant. Your job is to prepare a concise customer brief for all meetings scheduled today.

When asked to generate the daily brief:
1. Call get_calendar_events to fetch today's events.
2. For each meeting that has external attendees (not just internal team members), extract the attendee domain or company name.
3. For each external attendee, call get_zendesk_tickets and get_hubspot_deals using their domain or company name.
4. Compose a brief with one section per meeting. Each section should include:
   - Meeting title, time, and attendees
   - Open Zendesk tickets: ticket ID, subject, status, priority
   - Active HubSpot deals: deal name, amount, stage, expected close date
5. Keep it factual and actionable. If there are no tickets or deals, say so briefly.
6. Omit internal-only meetings (meetings where all attendees share the same domain).`;

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "customer-meetings-agent",
  name: "Customer Meetings Agent",
  instructions: INSTRUCTIONS,
  model: "openai/o3",
  memory,
  tools: {
    get_calendar_events: getCalendarEventsTool,
    get_zendesk_tickets: getZendeskTicketsTool,
    get_hubspot_deals: getHubSpotDealsTool,
  },
});

new Mastra({ agents: { "customer-meetings-agent": agent } });

// ---------------------------------------------------------------------------
// Proactive Slack egress via MessagingClient bidi stream (section 7B / 8)
// ---------------------------------------------------------------------------

const messagingClient = new MessagingClient(
  process.env.GRPC_SERVER_ADDR || "localhost:9090",
);
const ready = messagingClient.connectWithRetry({
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  jitter: true,
});

let conv: ConversationStream | null = null;
ready.then(() => {
  conv = messagingClient.createConversationStream();
  conv.on("error", (e) => console.error("[messaging] bidi stream error", e));
  console.log("[messaging] bidi stream connected");
});

function postToSlack(channelId: string, body: string): void {
  if (!conv) {
    console.warn("[messaging] bidi stream not ready, dropping message");
    return;
  }
  conv.sendAgentResponse({
    conversationId: channelId,
    content: { type: "REPLACE", content: body },
  });
  conv.sendAgentResponse({
    conversationId: channelId,
    content: { type: "END", content: "" },
  });
}

// ---------------------------------------------------------------------------
// Cron — daily brief (section 9)
// ---------------------------------------------------------------------------

const CRON_RESOURCE_ID = "cron-scheduler";
const running = new Set<string>();

async function runDailyBrief(): Promise<void> {
  const name = "daily-brief";
  if (running.has(name)) return;
  running.add(name);
  try {
    const result = await agent.generate(
      "Generate the daily pre-meeting customer brief for today.",
      {
        memory: {
          thread: `cron:${name}:${Date.now()}`,
          resource: CRON_RESOURCE_ID,
        },
      },
    );
    const channelId = process.env.SLACK_CHANNEL;
    if (channelId && result.text) {
      postToSlack(channelId, result.text);
    }
    console.log("[cron] daily-brief complete");
  } catch (e) {
    console.error("[cron] daily-brief failed:", e);
  } finally {
    running.delete(name);
  }
}

// Default: weekdays at 8 AM
const cronExpr = process.env.CRON_SCHEDULE || "0 8 * * 1-5";
if (cron.validate(cronExpr)) {
  cron.schedule(cronExpr, () => {
    void runDailyBrief();
  });
  console.log(`[cron] scheduled daily brief: ${cronExpr}`);
} else {
  console.error(`[cron] invalid CRON_SCHEDULE: ${cronExpr}`);
}

// Memory TTL sweep — prune cron threads older than 24 h (section 10)
setInterval(
  async () => {
    try {
      const { threads } = await memory.listThreads({
        filter: { resourceId: CRON_RESOURCE_ID },
        perPage: false,
      });
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const t of threads) {
        const ts = Number(t.id.split(":").pop());
        if (Number.isFinite(ts) && ts < cutoff) await memory.deleteThread(t.id);
      }
    } catch (e) {
      console.error("[memory-sweep] error:", e);
    }
  },
  60 * 60 * 1000,
).unref();

// ---------------------------------------------------------------------------
// Start serving
// ---------------------------------------------------------------------------

serve(new MastraAdapter(agent));
