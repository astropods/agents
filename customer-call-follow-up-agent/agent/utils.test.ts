import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  buildZendeskAuth,
  createNotionPage,
  createZendeskTicket,
  extractMeetingId,
  getZoomTranscript,
  refreshZoomToken,
  validateMeetingId,
  validateNotionPageId,
  validateZendeskSubdomain,
} from "./utils";

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => {
    s.mockRestore();
  });
  spies.length = 0;
});

describe("validateMeetingId", () => {
  test("accepts 11-digit numeric ID", () => {
    expect(validateMeetingId("12345678901")).toBe("12345678901");
  });

  test("accepts 9-digit numeric ID", () => {
    expect(validateMeetingId("123456789")).toBe("123456789");
  });

  test("strips spaces from formatted ID", () => {
    expect(validateMeetingId("876 5432 1098")).toBe("87654321098");
  });

  test("throws on alphanumeric ID", () => {
    expect(() => validateMeetingId("abc-123_XYZ")).toThrow(
      "Invalid meeting ID",
    );
  });

  test("throws on too-short number", () => {
    expect(() => validateMeetingId("12345678")).toThrow("Invalid meeting ID");
  });

  test("throws on path traversal attempt", () => {
    expect(() => validateMeetingId("../etc/passwd")).toThrow(
      "Invalid meeting ID",
    );
  });

  test("throws on empty string", () => {
    expect(() => validateMeetingId("")).toThrow("Invalid meeting ID");
  });
});

describe("extractMeetingId", () => {
  test("extracts a plain 11-digit ID from text", () => {
    expect(extractMeetingId("Please process meeting 87654321098 thanks")).toBe(
      "87654321098",
    );
  });

  test("extracts a space-formatted ID", () => {
    expect(extractMeetingId("Meeting ID: 876 5432 1098")).toBe("87654321098");
  });

  test("extracts a 9-digit ID", () => {
    expect(extractMeetingId("ID is 123456789")).toBe("123456789");
  });

  test("returns null when no ID found", () => {
    expect(extractMeetingId("No meeting here")).toBeNull();
  });

  test("returns null for a number that is too short", () => {
    expect(extractMeetingId("ID: 12345678")).toBeNull();
  });

  test("returns null for a number that is too long", () => {
    expect(extractMeetingId("ID: 123456789012")).toBeNull();
  });
});

describe("validateNotionPageId", () => {
  test("accepts 32-char lowercase hex ID", () => {
    const id = "aaaabbbbccccddddeeeeffffaaaabbbb";
    expect(validateNotionPageId(id)).toBe(id);
  });

  test("accepts 36-char UUID with hyphens", () => {
    const id = "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb";
    expect(validateNotionPageId(id)).toBe(id);
  });

  test("accepts uppercase hex ID", () => {
    const id = "AAAABBBBCCCCDDDDEEEEFFFFAAAABBBB";
    expect(validateNotionPageId(id)).toBe(id);
  });

  test("throws on short invalid ID", () => {
    expect(() => validateNotionPageId("parent-id")).toThrow(
      "Invalid Notion page ID",
    );
  });

  test("throws on all-hyphen string", () => {
    expect(() =>
      validateNotionPageId("--------------------------------"),
    ).toThrow("Invalid Notion page ID");
  });
});

describe("validateZendeskSubdomain", () => {
  test("accepts valid subdomain", () => {
    expect(validateZendeskSubdomain("mycompany")).toBe("mycompany");
  });

  test("accepts subdomain with hyphens", () => {
    expect(validateZendeskSubdomain("my-company-123")).toBe("my-company-123");
  });

  test("throws on subdomain with dots", () => {
    expect(() => validateZendeskSubdomain("my.company")).toThrow(
      "Invalid Zendesk subdomain",
    );
  });

  test("throws on path traversal attempt", () => {
    expect(() => validateZendeskSubdomain("../evil")).toThrow(
      "Invalid Zendesk subdomain",
    );
  });
});

