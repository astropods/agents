import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  createIncidentInNotion,
  fetchIncidentsFromNotion,
  notionHeaders,
  updateIncidentInNotion,
  validateNotionId,
} from "./utils";

const VALID_DB_ID = "aaaabbbbccccddddeeeeffffaaaabbbb";
const VALID_PAGE_ID = "bbbbccccddddeeeeffffaaaabbbbcccc";

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => {
    s.mockRestore();
  });
  spies.length = 0;
});

describe("notionHeaders", () => {
  test("returns correct Authorization header", () => {
    const headers = notionHeaders("secret_abc");
    expect(headers.Authorization).toBe("Bearer secret_abc");
  });

  test("returns Notion-Version header", () => {
    const headers = notionHeaders("secret_abc");
    expect(headers["Notion-Version"]).toBe("2022-06-28");
  });

  test("returns Content-Type application/json", () => {
    const headers = notionHeaders("secret_abc");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("validateNotionId", () => {
  test("accepts a 32-char hex ID", () => {
    expect(validateNotionId(VALID_DB_ID)).toBe(VALID_DB_ID);
  });

  test("accepts a 36-char UUID with hyphens", () => {
    const uuid = "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb";
    expect(validateNotionId(uuid)).toBe(uuid);
  });

  test("throws on a short non-hex ID like 'db-123'", () => {
    expect(() => validateNotionId("db-123")).toThrow("Invalid Notion ID");
  });

  test("throws on an empty string", () => {
    expect(() => validateNotionId("")).toThrow("Invalid Notion ID");
  });

  test("throws on an ID with uppercase letters", () => {
    expect(() => validateNotionId("AAAABBBBCCCCDDDDEEEEFFFFAAAABBBB")).toThrow(
      "Invalid Notion ID",
    );
  });
});

describe("fetchIncidentsFromNotion", () => {
  test("POSTs to the database query endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    spies.push(spy);
    await fetchIncidentsFromNotion("secret_abc", VALID_DB_ID);
    expect(spy).toHaveBeenCalledWith(
      `https://api.notion.com/v1/databases/${VALID_DB_ID}/query`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("maps results to IncidentRecord array", async () => {
    const mockPage = {
      id: "page-1",
      properties: {
        Name: { title: [{ plain_text: "DB Outage" }] },
        Status: { select: { name: "In progress" } },
        "Severity Level": { select: { name: "Critical" } },
        "Incident Date": { date: { start: "2026-05-20" } },
        "Slack Channel ID": { rich_text: [{ plain_text: "C123456" }] },
      },
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [mockPage] }), { status: 200 }),
    );
    spies.push(spy);
    const result = await fetchIncidentsFromNotion("secret_abc", VALID_DB_ID);
    expect(result).toEqual([
      {
        page_id: "page-1",
        name: "DB Outage",
        status: "In progress",
        severity_level: "Critical",
        incident_date: "2026-05-20",
        slack_channel_id: "C123456",
      },
    ]);
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    spies.push(spy);
    await expect(fetchIncidentsFromNotion("bad", VALID_DB_ID)).rejects.toThrow(
      "401",
    );
  });
});

describe("createIncidentInNotion", () => {
  test("POSTs to /v1/pages", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-page-id" }), { status: 200 }),
    );
    spies.push(spy);
    await createIncidentInNotion("secret", VALID_DB_ID, {
      name: "DB Outage",
      incident_date: "2026-05-20",
      status: "In progress",
      severity_level: "Critical",
      detail_summary: "DB is down",
      engineering_update: "Investigating",
      support_update: "Users affected",
      slack_channel_id: "C123",
    });
    expect(spy).toHaveBeenCalledWith(
      "https://api.notion.com/v1/pages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("returns page_id from response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-page-id" }), { status: 200 }),
    );
    spies.push(spy);
    const result = await createIncidentInNotion("secret", VALID_DB_ID, {
      name: "DB Outage",
      incident_date: "2026-05-20",
      status: "In progress",
      severity_level: "Critical",
      detail_summary: "DB is down",
      engineering_update: "Investigating",
      support_update: "Users affected",
      slack_channel_id: "C123",
    });
    expect(result).toEqual({ page_id: "new-page-id" });
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );
    spies.push(spy);
    await expect(
      createIncidentInNotion("secret", VALID_DB_ID, {
        name: "x",
        incident_date: "2026-05-20",
        status: "In progress",
        severity_level: "Low",
        detail_summary: "x",
        engineering_update: "x",
        support_update: "x",
        slack_channel_id: "C1",
      }),
    ).rejects.toThrow("400");
  });

  test("sends correct properties and children blocks in body", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-page-id" }), { status: 200 }),
    );
    spies.push(spy);
    await createIncidentInNotion("secret", VALID_DB_ID, {
      name: "DB Outage",
      incident_date: "2026-05-20",
      status: "In progress",
      severity_level: "Critical",
      detail_summary: "DB is down",
      engineering_update: "Investigating",
      support_update: "Users affected",
      slack_channel_id: "C123",
    });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.parent).toEqual({ database_id: VALID_DB_ID });
    expect(body.properties.Name).toEqual({
      title: [{ text: { content: "DB Outage" } }],
    });
    expect(body.properties.Status).toEqual({ select: { name: "In progress" } });
    expect(body.properties["Severity Level"]).toEqual({
      select: { name: "Critical" },
    });
    expect(body.properties["Incident Date"]).toEqual({
      date: { start: "2026-05-20" },
    });
    expect(body.properties["Slack Channel ID"]).toEqual({
      rich_text: [{ text: { content: "C123" } }],
    });
    expect(body.children).toHaveLength(6);
  });
});

