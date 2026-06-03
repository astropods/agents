import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import axios, { type AxiosError } from "axios";
import OpenAI from "openai";
import { z } from "zod";
import type { JiraTicket } from "./utils";
import {
  buildBasicAuthHeader,
  buildJiraRequestBody,
  extractSlackIds,
  fetchSlackThread,
  parseJiraTicket,
  validateSubdomain,
} from "./utils";

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Jira helpers
// ---------------------------------------------------------------------------

async function generateJiraTicket(message: string): Promise<JiraTicket> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a project manager creating Jira tickets. Return ONLY a JSON object with these exact keys:
  "title": "Short, actionable ticket title (max 100 chars)",
  "description": "Detailed description of the issue, including context, steps to reproduce if applicable, and expected vs actual behavior"`,
      },
      {
        role: "user",
        content: `Message/Thread:\n${message}`,
      },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  return parseJiraTicket(raw);
}

async function createJiraTicket(ticket: JiraTicket): Promise<string> {
  const subdomain = process.env.JIRA_SUBDOMAIN;
  const username = process.env.JIRA_USERNAME;
  const apiKey = process.env.JIRA_API_KEY;
  const projectId = process.env.JIRA_PROJECT_ID;

  if (!subdomain || !username || !apiKey || !projectId) {
    throw new Error(
      "Missing required Jira environment variables: JIRA_SUBDOMAIN, JIRA_USERNAME, JIRA_API_KEY, JIRA_PROJECT_ID",
    );
  }

  const baseUrl = `https://${validateSubdomain(subdomain)}.atlassian.net`;
  const response = await axios.post(
    `${baseUrl}/rest/api/3/issue`,
    buildJiraRequestBody(ticket, projectId),
    {
      headers: {
        Authorization: buildBasicAuthHeader(username, apiKey),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  const issueKey: string = response.data.key;
  return `${baseUrl}/browse/${issueKey}`;
}

// ---------------------------------------------------------------------------
// Mastra tool
// ---------------------------------------------------------------------------

const createJiraFromContext = createTool({
  id: "create_jira_ticket",
  description:
    "Generate and create a Jira ticket from a problem description or a Slack thread URL. " +
    "Call this whenever the user describes an issue or pastes a Slack thread URL.",
  inputSchema: z.object({
    text: z
      .string()
      .describe(
        "Problem description or a Slack thread URL (https://workspace.slack.com/archives/.../p...)",
      ),
  }),
  execute: async ({ text }: { text: string }) => {
    try {
      let content = text;
      if (extractSlackIds(text) !== null) {
        const slackToken = process.env.SLACK_BOT_TOKEN;
        if (!slackToken) {
          return "A Slack thread URL was provided but SLACK_BOT_TOKEN is not configured. Set SLACK_BOT_TOKEN to enable thread fetching, or paste the thread content directly.";
        }
        content = await fetchSlackThread(text, slackToken);
      }
      const ticket = await generateJiraTicket(content);
      const ticketUrl = await createJiraTicket(ticket);
      return `Jira ticket created: ${ticketUrl}\n\nTitle: ${ticket.title}\n\nDescription: ${ticket.description}`;
    } catch (err) {
      if (err instanceof SyntaxError) {
        return `Failed to parse OpenAI response as JSON: ${err.message}`;
      }
      if (err instanceof OpenAI.APIError) {
        return `OpenAI error (${err.status ?? "unknown"}): ${err.message}`;
      }
      if (axios.isAxiosError(err)) {
        const axErr = err as AxiosError<{
          errorMessages?: string[];
          errors?: Record<string, string>;
        }>;
        const status = axErr.response?.status;
        const jiraMsg =
          axErr.response?.data?.errorMessages?.[0] ??
          Object.values(axErr.response?.data?.errors ?? {}).join("; ");
        if (status === 401) {
          return "Jira authentication failed: check JIRA_API_KEY and JIRA_USERNAME.";
        }
        if (status === 400) {
          return `Jira rejected the request: ${jiraMsg || "bad request"}`;
        }
        if (status === 403) {
          return "Jira permission denied: ensure the account has permission to create issues in this project.";
        }
        if (status === 404) {
          return `Jira project not found: check JIRA_SUBDOMAIN and JIRA_PROJECT_ID.`;
        }
        return `Jira API error (${status ?? "network"}): ${jiraMsg || axErr.message}`;
      }
      const message = err instanceof Error ? err.message : String(err);
      return `Failed to create Jira ticket: ${message}`;
    }
  },
});

// ---------------------------------------------------------------------------
// Mastra agent
// ---------------------------------------------------------------------------

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "slack-jira-agent",
  name: "Slack to Jira Agent",
  instructions: `You are an assistant that creates Jira tickets. When a user sends ANY message, immediately call the create_jira_ticket tool with their message and return the result verbatim. Never ask for clarification or additional detail — always create the ticket with whatever information is provided.`,
  model: "openai/gpt-4o-mini",
  memory,
  tools: { create_jira_ticket: createJiraFromContext },
});

new Mastra({ agents: { "slack-jira-agent": agent } });

serve(new MastraAdapter(agent));
