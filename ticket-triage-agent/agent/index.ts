import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import axios from "axios";
import OpenAI from "openai";
import { z } from "zod";
import {
  buildZendeskAuth,
  buildZendeskBase,
  isTimestampFresh,
  parseWebhookPayload,
  verifyZendeskSignature,
} from "./utils";

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Zendesk helpers
// ---------------------------------------------------------------------------

function zendeskBase(): string {
  if (!process.env.ZENDESK_SUBDOMAIN)
    throw new Error("ZENDESK_SUBDOMAIN is not set");
  return buildZendeskBase(process.env.ZENDESK_SUBDOMAIN);
}

function zendeskAuth(): string {
  if (!process.env.ZENDESK_AGENT_EMAIL)
    throw new Error("ZENDESK_AGENT_EMAIL is not set");
  if (!process.env.ZENDESK_API_KEY)
    throw new Error("ZENDESK_API_KEY is not set");
  return buildZendeskAuth(
    process.env.ZENDESK_AGENT_EMAIL,
    process.env.ZENDESK_API_KEY,
  );
}

// ---------------------------------------------------------------------------
// Pinecone helpers
// ---------------------------------------------------------------------------

function pineconeHost(): string {
  if (!process.env.PINECONE_HOST) throw new Error("PINECONE_HOST is not set");
  return process.env.PINECONE_HOST;
}

function pineconeApiKey(): string {
  if (!process.env.PINECONE_API_KEY)
    throw new Error("PINECONE_API_KEY is not set");
  return process.env.PINECONE_API_KEY;
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    input: text,
    model: "text-embedding-3-small",
  });
  return response.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getZendeskTicketTool = createTool({
  id: "get_zendesk_ticket",
  description: "Get detailed information about a Zendesk ticket by ID.",
  inputSchema: z.object({
    ticket_id: z
      .string()
      .regex(/^\d+$/, "ticket_id must be numeric")
      .describe("The Zendesk ticket ID"),
  }),
  execute: async ({ ticket_id }: { ticket_id: string }) => {
    const { data } = await axios.get(`${zendeskBase()}/tickets/${ticket_id}`, {
      headers: { Authorization: `Basic ${zendeskAuth()}` },
    });
    return JSON.stringify(data.ticket);
  },
});

const retrieveEmbeddingsTool = createTool({
  id: "retrieve_embeddings",
  description:
    "Search Pinecone for similar known Q&A pairs using semantic similarity. Returns matches with similarity scores.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The question or problem description to search for"),
  }),
  execute: async ({ query }: { query: string }) => {
    const vector = await generateEmbedding(query);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data } = await axios.post(
          `${pineconeHost()}/query`,
          { vector, topK: 3, includeMetadata: true },
          {
            headers: {
              "Api-Key": pineconeApiKey(),
              "Content-Type": "application/json",
            },
          },
        );
        return JSON.stringify(data.matches);
      } catch (err) {
        if (
          axios.isAxiosError(err) &&
          err.response?.status === 429 &&
          attempt < 3
        ) {
          await new Promise((r) => setTimeout(r, attempt * 5000));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Pinecone query failed after 3 attempts");
  },
});

const updateZendeskTicketTool = createTool({
  id: "update_zendesk_ticket",
  description:
    "Update a Zendesk ticket status and post a public reply to the customer. Status meanings: open=pending on support, pending=waiting on customer, solved=customer is happy.",
  inputSchema: z.object({
    ticket_id: z
      .string()
      .regex(/^\d+$/, "ticket_id must be numeric")
      .describe("The Zendesk ticket ID"),
    status: z.enum(["open", "pending", "solved"]),
    comment: z.string().describe("Public reply to the customer"),
  }),
  execute: async ({
    ticket_id,
    status,
    comment,
  }: {
    ticket_id: string;
    status: string;
    comment: string;
  }) => {
    const { data } = await axios.put(
      `${zendeskBase()}/tickets/${ticket_id}`,
      { ticket: { status, comment: { body: comment, public: true } } },
      {
        headers: {
          Authorization: `Basic ${zendeskAuth()}`,
          "Content-Type": "application/json",
        },
      },
    );
    return JSON.stringify(data.ticket);
  },
});

const getSolvedTicketCommentsTool = createTool({
  id: "get_solved_ticket_comments",
  description:
    "Get all comments for a solved Zendesk ticket to extract Q&A knowledge.",
  inputSchema: z.object({
    ticket_id: z
      .string()
      .regex(/^\d+$/, "ticket_id must be numeric")
      .describe("The Zendesk ticket ID"),
  }),
  execute: async ({ ticket_id }: { ticket_id: string }) => {
    const { data } = await axios.get(
      `${zendeskBase()}/tickets/${ticket_id}/comments`,
      {
        headers: { Authorization: `Basic ${zendeskAuth()}` },
      },
    );
    return JSON.stringify(data.comments);
  },
});

