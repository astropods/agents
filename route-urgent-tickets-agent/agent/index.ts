import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import axios from "axios";
import { z } from "zod";
import {
  buildZendeskAuth,
  buildZendeskBase,
  parseWebhookPayload,
  verifyZendeskSignature,
} from "./utils";

// ---------------------------------------------------------------------------
// Zendesk helpers
// ---------------------------------------------------------------------------

function zendeskBase(): string {
  if (!process.env.ZENDESK_SUBDOMAIN)
    throw new Error("ZENDESK_SUBDOMAIN is not set");
  return buildZendeskBase(process.env.ZENDESK_SUBDOMAIN);
}

function zendeskAuth(): string {
  if (!process.env.ZENDESK_USERNAME)
    throw new Error("ZENDESK_USERNAME is not set");
  if (!process.env.ZENDESK_API_KEY)
    throw new Error("ZENDESK_API_KEY is not set");
  return buildZendeskAuth(
    process.env.ZENDESK_USERNAME,
    process.env.ZENDESK_API_KEY,
  );
}

// ---------------------------------------------------------------------------
// PagerDuty helpers
// ---------------------------------------------------------------------------

function pagerdutyHeaders(): Record<string, string> {
  if (!process.env.PAGERDUTY_API_KEY)
    throw new Error("PAGERDUTY_API_KEY is not set");
  if (!process.env.PAGERDUTY_FROM_EMAIL)
    throw new Error("PAGERDUTY_FROM_EMAIL is not set");
  return {
    Authorization: `Token token=${process.env.PAGERDUTY_API_KEY}`,
    Accept: "application/vnd.pagerduty+json;version=2",
    From: process.env.PAGERDUTY_FROM_EMAIL,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const listZendeskTagsTool = createTool({
  id: "list_zendesk_tags",
  description:
    "Fetch all existing Zendesk tags so you can pick from real ones.",
  inputSchema: z.object({}),
  execute: async () => {
    const { data } = await axios.get(`${zendeskBase()}/tags`, {
      headers: { Authorization: `Basic ${zendeskAuth()}` },
    });
    return JSON.stringify(data.tags);
  },
});

const updateTicketTagsTool = createTool({
  id: "update_ticket_tags",
  description: "Apply selected tags to a Zendesk ticket.",
  inputSchema: z.object({
    ticket_id: z
      .string()
      .regex(/^\d+$/, "ticket_id must be numeric")
      .describe("The Zendesk ticket ID"),
    tags: z.array(z.string()).describe("Tags to apply to the ticket"),
  }),
  execute: async ({
    ticket_id,
    tags,
  }: {
    ticket_id: string;
    tags: string[];
  }) => {
    const { data } = await axios.put(
      `${zendeskBase()}/tickets/${ticket_id}/tags`,
      { tags },
      {
        headers: {
          Authorization: `Basic ${zendeskAuth()}`,
          "Content-Type": "application/json",
        },
      },
    );
    return JSON.stringify(data);
  },
});

const listPagerdutyServicesTool = createTool({
  id: "list_pagerduty_services",
  description:
    "Fetch available PagerDuty services to find the right team to route to.",
  inputSchema: z.object({}),
  execute: async () => {
    const { data } = await axios.get("https://api.pagerduty.com/services", {
      headers: pagerdutyHeaders(),
    });
    return JSON.stringify(data.services);
  },
});

const createPagerdutyIncidentTool = createTool({
  id: "create_pagerduty_incident",
  description: "Create a PagerDuty incident for an urgent ticket.",
  inputSchema: z.object({
    service_id: z.string().describe("The PagerDuty service ID to route to"),
    title: z.string().describe("Concise incident title"),
    description: z
      .string()
      .describe("Incident description — include the Zendesk ticket URL"),
  }),
  execute: async ({
    service_id,
    title,
    description,
  }: {
    service_id: string;
    title: string;
    description: string;
  }) => {
    const { data } = await axios.post(
      "https://api.pagerduty.com/incidents",
      {
        incident: {
          type: "incident",
          title,
          service: { id: service_id, type: "service_reference" },
          body: { type: "incident_body", details: description },
        },
      },
      { headers: pagerdutyHeaders() },
    );
    return JSON.stringify(data.incident);
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are a support ticket routing agent for Zendesk.

If given a bare ticket ID number (e.g. "12345"), treat it as a new ticket.created event for that ticket.

When you receive a ticket ID and description:

1. Fetch all available Zendesk tags using list_zendesk_tags
2. Analyse the description and select the most relevant tags
3. Update the ticket with those tags using update_ticket_tags
4. Assess urgency — if the ticket is high-priority or urgent (e.g. outage, service down, security vulnerability, data loss, P1/P2):
   a. Fetch PagerDuty services using list_pagerduty_services
   b. Select the most appropriate service based on the tags and description (e.g. IAM team, Platform team)
   c. Create a PagerDuty incident using create_pagerduty_incident — use a concise title and set the description to the Zendesk ticket URL
5. If the ticket is standard priority, stop after updating tags.

Respond with a brief summary: the tags applied, urgency level, and whether a PagerDuty incident was created.`;

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "route-urgent-tickets-agent",
  name: "Route Urgent Tickets Agent",
  instructions: INSTRUCTIONS,
  model: "openai/gpt-4.1",
  memory,
  tools: {
    list_zendesk_tags: listZendeskTagsTool,
    update_ticket_tags: updateTicketTagsTool,
    list_pagerduty_services: listPagerdutyServicesTool,
    create_pagerduty_incident: createPagerdutyIncidentTool,
  },
});

new Mastra({ agents: { "route-urgent-tickets-agent": agent } });

// ---------------------------------------------------------------------------
// Zendesk webhook HTTP server (port 3000)
// ---------------------------------------------------------------------------

Bun.serve({
  port: 3000,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const rawBody = await req.text();

    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      console.error("WEBHOOK_SECRET is not configured — rejecting webhook");
      return new Response("Webhook secret not configured", { status: 401 });
    }

    const sig = req.headers.get("x-zendesk-webhook-signature") ?? "";
    const ts = req.headers.get("x-zendesk-webhook-signature-timestamp") ?? "";
    if (!verifyZendeskSignature(rawBody, ts, sig, secret)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const p = parseWebhookPayload(rawBody) as {
      detail?: { id?: string; description?: string };
    } | null;
    if (!p) {
      return new Response("Invalid JSON", { status: 400 });
    }

    const ticketId = p?.detail?.id ?? "unknown";
    const description = p?.detail?.description ?? "";
    const ticketUrl = `${process.env.ZENDESK_TICKET_URL ?? ""}/${ticketId}`;
    const userMessage = `Ticket ID: ${ticketId}\nDescription: ${description}\nZendesk ticket URL: ${ticketUrl}`;

    // Respond immediately to Zendesk, process async.
    // NOTE: failures are logged but not retried — check logs for tickets that
    // did not produce a "processed" entry (searchable by ticket_id).
    agent
      .generate(userMessage)
      .then((result) =>
        console.log(
          JSON.stringify({
            event: "webhook.processed",
            ticket_id: ticketId,
            summary: result.text?.slice(0, 200),
          }),
        ),
      )
      .catch((err) =>
        console.error(
          JSON.stringify({
            event: "webhook.failed",
            ticket_id: ticketId,
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

console.log("Zendesk webhook server listening on :3000");

serve(new MastraAdapter(agent));
