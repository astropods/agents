const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(): Record<string, string> {
  const token = process.env.NOTION_BEARER_TOKEN;
  if (!token) throw new Error("NOTION_BEARER_TOKEN not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

// NOTE: This function makes three sequential Notion API calls (create page →
// create database → append packing list). The Notion API has no transaction
// support, so a failure at step 2 or 3 will leave an orphaned page behind.
// The error is propagated to the agent so the user can retry; manual cleanup
// of the orphaned page may be required on repeated failures.
export async function createNotionTripPlanTemplate(
  trip_page_title: string,
  packing_list: string[],
): Promise<{ trip_page_id: string; trip_schedule_database_id: string }> {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) throw new Error("NOTION_PARENT_PAGE_ID not set");

  const pageRes = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      icon: { type: "emoji", emoji: "🧳" },
      properties: {
        title: [{ type: "text", text: { content: trip_page_title } }],
      },
    }),
  });
  if (!pageRes.ok) {
    throw new Error(
      `Notion create page error: ${pageRes.status} ${await pageRes.text()}`,
    );
  }
  const page = (await pageRes.json()) as { id: string };
  const trip_page_id = page.id;

  const dbRes = await fetch(`${NOTION_API}/databases`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { type: "page_id", page_id: trip_page_id },
      is_inline: true,
      title: [{ type: "text", text: { content: "🗓️ Trip Schedule" } }],
      properties: {
        "Day of Week": { title: {} },
        Date: { date: {} },
        Weather: { rich_text: {} },
        "Activities Planned": { rich_text: {} },
        Dining: { rich_text: {} },
      },
    }),
  });
  if (!dbRes.ok) {
    throw new Error(
      `Notion create database error: ${dbRes.status} ${await dbRes.text()}`,
    );
  }
  const db = (await dbRes.json()) as { id: string };
  const trip_schedule_database_id = db.id;

  const packingBlocks = [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "🎒 Packing List" } }],
      },
    },
    ...packing_list.map((item) => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [{ type: "text", text: { content: item } }],
      },
    })),
  ];

  const packRes = await fetch(`${NOTION_API}/blocks/${trip_page_id}/children`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ children: packingBlocks }),
  });
  if (!packRes.ok) {
    throw new Error(
      `Notion add packing list error: ${packRes.status} ${await packRes.text()}`,
    );
  }

  return { trip_page_id, trip_schedule_database_id };
}

export async function addWeatherToNotionDatabase(
  trip_schedule_database_id: string,
  day_of_week: string,
  trip_date: string,
  weather_summary: string,
  activities_planned: string,
  dining_plan: string,
): Promise<unknown> {
  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: trip_schedule_database_id },
      properties: {
        "Day of Week": { title: [{ text: { content: day_of_week } }] },
        Date: { date: { start: trip_date } },
        Weather: {
          rich_text: [{ type: "text", text: { content: weather_summary } }],
        },
        "Activities Planned": {
          rich_text: [{ type: "text", text: { content: activities_planned } }],
        },
        Dining: {
          rich_text: [{ type: "text", text: { content: dining_plan } }],
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Notion add entry error: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}
