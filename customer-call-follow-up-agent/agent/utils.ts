// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZoomRecordingFile {
  file_type: string;
  download_url: string;
  status: string;
}

export interface ZendeskTicketResult {
  ticket_id: number;
  ticket_url: string;
}

export interface NotionPageResult {
  page_url: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateMeetingId(value: string): string {
  // Zoom meeting IDs are 9–11 digit numbers; strip spaces before validating
  const stripped = value.replace(/\s/g, "");
  if (!/^\d{9,11}$/.test(stripped)) {
    throw new Error(`Invalid meeting ID: "${value}"`);
  }
  return stripped;
}

export function extractMeetingId(text: string): string | null {
  // Match a sequence of 9–11 digits, optionally space-separated (e.g. "876 5432 1098")
  const match = text.match(/\b(\d[\d ]{7,11}\d)\b/);
  if (!match) return null;
  const stripped = match[1].replace(/\s/g, "");
  if (!/^\d{9,11}$/.test(stripped)) return null;
  return stripped;
}

export function validateNotionPageId(value: string): string {
  if (
    !/^[0-9a-fA-F]{32}$/.test(value) &&
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    throw new Error(`Invalid Notion page ID: "${value}"`);
  }
  return value;
}

export function validateZendeskSubdomain(value: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error(`Invalid Zendesk subdomain: "${value}"`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

export async function refreshZoomToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom token refresh failed: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!data.access_token)
    throw new Error("Zoom token response missing access_token");
  return {
    accessToken: data.access_token,
    // Zoom rotates the refresh token on each use; fall back to current if not returned
    refreshToken: data.refresh_token ?? refreshToken,
  };
}

export async function getZoomTranscript(
  accessToken: string,
  meetingId: string,
): Promise<string> {
  const res = await fetch(
    `https://api.zoom.us/v2/meetings/${validateMeetingId(meetingId)}/recordings`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom recordings fetch failed: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as { recording_files?: ZoomRecordingFile[] };
  const files = data.recording_files ?? [];
  const transcriptFile = files.find(
    (f) => f.file_type === "TRANSCRIPT" && f.status === "completed",
  );
  if (!transcriptFile) {
    const isProcessing = files.some(
      (f) => f.file_type === "TRANSCRIPT" && f.status !== "completed",
    );
    if (isProcessing) {
      throw new Error(
        "The call transcript is still processing. Please try again in a few minutes.",
      );
    }
    throw new Error("No transcript found for this meeting.");
  }
  const transcriptRes = await fetch(transcriptFile.download_url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!transcriptRes.ok) {
    const body = await transcriptRes.text();
    throw new Error(
      `Transcript download failed: ${transcriptRes.status} — ${body}`,
    );
  }
  return transcriptRes.text();
}

// ---------------------------------------------------------------------------
// Zendesk
// ---------------------------------------------------------------------------

export function buildZendeskAuth(email: string, apiKey: string): string {
  return Buffer.from(`${email}/token:${apiKey}`).toString("base64");
}

export async function createZendeskTicket(
  subdomain: string,
  agentEmail: string,
  apiKey: string,
  subject: string,
  description: string,
): Promise<ZendeskTicketResult> {
  const safe = validateZendeskSubdomain(subdomain);
  const res = await fetch(`https://${safe}.zendesk.com/api/v2/tickets.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${buildZendeskAuth(agentEmail, apiKey)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ticket: { subject, comment: { body: description } },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zendesk ticket creation failed: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as { ticket: { id: number } };
  return {
    ticket_id: data.ticket.id,
    ticket_url: `https://${safe}.zendesk.com/agent/tickets/${data.ticket.id}`,
  };
}

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

const NOTION_BLOCK_LIMIT = 100;

export async function createNotionPage(
  apiKey: string,
  parentPageId: string,
  title: string,
  content: string,
): Promise<NotionPageResult> {
  // Split into 2000-char chunks (Notion API rich_text block limit per block)
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += 2000) {
    chunks.push(content.slice(i, i + 2000));
  }
  const allBlocks = chunks.map((chunk) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: chunk } }],
    },
  }));

  const notionHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  // Notion limits page creation to 100 children — create with first batch
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders,
    body: JSON.stringify({
      parent: { page_id: validateNotionPageId(parentPageId) },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
      children: allBlocks.slice(0, NOTION_BLOCK_LIMIT),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion page creation failed: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as { id: string; url: string };

  // Append remaining blocks in batches of 100
  for (
    let i = NOTION_BLOCK_LIMIT;
    i < allBlocks.length;
    i += NOTION_BLOCK_LIMIT
  ) {
    const batch = allBlocks.slice(i, i + NOTION_BLOCK_LIMIT);
    const appendRes = await fetch(
      `https://api.notion.com/v1/blocks/${data.id}/children`,
      {
        method: "PATCH",
        headers: notionHeaders,
        body: JSON.stringify({ children: batch }),
      },
    );
    if (!appendRes.ok) {
      const body = await appendRes.text();
      throw new Error(
        `Notion block append failed: ${appendRes.status} — ${body}`,
      );
    }
  }

  return { page_url: data.url };
}
