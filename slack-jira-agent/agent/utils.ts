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
      typeof parsed.description === "string" && parsed.description.length > 0
        ? parsed.description
        : "(No description provided)",
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

// ---------------------------------------------------------------------------
// Slack thread fetcher
// ---------------------------------------------------------------------------

export function extractSlackIds(
  text: string,
): { channel: string; ts: string } | null {
  const match = text.match(/\/archives\/([A-Z0-9]+)\/p(\d{16})/);
  if (!match) return null;
  const raw = match[2]; // 16 digits: 10-digit unix seconds + 6-digit microseconds
  return { channel: match[1], ts: `${raw.slice(0, 10)}.${raw.slice(10)}` };
}

export async function fetchSlackThread(
  url: string,
  token: string,
): Promise<string> {
  const ids = extractSlackIds(url);
  if (!ids) throw new Error(`Cannot parse Slack URL: ${url}`);

  const params = new URLSearchParams({
    channel: ids.channel,
    ts: ids.ts,
    limit: "50",
  });
  const response = await fetch(
    `https://slack.com/api/conversations.replies?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await response.json()) as {
    ok: boolean;
    messages?: Array<{ user?: string; text?: string }>;
    error?: string;
  };
  if (!data.ok) throw new Error(`Slack API error: ${data.error ?? "unknown"}`);

  return (data.messages ?? [])
    .map((m) => `${m.user ?? "unknown"}: ${m.text ?? ""}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Subdomain validator (SSRF defence)
// ---------------------------------------------------------------------------

export function validateSubdomain(value: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error(
      `Invalid JIRA_SUBDOMAIN: "${value}" — must contain only alphanumeric characters and hyphens`,
    );
  }
  return value;
}
