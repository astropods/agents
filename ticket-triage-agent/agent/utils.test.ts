import { describe, expect, test } from "bun:test";
import {
  buildZendeskAuth,
  buildZendeskBase,
  parseWebhookPayload,
} from "./utils";

// ---------------------------------------------------------------------------
// buildZendeskBase
// ---------------------------------------------------------------------------

describe("buildZendeskBase", () => {
  test("builds correct Zendesk API base URL", () => {
    expect(buildZendeskBase("mycompany")).toBe(
      "https://mycompany.zendesk.com/api/v2",
    );
  });

  test("uses the subdomain as-is", () => {
    expect(buildZendeskBase("acme-corp")).toBe(
      "https://acme-corp.zendesk.com/api/v2",
    );
  });
});

// ---------------------------------------------------------------------------
// buildZendeskAuth
// ---------------------------------------------------------------------------

describe("buildZendeskAuth", () => {
  test("returns a base64-encoded string", () => {
    const result = buildZendeskAuth("agent@example.com", "myapikey");
    expect(() => Buffer.from(result, "base64")).not.toThrow();
  });

  test("encodes email/token:apiKey format", () => {
    const result = buildZendeskAuth("agent@example.com", "myapikey");
    const decoded = Buffer.from(result, "base64").toString("utf-8");
    expect(decoded).toBe("agent@example.com/token:myapikey");
  });

  test("different credentials produce different tokens", () => {
    const a = buildZendeskAuth("user1@example.com", "key1");
    const b = buildZendeskAuth("user2@example.com", "key2");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// parseWebhookPayload
// ---------------------------------------------------------------------------

describe("parseWebhookPayload", () => {
  test("parses a full webhook JSON payload", () => {
    const input = JSON.stringify({
      type: "zen:event-type:ticket.created",
      detail: { id: "12345" },
    });
    const result = parseWebhookPayload(input) as {
      type: string;
      detail: { id: string };
    };
    expect(result.type).toBe("zen:event-type:ticket.created");
    expect(result.detail.id).toBe("12345");
  });

  test("wraps a bare ticket ID in a ticket.created payload", () => {
    const result = parseWebhookPayload("12345") as {
      type: string;
      detail: { id: string };
    };
    expect(result.type).toBe("zen:event-type:ticket.created");
    expect(result.detail.id).toBe("12345");
  });

  test("extracts ticket ID from natural language", () => {
    const result = parseWebhookPayload("check ticket 99876") as {
      detail: { id: string };
    };
    expect(result.detail.id).toBe("99876");
  });

  test("extracts the first number when multiple are present", () => {
    const result = parseWebhookPayload("ticket 111 or 222") as {
      detail: { id: string };
    };
    expect(result.detail.id).toBe("111");
  });

  test("returns null for plain text with no numbers", () => {
    expect(parseWebhookPayload("the login button is broken")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseWebhookPayload("")).toBeNull();
  });

  test("returns parsed JSON for any valid JSON, not just ticket payloads", () => {
    const input = JSON.stringify({ foo: "bar" });
    const result = parseWebhookPayload(input) as { foo: string };
    expect(result.foo).toBe("bar");
  });

  test("passes JSON arrays through as payloads", () => {
    const result = parseWebhookPayload("[1,2,3]");
    expect(Array.isArray(result)).toBe(true);
  });
});
