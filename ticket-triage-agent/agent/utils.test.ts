import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  buildZendeskAuth,
  buildZendeskBase,
  isTimestampFresh,
  parseWebhookPayload,
  verifyZendeskSignature,
} from "./utils";

// ---------------------------------------------------------------------------
// verifyZendeskSignature
// ---------------------------------------------------------------------------

describe("verifyZendeskSignature", () => {
  const SECRET = "test-webhook-secret";

  function makeSignature(body: string, timestamp: string): string {
    return createHmac("sha256", SECRET)
      .update(timestamp + body)
      .digest("base64");
  }

  test("returns true for a valid signature", () => {
    const body = '{"foo":"bar"}';
    const ts = "1700000000";
    expect(
      verifyZendeskSignature(body, ts, makeSignature(body, ts), SECRET),
    ).toBe(true);
  });

  test("returns false when signature is wrong", () => {
    expect(
      verifyZendeskSignature(
        '{"foo":"bar"}',
        "1700000000",
        "invalidsig",
        SECRET,
      ),
    ).toBe(false);
  });

  test("returns false when body has been tampered with", () => {
    const ts = "1700000000";
    const sig = makeSignature('{"foo":"bar"}', ts);
    expect(verifyZendeskSignature('{"foo":"tampered"}', ts, sig, SECRET)).toBe(
      false,
    );
  });

  test("returns false when timestamp differs", () => {
    const body = '{"foo":"bar"}';
    const sig = makeSignature(body, "1700000000");
    expect(verifyZendeskSignature(body, "1700000001", sig, SECRET)).toBe(false);
  });

  test("returns false for empty signature", () => {
    expect(
      verifyZendeskSignature('{"foo":"bar"}', "1700000000", "", SECRET),
    ).toBe(false);
  });

  test("returns false when secret is wrong", () => {
    const body = '{"foo":"bar"}';
    const ts = "1700000000";
    const sig = makeSignature(body, ts);
    expect(verifyZendeskSignature(body, ts, sig, "wrong-secret")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTimestampFresh
// ---------------------------------------------------------------------------

describe("isTimestampFresh", () => {
  test("returns true for a timestamp within 5 minutes", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(isTimestampFresh(String(nowSec))).toBe(true);
  });

  test("returns true for a timestamp 4 minutes old", () => {
    const ts = Math.floor(Date.now() / 1000) - 240;
    expect(isTimestampFresh(String(ts))).toBe(true);
  });

  test("returns false for a timestamp older than 5 minutes", () => {
    const ts = Math.floor(Date.now() / 1000) - 301;
    expect(isTimestampFresh(String(ts))).toBe(false);
  });

  test("returns false for a very old epoch timestamp like 1700000000", () => {
    expect(isTimestampFresh("1700000000")).toBe(false);
  });

  test("returns true for a recent ISO 8601 string", () => {
    const iso = new Date().toISOString();
    expect(isTimestampFresh(iso)).toBe(true);
  });

  test("returns false for an unparseable string", () => {
    expect(isTimestampFresh("not-a-timestamp")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isTimestampFresh("")).toBe(false);
  });

  test("respects custom maxAgeSeconds", () => {
    const ts = Math.floor(Date.now() / 1000) - 10;
    expect(isTimestampFresh(String(ts), 5)).toBe(false);
    expect(isTimestampFresh(String(ts), 30)).toBe(true);
  });
});

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

  test("throws on a subdomain containing a dot", () => {
    expect(() => buildZendeskBase("evil.com")).toThrow(
      "Invalid Zendesk subdomain",
    );
  });

  test("throws on a subdomain containing a slash", () => {
    expect(() => buildZendeskBase("evil.com/api/v2#")).toThrow(
      "Invalid Zendesk subdomain",
    );
  });

  test("throws on an empty subdomain", () => {
    expect(() => buildZendeskBase("")).toThrow("Invalid Zendesk subdomain");
  });
});

// ---------------------------------------------------------------------------
// buildZendeskAuth
// ---------------------------------------------------------------------------

describe("buildZendeskAuth", () => {
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

  test("returns null for JSON arrays", () => {
    expect(parseWebhookPayload("[1,2,3]")).toBeNull();
  });
});