const updatePineconeTool = createTool({
  id: "update_pinecone",
  description:
    "Add a new Q&A pair to the Pinecone knowledge base. Only call this for clean, concise Q&A pairs.",
  inputSchema: z.object({
    question: z
      .string()
      .describe("The customer question — concise, no superfluous text"),
    answer: z
      .string()
      .describe("The resolution — concise, no superfluous text"),
  }),
  execute: async ({
    question,
    answer,
  }: {
    question: string;
    answer: string;
  }) => {
    const vector = await generateEmbedding(question);
    const id = `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await axios.post(
      `${pineconeHost()}/vectors/upsert`,
      { vectors: [{ id, values: vector, metadata: { question, answer } }] },
      {
        headers: {
          "Api-Key": pineconeApiKey(),
          "Content-Type": "application/json",
        },
      },
    );
    return JSON.stringify({ id, question, answer });
  },
});

const lookupZendeskAgentTool = createTool({
  id: "lookup_zendesk_agent",
  description:
    "Look up a Zendesk user/agent by ID to determine if they are a human agent (not a bot).",
  inputSchema: z.object({
    agent_id: z
      .string()
      .regex(/^\d+$/, "agent_id must be numeric")
      .describe("The Zendesk user/agent ID"),
  }),
  execute: async ({ agent_id }: { agent_id: string }) => {
    const { data } = await axios.get(`${zendeskBase()}/users/${agent_id}`, {
      headers: { Authorization: `Basic ${zendeskAuth()}` },
    });
    return JSON.stringify(data.user);
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are a customer support triage agent connected to Zendesk.

If given a bare ticket ID number (e.g. "12345"), treat it as a ticket.created event for that ticket.

When you receive a webhook payload:

FOR ticket.created events:
1. Get the ticket details using get_zendesk_ticket
2. Search for similar known answers using retrieve_embeddings
3. If you find a highly confident match (score > 0.85), reply professionally and update the ticket to "pending" status
4. If the customer confirms satisfaction, update to "solved"
5. If no confident answer found, reply explaining you cannot resolve it and that a human agent will follow up, then update the ticket to "open"
6. Never mark a ticket as solved unless the customer is clearly happy with the resolution

FOR ticket.status_changed to SOLVED events:
1. Get the solved ticket comments using get_solved_ticket_comments
2. Check who solved it using lookup_zendesk_agent — only proceed if it was a human agent (not a bot)
3. Search Pinecone to check if this Q&A already exists using retrieve_embeddings
4. If it's a human-solved ticket and the question isn't already in Pinecone (score < 0.9), add it with update_pinecone
5. Extract only the core question and answer — no ticket numbers, greetings, or superfluous text

Status meanings:
- open: pending on customer support
- pending: waiting on the customer
- solved: customer is happy with the resolution`;

// In-memory storage: conversation context is scoped to the current process.
// Each webhook event is self-contained so this is fine for triage processing.
// For persistent multi-turn Slack/web chat, replace ":memory:" with a
// platform-provided LibSQL URL via the Astropods deploy config.
const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "ticket-triage-agent",
  name: "Customer Ticket Triage Agent",
  instructions: INSTRUCTIONS,
  model: "openai/gpt-4o-mini",
  memory,
  tools: {
    get_zendesk_ticket: getZendeskTicketTool,
    retrieve_embeddings: retrieveEmbeddingsTool,
    update_zendesk_ticket: updateZendeskTicketTool,
    get_solved_ticket_comments: getSolvedTicketCommentsTool,
    update_pinecone: updatePineconeTool,
    lookup_zendesk_agent: lookupZendeskAgentTool,
  },
});

new Mastra({ agents: { "ticket-triage-agent": agent } });

// ---------------------------------------------------------------------------
// Startup env validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = [
  "ZENDESK_SUBDOMAIN",
  "ZENDESK_AGENT_EMAIL",
  "ZENDESK_API_KEY",
  "PINECONE_HOST",
  "PINECONE_API_KEY",
  "WEBHOOK_SECRET",
] as const;

const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Zendesk webhook HTTP server (port 3000)
// ---------------------------------------------------------------------------

Bun.serve({
  port: Number(process.env.PORT) || 80,
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
    if (!isTimestampFresh(ts)) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!verifyZendeskSignature(rawBody, ts, sig, secret)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = parseWebhookPayload(rawBody);
    if (!payload) {
      return new Response("Invalid JSON", { status: 400 });
    }

    const p = payload as { detail?: { id?: string } };
    const ticketId = p.detail?.id ?? "(unknown)";

    // Respond immediately to Zendesk, process async.
    // NOTE: failures are logged but not retried — check logs for entries with
    // event "webhook.failed" to identify dropped tickets.
    agent
      .generate(
        `Zendesk webhook received:\n\n${JSON.stringify(payload, null, 2)}`,
      )
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
        ),
      );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});

console.log(
  `Zendesk webhook server listening on :${Number(process.env.PORT) || 80}`,
);

serve(new MastraAdapter(agent));
