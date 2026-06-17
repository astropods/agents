import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Zendesk URL + auth builders
// ---------------------------------------------------------------------------

export function buildZendeskBase(subdomain: string): string {
  if (!/^[a-z0-9-]+$/i.test(subdomain)) {
    throw new Error(`Invalid Zendesk subdomain: "${subdomain}"`);
  }
  return `https://${subdomain}.zendesk.com/api/v2`;
}

export function buildZendeskAuth(email: string, apiKey: string): string {
  return Buffer.from(`${email}/token:${apiKey}`).toString("base64");
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies a Zendesk webhook HMAC-SHA256 signature.
 * Zendesk signs requests with: HMAC-SHA256(secret, timestamp + body), base64-encoded.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyZendeskSignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(timestamp + body)
    .digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    // timingSafeEqual throws if buffers differ in length
    return false;
  }
}

/**
 * Returns true when the timestamp is within maxAgeSeconds of now.
 * Accepts epoch seconds as a numeric string (e.g. "1700000000") or any
 * string parseable by Date (e.g. ISO 8601).  Returns false for unparseable
 * input so callers can safely reject the request.
 */
export function isTimestampFresh(
  timestamp: string,
  maxAgeSeconds = 300,
): boolean {
  const parsed = Number(timestamp);
  const epochSec = Number.isNaN(parsed)
    ? new Date(timestamp).getTime() / 1000
    : parsed;
  if (Number.isNaN(epochSec)) return false;
  return Math.abs(Date.now() / 1000 - epochSec) <= maxAgeSeconds;
}

// ---------------------------------------------------------------------------
// Prompt parser
// ---------------------------------------------------------------------------

// Parses a chat prompt into a webhook payload.
// Accepts: raw JSON, a bare ticket ID number, or any text containing a number.
// Returns null when no ticket ID can be extracted and the input is not JSON.
export function parseWebhookPayload(text: string): object | null {
  try {
    const parsed = JSON.parse(text);
    // Only treat as a webhook payload if it's an object — bare numbers like
    // '12345' are valid JSON but should be handled as ticket IDs instead.
    if (parsed !== null && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // not JSON — fall through to ID extraction
  }

  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    return {
      type: "zen:event-type:ticket.created",
      detail: { id: idMatch[1] },
    };
  }
  return null;
}
