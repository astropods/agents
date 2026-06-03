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
