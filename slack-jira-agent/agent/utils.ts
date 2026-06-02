// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraTicket {
  title: string;
  description: string;
}

// ---------------------------------------------------------------------------
// OpenAI response parser
// ---------------------------------------------------------------------------

export function parseJiraTicket(raw: string): JiraTicket {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    title:
      typeof parsed.title === "string"
        ? parsed.title.slice(0, 100)
        : "(no title)",
    description:
      typeof parsed.description === "string" ? parsed.description : "",
  };
}

// ---------------------------------------------------------------------------
// Jira request body builder
// ---------------------------------------------------------------------------

export function buildJiraRequestBody(ticket: JiraTicket, projectId: string) {
  return {
    fields: {
      project: { key: projectId },
      summary: ticket.title,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: ticket.description }],
          },
        ],
      },
      issuetype: { name: "Task" },
    },
  };
}

// ---------------------------------------------------------------------------
// Auth header builder
// ---------------------------------------------------------------------------

export function buildBasicAuthHeader(username: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`;
}