describe("refreshZoomToken", () => {
  test("returns access_token on success", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "zoom_tok_abc" }), {
        status: 200,
      }),
    );
    spies.push(spy);
    const result = await refreshZoomToken(
      "client-id",
      "client-secret",
      "refresh-tok",
    );
    expect(result.accessToken).toBe("zoom_tok_abc");
    // falls back to input refresh token when response omits refresh_token
    expect(result.refreshToken).toBe("refresh-tok");
  });

  test("POSTs to the Zoom token endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }),
    );
    spies.push(spy);
    await refreshZoomToken("id", "secret", "refresh");
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("zoom.us/oauth/token");
    expect((opts.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /,
    );
  });

  test("sends Basic auth with base64 clientId:clientSecret", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }),
    );
    spies.push(spy);
    await refreshZoomToken("myid", "mysecret", "refresh");
    const [, opts] = spy.mock.calls[0] as [string, RequestInit];
    const auth = (opts.headers as Record<string, string>).Authorization;
    const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString(
      "utf8",
    );
    expect(decoded).toBe("myid:mysecret");
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    spies.push(spy);
    await expect(refreshZoomToken("id", "secret", "refresh")).rejects.toThrow(
      "401",
    );
  });

  test("returns rotated refresh_token when Zoom provides one", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new_access",
          refresh_token: "new_refresh",
        }),
        { status: 200 },
      ),
    );
    spies.push(spy);
    const result = await refreshZoomToken("id", "secret", "old_refresh");
    expect(result.accessToken).toBe("new_access");
    expect(result.refreshToken).toBe("new_refresh");
  });

  test("throws when access_token is missing", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 200 }),
    );
    spies.push(spy);
    await expect(refreshZoomToken("id", "secret", "refresh")).rejects.toThrow(
      "access_token",
    );
  });
});

describe("getZoomTranscript", () => {
  test("returns transcript text when TRANSCRIPT file is found", async () => {
    const mockRecordings = {
      recording_files: [
        {
          file_type: "MP4",
          status: "completed",
          download_url: "https://zoom.us/mp4",
        },
        {
          file_type: "TRANSCRIPT",
          status: "completed",
          download_url: "https://zoom.us/vtt",
        },
      ],
    };
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockRecordings), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response("WEBVTT\n\nSpeaker: Hello world", { status: 200 }),
      );
    spies.push(spy);
    const transcript = await getZoomTranscript("tok", "123456789");
    expect(transcript).toContain("Hello world");
  });

  test("returns processing error when TRANSCRIPT is not yet completed", async () => {
    const mockRecordings = {
      recording_files: [
        {
          file_type: "TRANSCRIPT",
          status: "processing",
          download_url: "https://zoom.us/vtt",
        },
      ],
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockRecordings), { status: 200 }),
    );
    spies.push(spy);
    await expect(getZoomTranscript("tok", "123456789")).rejects.toThrow(
      "still processing",
    );
  });

  test("returns not-found error when no TRANSCRIPT file exists at all", async () => {
    const mockRecordings = {
      recording_files: [
        {
          file_type: "MP4",
          status: "completed",
          download_url: "https://zoom.us/mp4",
        },
      ],
    };
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockRecordings), { status: 200 }),
    );
    spies.push(spy);
    await expect(getZoomTranscript("tok", "123456789")).rejects.toThrow(
      "No transcript found",
    );
  });

  test("throws when recordings fetch fails", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );
    spies.push(spy);
    await expect(getZoomTranscript("tok", "123456789")).rejects.toThrow("404");
  });

  test("throws when transcript download fails", async () => {
    const mockRecordings = {
      recording_files: [
        {
          file_type: "TRANSCRIPT",
          status: "completed",
          download_url: "https://zoom.us/vtt",
        },
      ],
    };
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockRecordings), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    spies.push(spy);
    await expect(getZoomTranscript("tok", "123456789")).rejects.toThrow("403");
  });

  test("throws on invalid meeting ID", async () => {
    await expect(getZoomTranscript("tok", "abc123")).rejects.toThrow(
      "Invalid meeting ID",
    );
  });
});

describe("buildZendeskAuth", () => {
  test("returns base64-encoded email/token:apiKey", () => {
    const result = buildZendeskAuth("agent@example.com", "myapikey");
    const decoded = Buffer.from(result, "base64").toString("utf8");
    expect(decoded).toBe("agent@example.com/token:myapikey");
  });
});

