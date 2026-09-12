/**
 * Shared GitHub HTTP retry policy.
 *
 * Both the GraphQL read client and the REST label writer talk to the same API
 * and hit the same rate limits, so the backoff lives here rather than in each.
 */

const MAX_RETRIES = 5;
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
const MAX_BACKOFF_MS = 30_000;

/** GitHub asks for roughly one write per second; anything faster risks a secondary limit. */
export const WRITE_INTERVAL_MS = 1000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffFor(attempt: number, res: Response): number {
  const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0)
    return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

/**
 * Calls `send` until it returns a non-retryable response or the retries run out.
 * Returns the final Response; the caller decides what a non-ok status means.
 */
export async function fetchWithRetry(
  send: () => Promise<Response>,
  label: string,
): Promise<Response> {
  let res = await send();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (res.ok || !RETRY_STATUS_CODES.has(res.status)) return res;

    const backoff = backoffFor(attempt, res);
    console.warn(
      `  ${label}: HTTP ${res.status}, retrying in ${backoff / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
    );
    await sleep(backoff);
    res = await send();
  }

  return res;
}
