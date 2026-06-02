import { describe, expect, test } from "bun:test";
import {
  buildBasicAuthHeader,
  buildJiraRequestBody,
  parseJiraTicket,
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
