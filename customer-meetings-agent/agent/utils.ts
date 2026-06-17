// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: { email: string; displayName?: string }[];
}

export interface ZendeskTicket {
  id: number;
  subject: string;
  status: string;
  priority: string | null;
  created_at: string;
}

export interface HubSpotDeal {
  id: string;
  name: string;
  amount: string | null;
  stage: string | null;
  closeDate: string | null;
}

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

export async function refreshGoogleToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token)
    throw new Error(`Google token error: ${data.error ?? "no access_token"}`);
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

export async function getCalendarEvents(
  accessToken: string,
  calendarId: string,
  date?: string,
): Promise<CalendarEvent[]> {
  const d = date ?? new Date().toISOString().split("T")[0];
  const timeMin = `${d}T00:00:00Z`;
  const nextDay = new Date(`${d}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const timeMax = nextDay.toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar API error: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as {
    items: {
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: { email: string; displayName?: string }[];
    }[];
  };
  return (data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    attendees: e.attendees ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Zendesk
// ---------------------------------------------------------------------------

export function buildZendeskAuth(email: string, apiKey: string): string {
  return Buffer.from(`${email}/token:${apiKey}`).toString("base64");
}

export async function searchZendeskTickets(
  zendeskUrl: string,
  agentEmail: string,
  apiKey: string,
  query: string,
): Promise<ZendeskTicket[]> {
  const base = zendeskUrl.replace(/\/+$/, "");
  const searchQuery = `type:ticket status:open "${query}"`;
  const res = await fetch(
    `${base}/api/v2/search.json?query=${encodeURIComponent(searchQuery)}`,
    {
      headers: {
        Authorization: `Basic ${buildZendeskAuth(agentEmail, apiKey)}`,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zendesk API error: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as {
    results: {
      id: number;
      subject: string;
      status: string;
      priority: string | null;
      created_at: string;
    }[];
  };
  return (data.results ?? []).map((t) => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    created_at: t.created_at,
  }));
}

// ---------------------------------------------------------------------------
// HubSpot
// ---------------------------------------------------------------------------

export async function searchHubSpotDeals(
  apiKey: string,
  query: string,
): Promise<HubSpotDeal[]> {
  const res = await fetch(
    "https://api.hubapi.com/crm/v3/objects/deals/search",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        properties: ["dealname", "amount", "dealstage", "closedate"],
        filterGroups: [
          {
            filters: [
              {
                propertyName: "dealstage",
                operator: "NOT_IN",
                values: ["closedlost", "closedwon"],
              },
            ],
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API error: ${res.status} — ${body}`);
  }
  const data = (await res.json()) as {
    results: {
      id: string;
      properties: {
        dealname?: string;
        amount?: string;
        dealstage?: string;
        closedate?: string;
      };
    }[];
  };
  return (data.results ?? []).map((d) => ({
    id: d.id,
    name: d.properties.dealname ?? "",
    amount: d.properties.amount ?? null,
    stage: d.properties.dealstage ?? null,
    closeDate: d.properties.closedate ?? null,
  }));
}