describe("updateIncidentInNotion", () => {
  test("PATCHes the page properties", async () => {
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: VALID_PAGE_ID }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    await updateIncidentInNotion("secret", VALID_PAGE_ID, {
      status: "Done",
      severity_level: "High",
      detail_summary: "Resolved",
      engineering_update: "Fixed",
      support_update: "All clear",
    });
    const [firstUrl, firstInit] = spy.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe(`https://api.notion.com/v1/pages/${VALID_PAGE_ID}`);
    expect((firstInit as RequestInit).method).toBe("PATCH");
  });

  test("returns page_id", async () => {
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: VALID_PAGE_ID }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    const result = await updateIncidentInNotion("secret", VALID_PAGE_ID, {
      status: "Done",
      severity_level: "High",
      detail_summary: "Resolved",
      engineering_update: "Fixed",
      support_update: "All clear",
    });
    expect(result).toEqual({ page_id: VALID_PAGE_ID });
  });

  test("throws on non-ok response from PATCH properties", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    spies.push(spy);
    await expect(
      updateIncidentInNotion("bad", VALID_PAGE_ID, {
        status: "Done",
        severity_level: "High",
        detail_summary: "x",
        engineering_update: "x",
        support_update: "x",
      }),
    ).rejects.toThrow("401");
  });

  test("archives existing blocks and appends new summary blocks", async () => {
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: VALID_PAGE_ID }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [{ id: "block-a" }, { id: "block-b" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    await updateIncidentInNotion("secret", VALID_PAGE_ID, {
      status: "Done",
      severity_level: "High",
      detail_summary: "Resolved",
      engineering_update: "Fixed",
      support_update: "All clear",
    });
    // 5 calls: PATCH props, GET blocks, PATCH block-a, PATCH block-b, PATCH children (append)
    expect(spy).toHaveBeenCalledTimes(5);
    const [archiveAUrl, archiveAInit] = spy.mock.calls[2] as [
      string,
      RequestInit,
    ];
    expect(archiveAUrl).toBe("https://api.notion.com/v1/blocks/block-a");
    expect(JSON.parse((archiveAInit as RequestInit).body as string)).toEqual({
      archived: true,
    });
    const [appendUrl, appendInit] = spy.mock.calls[4] as [string, RequestInit];
    expect(appendUrl).toBe(
      `https://api.notion.com/v1/blocks/${VALID_PAGE_ID}/children`,
    );
    expect((appendInit as RequestInit).method).toBe("PATCH");
    const appendBody = JSON.parse((appendInit as RequestInit).body as string);
    expect(appendBody.children).toHaveLength(6);
  });
});
