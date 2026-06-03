import { describe, expect, spyOn, test } from "bun:test";
import {
  buildBasicAuthHeader,
  buildJiraRequestBody,
  extractSlackIds,
  fetchSlackThread,
  parseJiraTicket,
  validateSubdomain,
} from "./utils";

// ---------------------------------------------------------------------------
// parseJiraTicket
// ---------------------------------------------------------------------------

describe("parseJiraTicket", () => {
  test("parses a valid JSON response", () => {
    const raw = JSON.stringify({
      title: "Login button broken on mobile",
      description: "Users get a 403 after OAuth redirect on iOS Safari.",
    });
    const ticket = parseJiraTicket(raw);
    expect(ticket.title).toBe("Login button broken on mobile");
    expect(ticket.description).toBe(
      "Users get a 403 after OAuth redirect on iOS Safari.",
    );
  });

  test("truncates title to 100 chars", () => {
    const raw = JSON.stringify({ title: "a".repeat(150), description: "desc" });
    expect(parseJiraTicket(raw).title).toHaveLength(100);
  });

  test("falls back to (no title) when title is missing", () => {
    const raw = JSON.stringify({ description: "Something broke" });
    expect(parseJiraTicket(raw).title).toBe("(no title)");
  });

  test("falls back to empty string when description is missing", () => {
    const raw = JSON.stringify({ title: "Bug" });
    expect(parseJiraTicket(raw).description).toBe("");
  });

  test("falls back when title is not a string", () => {
    const raw = JSON.stringify({ title: 42, description: "desc" });
    expect(parseJiraTicket(raw).title).toBe("(no title)");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseJiraTicket("not json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildJiraRequestBody
// ---------------------------------------------------------------------------

describe("buildJiraRequestBody", () => {
  const ticket = { title: "Fix the bug", description: "It crashes on load." };

  test("sets the project key", () => {
    const body = buildJiraRequestBody(ticket, "PROJ");
    expect(body.fields.project.key).toBe("PROJ");
  });

  test("sets summary to ticket title", () => {
    const body = buildJiraRequestBody(ticket, "PROJ");
    expect(body.fields.summary).toBe("Fix the bug");
  });

  test("wraps description in ADF paragraph", () => {
    const body = buildJiraRequestBody(ticket, "PROJ");
    expect(body.fields.description.type).toBe("doc");
    expect(body.fields.description.version).toBe(1);
    expect(body.fields.description.content[0].type).toBe("paragraph");
    expect(body.fields.description.content[0].content[0].text).toBe(
      "It crashes on load.",
    );
  });

  test("sets issue type to Task", () => {
    const body = buildJiraRequestBody(ticket, "PROJ");
    expect(body.fields.issuetype.name).toBe("Task");
  });
});

// ---------------------------------------------------------------------------
// buildBasicAuthHeader
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// extractSlackIds
// ---------------------------------------------------------------------------

describe("extractSlackIds", () => {
  test("parses a standard Slack thread URL", () => {
    const result = extractSlackIds(
      "https://myworkspace.slack.com/archives/C01234ABCD/p1234567890123456",
    );
    expect(result).not.toBeNull();
    expect(result?.channel).toBe("C01234ABCD");
    expect(result?.ts).toBe("1234567890.123456");
  });

  test("returns null for a non-Slack URL", () => {
    expect(extractSlackIds("https://example.com/foo")).toBeNull();
  });

  test("returns null for plain text", () => {
    expect(extractSlackIds("Login button is broken")).toBeNull();
  });

  test("returns null when timestamp has fewer than 16 digits", () => {
    expect(
      extractSlackIds("https://workspace.slack.com/archives/C01234/p123456789"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchSlackThread
// ---------------------------------------------------------------------------

describe("fetchSlackThread", () => {
  function mockFetch(body: unknown, status = 200) {
    return spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  test("returns formatted thread messages", async () => {
    const spy = mockFetch({
      ok: true,
      messages: [
        { user: "U001", text: "Something is broken" },
        { user: "U002", text: "I see it too" },
      ],
    });
    const result = await fetchSlackThread(
      "https://workspace.slack.com/archives/C01234ABCD/p1234567890123456",
      "xoxb-token",
    );
    expect(result).toBe("U001: Something is broken\nU002: I see it too");
    spy.mockRestore();
  });

  test("sends Bearer token in Authorization header", async () => {
    const spy = mockFetch({ ok: true, messages: [] });
    await fetchSlackThread(
      "https://workspace.slack.com/archives/C01234ABCD/p1234567890123456",
      "xoxb-mytoken",
    );
    const call = spy.mock.calls[0];
    expect((call[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer xoxb-mytoken",
    });
    spy.mockRestore();
  });

  test("throws when Slack API returns ok: false", async () => {
    const spy = mockFetch({ ok: false, error: "channel_not_found" });
    await expect(
      fetchSlackThread(
        "https://workspace.slack.com/archives/C01234ABCD/p1234567890123456",
        "xoxb-token",
      ),
    ).rejects.toThrow("Slack API error: channel_not_found");
    spy.mockRestore();
  });

  test("throws when given an unparseable URL", async () => {
    await expect(
      fetchSlackThread("https://example.com/not-slack", "xoxb-token"),
    ).rejects.toThrow("Cannot parse Slack URL");
  });

  test("handles missing user or text fields gracefully", async () => {
    const spy = mockFetch({
      ok: true,
      messages: [{ text: "no user here" }, { user: "U001" }],
    });
    const result = await fetchSlackThread(
      "https://workspace.slack.com/archives/C01234ABCD/p1234567890123456",
      "xoxb-token",
    );
    expect(result).toBe("unknown: no user here\nU001: ");
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// validateSubdomain
// ---------------------------------------------------------------------------

describe("validateSubdomain", () => {
  test("accepts a simple alphanumeric subdomain", () => {
    expect(validateSubdomain("mycompany")).toBe("mycompany");
  });

  test("accepts a subdomain with hyphens", () => {
    expect(validateSubdomain("my-company-123")).toBe("my-company-123");
  });

  test("accepts uppercase letters", () => {
    expect(validateSubdomain("MyCompany")).toBe("MyCompany");
  });

  test("throws for subdomain containing a dot", () => {
    expect(() => validateSubdomain("evil.attacker.com/path?")).toThrow(
      /Invalid JIRA_SUBDOMAIN/,
    );
  });

  test("throws for subdomain containing a slash", () => {
    expect(() => validateSubdomain("company/../../etc")).toThrow(
      /Invalid JIRA_SUBDOMAIN/,
    );
  });

  test("throws for subdomain containing @", () => {
    expect(() => validateSubdomain("user@evil.com")).toThrow(
      /Invalid JIRA_SUBDOMAIN/,
    );
  });

  test("throws for empty string", () => {
    expect(() => validateSubdomain("")).toThrow(/Invalid JIRA_SUBDOMAIN/);
  });

  test("throws for subdomain with spaces", () => {
    expect(() => validateSubdomain("my company")).toThrow(
      /Invalid JIRA_SUBDOMAIN/,
    );
  });
});

describe("buildBasicAuthHeader", () => {
  test("returns Basic prefix", () => {
    const header = buildBasicAuthHeader("user@example.com", "myapikey");
    expect(header).toMatch(/^Basic /);
  });

  test("correctly encodes username:apiKey", () => {
    const header = buildBasicAuthHeader("user@example.com", "myapikey");
    const encoded = header.replace("Basic ", "");
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    expect(decoded).toBe("user@example.com:myapikey");
  });

  test("handles special characters in credentials", () => {
    const header = buildBasicAuthHeader(
      "user+test@example.com",
      "key/with=special",
    );
    const decoded = Buffer.from(
      header.replace("Basic ", ""),
      "base64",
    ).toString();
    expect(decoded).toBe("user+test@example.com:key/with=special");
  });
});
