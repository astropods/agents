import { timingSafeEqual } from "node:crypto";
import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import {
  createNotionPage,
  createZendeskTicket,
  getZoomTranscript,
  refreshZoomToken,
  validateMeetingId,
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
// Zoom token cache — serialised with a pending-promise lock to prevent
// concurrent refreshes from racing and invalidating each other's tokens.
// ---------------------------------------------------------------------------

let zoomRefreshToken: string | undefined;
let pendingTokenRefresh: Promise<string> | null = null;

function getZoomAccessToken(): Promise<string> {
  if (!pendingTokenRefresh) {
    pendingTokenRefresh = refreshZoomToken(
      env("ZOOM_CLIENT_ID"),
      env("ZOOM_CLIENT_SECRET"),
      zoomRefreshToken ?? env("ZOOM_REFRESH_TOKEN"),
    )
      .then(({ accessToken, refreshToken }) => {
        zoomRefreshToken = refreshToken;
        pendingTokenRefresh = null;
        return accessToken;
      })
      .catch((err) => {
        pendingTokenRefresh = null;
        throw err;
      });
  }
  return pendingTokenRefresh;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getZoomTranscriptTool = createTool({
  id: "get_zoom_transcript",
  description:
    "Fetches the transcript for a completed Zoom meeting recording using the meeting ID.",
  inputSchema: z.object({
    meeting_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, "must be alphanumeric")
      .describe("The Zoom meeting ID (numeric or UUID format)"),
  }),
  execute: async ({ meeting_id }: { meeting_id: string }) => {
    try {
      const accessToken = await getZoomAccessToken();
      return getZoomTranscript(accessToken, meeting_id);
    } catch (err) {
      console.error("[get_zoom_transcript] error:", err);
      throw err;
    }
  },
});

const createZendeskTicketTool = createTool({
  id: "create_zendesk_ticket",
  description:
    "Creates a Zendesk support ticket for a customer issue identified in the call transcript.",
  inputSchema: z.object({
    subject: z.string().describe("Short title for the ticket (max 150 chars)"),
    description: z
      .string()
      .describe(
        "Full description of the issue, including context from the call",
      ),
  }),
  execute: async ({
    subject,
    description,
  }: {
    subject: string;
    description: string;
  }) => {
    try {
      const result = await createZendeskTicket(
        env("ZENDESK_SUBDOMAIN"),
        env("ZENDESK_AGENT_EMAIL"),
        env("ZENDESK_API_KEY"),
        subject,
        description,
      );
      return result;
    } catch (err) {
      console.error("[create_zendesk_ticket] error:", err);
      throw err;
    }
  },
});

const updateNotionPageTool = createTool({
  id: "update_notion_page",
  description:
    "Creates a Notion page under the configured parent page with the call summary and action items.",
  inputSchema: z.object({
    title: z
      .string()
      .describe('Page title, e.g. "Acme Corp - Call Summary 2026-05-26"'),
    content: z
      .string()
      .describe("Full call summary and action items as plain text"),
  }),
  execute: async ({ title, content }: { title: string; content: string }) => {
    try {
      const result = await createNotionPage(
        env("NOTION_API_KEY"),
        env("NOTION_PARENT_PAGE_ID"),
        title,
        content,
      );
      return result;
    } catch (err) {
      console.error("[update_notion_page] error:", err);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are an AI assistant for sales reps. When given a Zoom meeting ID, follow these steps:

1. Call get_zoom_transcript with the meeting ID to retrieve the call transcript.
2. Read the transcript carefully to identify:
   - The account/company name of the customer
   - A list of action items (commitments made, next steps, follow-ups required)
   - Any support issues that require a Zendesk ticket
3. For each support issue, call create_zendesk_ticket. The sales rep is the ticket owner.
4. Call update_notion_page with title "<AccountName> - Call Summary <YYYY-MM-DD>" and the full summary including all action items.
5. Return a clean, Slack-friendly response with:
   - Bold header: "*📋 Post-Call Action Items — <AccountName>*"
   - Numbered action items, each prepended with the account name
   - Zendesk ticket IDs and URLs if any were created
   - Notion page link

If the transcript contains no action items, say so clearly. If Zendesk or Notion calls fail, note the failure but still return the action items.`;

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "customer-call-follow-up-agent",
  name: "Customer Call Follow-Up Agent",
  instructions: INSTRUCTIONS,
  model: "openai/gpt-4.1",
  memory,
  tools: {
    get_zoom_transcript: getZoomTranscriptTool,
    create_zendesk_ticket: createZendeskTicketTool,
    update_notion_page: updateNotionPageTool,
  },
});

new Mastra({ agents: { "customer-call-follow-up-agent": agent } });

// ---------------------------------------------------------------------------
// Webhook server (port 3000)
// ---------------------------------------------------------------------------

Bun.serve({
  port: 3000,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      const auth = req.headers.get("authorization") ?? "";
      const expected = `Bearer ${secret}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      const valid =
        authBuf.length === expectedBuf.length &&
        timingSafeEqual(authBuf, expectedBuf);
      if (!valid) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const rawId =
      typeof payload === "object" && payload !== null && "meetingId" in payload
        ? String((payload as Record<string, unknown>).meetingId)
        : null;

    if (!rawId) {
      return new Response(JSON.stringify({ error: "meetingId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let meetingId: string;
    try {
      meetingId = validateMeetingId(rawId);
    } catch {
      return new Response(
        JSON.stringify({ error: "invalid meetingId format" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // NOTE: failures are logged but not retried — monitor logs for
    // webhook.failed events to catch dropped payloads.
    agent
      .generate(`Process the Zoom call transcript for meeting ID: ${meetingId}`)
      .then((result) =>
        console.log(
          JSON.stringify({
            event: "webhook.processed",
            meeting_id: meetingId,
            summary: result.text?.slice(0, 200),
          }),
        ),
      )
      .catch((err) =>
        console.error(
          JSON.stringify({
            event: "webhook.failed",
            meeting_id: meetingId,
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

console.log("Webhook server listening on :3000");

serve(new MastraAdapter(agent));