describe("createZendeskTicket", () => {
  test("creates ticket and returns id and url", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42 } }), { status: 201 }),
    );
    spies.push(spy);
    const result = await createZendeskTicket(
      "mycompany",
      "agent@example.com",
      "apikey",
      "Login broken",
      "Users cannot log in",
    );
    expect(result.ticket_id).toBe(42);
    expect(result.ticket_url).toBe(
      "https://mycompany.zendesk.com/agent/tickets/42",
    );
  });

  test("POSTs to the correct Zendesk endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 1 } }), { status: 201 }),
    );
    spies.push(spy);
    await createZendeskTicket("myco", "a@b.com", "key", "subject", "desc");
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toBe("https://myco.zendesk.com/api/v2/tickets.json");
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );
    spies.push(spy);
    await expect(
      createZendeskTicket("co", "a@b.com", "key", "subj", "desc"),
    ).rejects.toThrow("403");
  });

  test("throws on invalid subdomain", async () => {
    await expect(
      createZendeskTicket("evil.com/hack", "a@b.com", "key", "subj", "desc"),
    ).rejects.toThrow("Invalid Zendesk subdomain");
  });
});

describe("createNotionPage", () => {
  const VALID_PARENT_ID = "aaaabbbbccccddddeeeeffffaaaabbbb";

  test("creates page and returns url", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "page-123", url: "https://notion.so/page-123" }),
        { status: 200 },
      ),
    );
    spies.push(spy);
    const result = await createNotionPage(
      "api-key",
      VALID_PARENT_ID,
      "My Title",
      "Content here",
    );
    expect(result.page_url).toBe("https://notion.so/page-123");
  });

  test("POSTs to the Notion pages endpoint", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p", url: "https://notion.so/p" }), {
        status: 200,
      }),
    );
    spies.push(spy);
    await createNotionPage("key", VALID_PARENT_ID, "Title", "Content");
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toBe("https://api.notion.com/v1/pages");
  });

  test("splits long content into 2000-char chunks", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p", url: "https://notion.so/p" }), {
        status: 200,
      }),
    );
    spies.push(spy);
    const longContent = "x".repeat(5000);
    await createNotionPage("key", VALID_PARENT_ID, "Title", longContent);
    const [, opts] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { children: unknown[] };
    expect(body.children.length).toBe(3); // 5000 / 2000 = 3 chunks, all within 100-block limit
  });

  test("appends blocks in batches when content exceeds 100-block limit", async () => {
    // 105 blocks × 2000 chars — first 100 in page creation, 5 remaining in one PATCH
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "page-abc", url: "https://notion.so/page-abc" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    spies.push(spy);
    const hugeContent = "x".repeat(105 * 2000);
    const result = await createNotionPage(
      "key",
      VALID_PARENT_ID,
      "Title",
      hugeContent,
    );
    expect(result.page_url).toBe("https://notion.so/page-abc");
    expect(spy).toHaveBeenCalledTimes(2);
    // First call: POST /v1/pages with 100 blocks
    const [createUrl, createOpts] = spy.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://api.notion.com/v1/pages");
    const createBody = JSON.parse(createOpts.body as string) as {
      children: unknown[];
    };
    expect(createBody.children.length).toBe(100);
    // Second call: PATCH /v1/blocks/{id}/children with remaining 5 blocks
    const [appendUrl, appendOpts] = spy.mock.calls[1] as [string, RequestInit];
    expect(appendUrl).toBe(
      "https://api.notion.com/v1/blocks/page-abc/children",
    );
    const appendBody = JSON.parse(appendOpts.body as string) as {
      children: unknown[];
    };
    expect(appendBody.children.length).toBe(5);
  });

  test("throws when block append fails", async () => {
    const spy = spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "page-abc", url: "https://notion.so/page-abc" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }));
    spies.push(spy);
    const hugeContent = "x".repeat(201 * 2000);
    await expect(
      createNotionPage("key", VALID_PARENT_ID, "Title", hugeContent),
    ).rejects.toThrow("Notion block append failed: 429");
  });

  test("throws on non-ok response", async () => {
    const spy = spyOn(global, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    spies.push(spy);
    await expect(
      createNotionPage("bad", VALID_PARENT_ID, "Title", "Content"),
    ).rejects.toThrow("401");
  });

  test("throws on invalid parent page ID", async () => {
    await expect(
      createNotionPage("key", "parent-id", "Title", "Content"),
    ).rejects.toThrow("Invalid Notion page ID");
  });
});
