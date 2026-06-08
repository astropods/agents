import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  buildZendeskAuth,
  getCalendarEvents,
  refreshGoogleToken,
  searchHubSpotDeals,
  searchZendeskTickets,
} from "./utils";

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => {
    s.mockRestore();
  });
  spies.length = 0;
});

describe("refreshGoogleToken", () => {
  test("returns access_token on success", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok_abc" }), {
        status: 200,
      }),
    );
    spies.push(spy);
    const token = await refreshGoogleToken(
      "client-id",
      "client-secret",
      "refresh-tok",
    );
    expect(token).toBe("tok_abc");
  });

  test("POSTs to the Google token endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok_abc" }), {
        status: 200,
      }),
    );
    spies.push(spy);
    await refreshGoogleToken("client-id", "client-secret", "refresh-tok");
    expect(spy).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("error", { status: 400 }),
    );
    spies.push(spy);
    await expect(refreshGoogleToken("id", "secret", "refresh")).rejects.toThrow(
      "400",
    );
  });

  test("throws when access_token is missing", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 200 }),
    );
    spies.push(spy);
    await expect(refreshGoogleToken("id", "secret", "refresh")).rejects.toThrow(
      "invalid_grant",
    );
  });
});

describe("getCalendarEvents", () => {
  test("GETs the calendar events endpoint with time range", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    spies.push(spy);
    await getCalendarEvents("token", "primary", "2026-05-22");
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("calendars/primary/events");
    expect(decodeURIComponent(url)).toContain("2026-05-22T00:00:00Z");
    expect(decodeURIComponent(url)).toContain("2026-05-22T23:59:59Z");
  });

  test("maps items to CalendarEvent array", async () => {
    const mockItem = {
      id: "evt-1",
      summary: "Customer Sync",
      start: { dateTime: "2026-05-22T10:00:00Z" },
      end: { dateTime: "2026-05-22T11:00:00Z" },
      attendees: [{ email: "alice@acme.com", displayName: "Alice" }],
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem] }), { status: 200 }),
    );
    spies.push(spy);
    const events = await getCalendarEvents("token", "primary", "2026-05-22");
    expect(events).toEqual([
      {
        id: "evt-1",
        summary: "Customer Sync",
        start: "2026-05-22T10:00:00Z",
        end: "2026-05-22T11:00:00Z",
        attendees: [{ email: "alice@acme.com", displayName: "Alice" }],
      },
    ]);
  });

  test("handles missing optional fields gracefully", async () => {
    const mockItem = { id: "evt-2" };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem] }), { status: 200 }),
    );
    spies.push(spy);
    const events = await getCalendarEvents("token", "primary", "2026-05-22");
    expect(events[0]).toEqual({
      id: "evt-2",
      summary: "(no title)",
      start: "",
      end: "",
      attendees: [],
    });
  });

  test("uses all-day date field when dateTime is absent", async () => {
    const mockItem = {
      id: "evt-3",
      start: { date: "2026-05-22" },
      end: { date: "2026-05-22" },
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem] }), { status: 200 }),
    );
    spies.push(spy);
    const events = await getCalendarEvents("token", "primary", "2026-05-22");
    expect(events[0].start).toBe("2026-05-22");
    expect(events[0].end).toBe("2026-05-22");
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    spies.push(spy);
    await expect(getCalendarEvents("bad", "primary")).rejects.toThrow("401");
  });
});

describe("buildZendeskAuth", () => {
  test("returns base64-encoded email/token:apiKey string", () => {
    const result = buildZendeskAuth("agent@example.com", "myapikey");
    const decoded = Buffer.from(result, "base64").toString("utf8");
    expect(decoded).toBe("agent@example.com/token:myapikey");
  });
});

describe("searchZendeskTickets", () => {
  test("GETs the Zendesk search endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    spies.push(spy);
    await searchZendeskTickets(
      "https://company.zendesk.com",
      "agent@example.com",
      "key",
      "acme",
    );
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("company.zendesk.com");
    expect(url).toContain("search.json");
  });

  test("maps results to ZendeskTicket array", async () => {
    const mockTicket = {
      id: 101,
      subject: "Login issue",
      status: "open",
      priority: "high",
      created_at: "2026-05-20T08:00:00Z",
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [mockTicket] }), { status: 200 }),
    );
    spies.push(spy);
    const tickets = await searchZendeskTickets(
      "https://company.zendesk.com",
      "agent@example.com",
      "key",
      "acme",
    );
    expect(tickets).toEqual([
      {
        id: 101,
        subject: "Login issue",
        status: "open",
        priority: "high",
        created_at: "2026-05-20T08:00:00Z",
      },
    ]);
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );
    spies.push(spy);
    await expect(
      searchZendeskTickets("https://z.zendesk.com", "a@b.com", "k", "q"),
    ).rejects.toThrow("403");
  });
});

describe("searchHubSpotDeals", () => {
  test("POSTs to the HubSpot deals search endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    spies.push(spy);
    await searchHubSpotDeals("hs-key", "acme");
    expect(spy).toHaveBeenCalledWith(
      "https://api.hubapi.com/crm/v3/objects/deals/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("maps results to HubSpotDeal array", async () => {
    const mockDeal = {
      id: "d-1",
      properties: {
        dealname: "Acme Enterprise",
        amount: "50000",
        dealstage: "negotiation",
        closedate: "2026-06-30",
      },
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [mockDeal] }), { status: 200 }),
    );
    spies.push(spy);
    const deals = await searchHubSpotDeals("hs-key", "acme");
    expect(deals).toEqual([
      {
        id: "d-1",
        name: "Acme Enterprise",
        amount: "50000",
        stage: "negotiation",
        closeDate: "2026-06-30",
      },
    ]);
  });

  test("handles missing deal properties", async () => {
    const mockDeal = { id: "d-2", properties: {} };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [mockDeal] }), { status: 200 }),
    );
    spies.push(spy);
    const deals = await searchHubSpotDeals("hs-key", "q");
    expect(deals[0]).toEqual({
      id: "d-2",
      name: "",
      amount: null,
      stage: null,
      closeDate: null,
    });
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    spies.push(spy);
    await expect(searchHubSpotDeals("bad-key", "q")).rejects.toThrow("401");
  });
});
