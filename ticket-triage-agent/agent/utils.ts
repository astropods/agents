// ---------------------------------------------------------------------------
// Zendesk URL + auth builders
// ---------------------------------------------------------------------------

export function buildZendeskBase(subdomain: string): string {
  return `https://${subdomain}.zendesk.com/api/v2`;
}

export function buildZendeskAuth(email: string, apiKey: string): string {
  return Buffer.from(`${email}/token:${apiKey}`).toString("base64");
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
