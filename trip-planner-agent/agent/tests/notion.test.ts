import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  addWeatherToNotionDatabase,
  createNotionTripPlanTemplate,
} from "../tools/notion.js";

function makeFetchSequence(
  responses: unknown[],
  failAt?: number, // 0-indexed call index that should return ok: false
): typeof fetch {
  let call = 0;
  return mock(() => {
    const idx = call++;
    const body = responses[idx];
    const ok = idx !== failAt;
    return Promise.resolve({
      ok,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(`error at call ${idx}`),
    } as Response) as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("createNotionTripPlanTemplate", () => {
  beforeEach(() => {
    process.env.NOTION_BEARER_TOKEN = "test-notion-token";
    process.env.NOTION_PARENT_PAGE_ID = "parent-page-id";
  });

  afterEach(() => {
    delete process.env.NOTION_BEARER_TOKEN;
    delete process.env.NOTION_PARENT_PAGE_ID;
  });

  test("makes exactly 3 Notion API calls", async () => {
    global.fetch = makeFetchSequence([
      { id: "trip-page-id" },
      { id: "db-id" },
      {},
    ]);
    await createNotionTripPlanTemplate("Paris Trip", ["Passport", "Sunscreen"]);
    expect(
      (global.fetch as unknown as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(3);
  });

  test("returns trip_page_id and trip_schedule_database_id", async () => {
    global.fetch = makeFetchSequence([
      { id: "trip-page-id-abc" },
      { id: "db-id-xyz" },
      {},
    ]);
    const result = await createNotionTripPlanTemplate("Paris Trip", [
      "Passport",
    ]);
    expect(result).toEqual({
      trip_page_id: "trip-page-id-abc",
      trip_schedule_database_id: "db-id-xyz",
    });
  });

  test("first call creates page under NOTION_PARENT_PAGE_ID", async () => {
    global.fetch = makeFetchSequence([{ id: "p" }, { id: "d" }, {}]);
    await createNotionTripPlanTemplate("Paris Trip", []);
    const firstCall = (global.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[0];
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.parent.page_id).toBe("parent-page-id");
    expect(body.properties.title[0].text.content).toBe("Paris Trip");
    expect(body.icon.emoji).toBe("🧳");
  });

  test("second call creates database with correct schema", async () => {
    global.fetch = makeFetchSequence([{ id: "trip-page-id" }, { id: "d" }, {}]);
    await createNotionTripPlanTemplate("Paris Trip", []);
    const secondCall = (global.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[1];
    expect(secondCall[0]).toContain("/v1/databases");
    const body = JSON.parse(secondCall[1].body as string);
    expect(body.parent.page_id).toBe("trip-page-id");
    expect(body.properties).toHaveProperty("Day of Week");
    expect(body.properties).toHaveProperty("Date");
    expect(body.properties).toHaveProperty("Weather");
    expect(body.properties).toHaveProperty("Activities Planned");
    expect(body.properties).toHaveProperty("Dining");
  });

  test("third call appends packing list blocks", async () => {
    global.fetch = makeFetchSequence([{ id: "trip-page-id" }, { id: "d" }, {}]);
    await createNotionTripPlanTemplate("Paris Trip", ["Passport", "Camera"]);
    const thirdCall = (global.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[2];
    expect(thirdCall[0]).toContain("/blocks/trip-page-id/children");
    const body = JSON.parse(thirdCall[1].body as string);
    const itemTexts = body.children
      .filter((b: { type: string }) => b.type === "bulleted_list_item")
      .map(
        (b: {
          bulleted_list_item: {
            rich_text: Array<{ text: { content: string } }>;
          };
        }) => b.bulleted_list_item.rich_text[0].text.content,
      );
    expect(itemTexts).toEqual(["Passport", "Camera"]);
  });

  test("throws on create page error (call 1 fails)", async () => {
    global.fetch = makeFetchSequence([{}, {}, {}], 0);
    await expect(
      createNotionTripPlanTemplate("Paris Trip", ["Passport"]),
    ).rejects.toThrow("Notion create page error");
  });

  test("throws on create database error, leaving orphaned page (call 2 fails)", async () => {
    global.fetch = makeFetchSequence([{ id: "orphaned-page" }, {}, {}], 1);
    await expect(
      createNotionTripPlanTemplate("Paris Trip", ["Passport"]),
    ).rejects.toThrow("Notion create database error");
  });

  test("throws on packing list append error (call 3 fails)", async () => {
    global.fetch = makeFetchSequence(
      [{ id: "trip-page-id" }, { id: "db-id" }, {}],
      2,
    );
    await expect(
      createNotionTripPlanTemplate("Paris Trip", ["Passport"]),
    ).rejects.toThrow("Notion add packing list error");
  });

  test("throws if NOTION_BEARER_TOKEN is not set", async () => {
    delete process.env.NOTION_BEARER_TOKEN;
    await expect(
      createNotionTripPlanTemplate("Paris Trip", []),
    ).rejects.toThrow("NOTION_BEARER_TOKEN not set");
  });

  test("throws if NOTION_PARENT_PAGE_ID is not set", async () => {
    delete process.env.NOTION_PARENT_PAGE_ID;
    await expect(
      createNotionTripPlanTemplate("Paris Trip", []),
    ).rejects.toThrow("NOTION_PARENT_PAGE_ID not set");
  });
});

describe("addWeatherToNotionDatabase", () => {
  beforeEach(() => {
    process.env.NOTION_BEARER_TOKEN = "test-notion-token";
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: "entry-id" }),
        text: () => Promise.resolve(""),
      } as Response),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NOTION_BEARER_TOKEN;
  });

  test("posts to /v1/pages", async () => {
    await addWeatherToNotionDatabase(
      "db-id",
      "Monday",
      "2025-06-02",
      "Sunny 72°F",
      "Visit Eiffel Tower",
      "Dinner at Café de Flore",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.notion.com/v1/pages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("sends all day properties in body", async () => {
    await addWeatherToNotionDatabase(
      "db-id-xyz",
      "Tuesday",
      "2025-06-03",
      "Cloudy 65°F",
      "Louvre Museum",
      "Bistro lunch",
    );
    const body = JSON.parse(
      (
        (global.fetch as unknown as ReturnType<typeof mock>).mock
          .calls[0][1] as RequestInit
      ).body as string,
    );
    expect(body.parent.database_id).toBe("db-id-xyz");
    expect(body.properties["Day of Week"].title[0].text.content).toBe(
      "Tuesday",
    );
    expect(body.properties.Date.date.start).toBe("2025-06-03");
    expect(body.properties.Weather.rich_text[0].text.content).toBe(
      "Cloudy 65°F",
    );
    expect(
      body.properties["Activities Planned"].rich_text[0].text.content,
    ).toBe("Louvre Museum");
    expect(body.properties.Dining.rich_text[0].text.content).toBe(
      "Bistro lunch",
    );
  });

  test("returns the created page id", async () => {
    const result = await addWeatherToNotionDatabase(
      "db-id",
      "Monday",
      "2025-06-02",
      "Sunny",
      "Beach",
      "Seafood",
    );
    expect((result as { id: string }).id).toBe("entry-id");
  });

  test("throws on Notion API error", async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("Unauthorized"),
      } as Response),
    ) as unknown as typeof fetch;
    await expect(
      addWeatherToNotionDatabase(
        "db-id",
        "Monday",
        "2025-06-02",
        "Sunny",
        "Beach",
        "Seafood",
      ),
    ).rejects.toThrow("Notion add entry error");
  });

  test("throws if NOTION_BEARER_TOKEN is not set", async () => {
    delete process.env.NOTION_BEARER_TOKEN;
    await expect(
      addWeatherToNotionDatabase(
        "db-id",
        "Monday",
        "2025-06-02",
        "Sunny",
        "Beach",
        "Seafood",
      ),
    ).rejects.toThrow("NOTION_BEARER_TOKEN not set");
  });
});
