import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import axios, { type AxiosError } from "axios";
import { z } from "zod";
import type { JiraTicket } from "./utils";
import {
  buildBasicAuthHeader,
  buildJiraRequestBody,
  extractSlackIds,
  fetchSlackThread,
  validateSubdomain,
} from "./utils";

// ---------------------------------------------------------------------------
// Env guards
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = [
  "JIRA_API_KEY",
  "JIRA_USERNAME",
  "JIRA_SUBDOMAIN",
  "JIRA_PROJECT_ID",
] as const;

const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Jira helper
// ---------------------------------------------------------------------------

async function createJiraTicket(ticket: JiraTicket): Promise<string> {
  const baseUrl = `https://${validateSubdomain(process.env.JIRA_SUBDOMAIN ?? "")}.atlassian.net`;
  const response = await axios.post(
    `${baseUrl}/rest/api/3/issue`,
    buildJiraRequestBody(ticket, process.env.JIRA_PROJECT_ID ?? ""),
    {
      headers: {
        Authorization: buildBasicAuthHeader(
          process.env.JIRA_USERNAME ?? "",
          process.env.JIRA_API_KEY ?? "",
        ),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  const issueKey: string = response.data.key;
  return `${baseUrl}/browse/${issueKey}`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const fetchSlackThreadTool = createTool({
  id: "fetch_slack_thread",
  description:
    "Fetch the messages from a Slack thread URL. Call this when the user provides a Slack thread URL before generating a Jira ticket.",
  inputSchema: z.object({
    url: z
      .string()
      .describe(
        "Slack thread URL (https://workspace.slack.com/archives/.../p...)",
      ),
  }),
  execute: async ({ url }: { url: string }) => {
    if (extractSlackIds(url) === null) {
      return "Not a valid Slack thread URL.";
    }
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) {
      return "SLACK_BOT_TOKEN is not configured. Set SLACK_BOT_TOKEN to enable thread fetching, or paste the thread content directly.";
    }
    return fetchSlackThread(url, slackToken);
  },
});

const createJiraTicketTool = createTool({
  id: "create_jira_ticket",
  description:
    "Create a Jira ticket with a title and description. Call this after you have generated the ticket content from the user's message or a fetched Slack thread.",
  inputSchema: z.object({
    title: z
      .string()
      .max(100)
      .describe("Short, actionable ticket title (max 100 chars)"),
    description: z
      .string()
      .describe(
        "Detailed description including context, steps to reproduce if applicable, and expected vs actual behavior",
      ),
  }),
  execute: async ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => {
    try {
      const ticketUrl = await createJiraTicket({ title, description });
      return `Jira ticket created: ${ticketUrl}\n\nTitle: ${title}\n\nDescription: ${description}`;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axErr = err as AxiosError<{
          errorMessages?: string[];
          errors?: Record<string, string>;
        }>;
        const status = axErr.response?.status;
        const jiraMsg =
          axErr.response?.data?.errorMessages?.[0] ??
          Object.values(axErr.response?.data?.errors ?? {}).join("; ");
        if (status === 401)
          return "Jira authentication failed: check JIRA_API_KEY and JIRA_USERNAME.";
        if (status === 400)
          return `Jira rejected the request: ${jiraMsg || "bad request"}`;
        if (status === 403)
          return "Jira permission denied: ensure the account has permission to create issues in this project.";
        if (status === 404)
          return `Jira project not found: check JIRA_SUBDOMAIN and JIRA_PROJECT_ID.`;
        return `Jira API error (${status ?? "network"}): ${jiraMsg || axErr.message}`;
      }
      const message = err instanceof Error ? err.message : String(err);
      return `Failed to create Jira ticket: ${message}`;
    }
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "slack-jira-agent",
  name: "Slack to Jira Agent",
  instructions: `You are an assistant that creates Jira tickets from problem descriptions or Slack threads.

When the user sends a message:
1. If it contains a Slack thread URL, call fetch_slack_thread first to get the conversation content.
2. From the content (or the direct description), write a concise title (max 100 chars) and a detailed description that includes context, steps to reproduce if applicable, and expected vs actual behavior.
3. Call create_jira_ticket with the title and description.
4. Return the ticket URL and a brief summary.

Never ask for clarification — always create the ticket with whatever information is provided.`,
  model: "openai/gpt-4o-mini",
  memory,
  tools: {
    fetch_slack_thread: fetchSlackThreadTool,
    create_jira_ticket: createJiraTicketTool,
  },
});

new Mastra({ agents: { "slack-jira-agent": agent } });

serve(new MastraAdapter(agent));
