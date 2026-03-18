export interface GongCall {
  callId: string;
  title: string;
  startTime: Date;
  durationSeconds: number;
  accountName: string | null;
  participants: {
    name: string;
    emailAddress: string;
    affiliation: string;
    title: string;
    speakerId: string;
  }[] | null;
  callUrl: string | null;
}

export interface Utterance {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  speakerId: string | null;
}

export interface Transcript {
  callId: string;
  utterances: Utterance[];
}

const RATE_LIMIT_MS = 1000;
const MAX_RETRIES = 5;

function getAuthHeader(): string {
  const accessKey = process.env.GONG_ACCESS_KEY;
  const secret = process.env.GONG_ACCESS_KEY_SECRET;
  if (!accessKey || !secret) throw new Error('GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET required');
  const credentials = Buffer.from(`${accessKey}:${secret}`).toString('base64');
  return `Basic ${credentials}`;
}

function getBaseUrl(): string {
  const base = process.env.GONG_BASE_URL || 'https://api.gong.io';
  return base.replace(/\/$/, '');
}

let lastRequestTime = 0;

async function rateLimitedFetch(
  url: string,
  options: RequestInit
): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
      const wait = Math.min(retryAfter * 1000, Math.pow(2, attempt) * 1000);
      console.warn(`Gong rate limited, retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  throw new Error('Max retries exceeded for Gong API');
}

function extractAccountName(context: unknown[]): string | null {
  for (const ctx of context) {
    const c = ctx as { system?: string; objects?: unknown[] };
    if (c.system !== 'Salesforce') continue;
    const objects = c.objects || [];
    for (const obj of objects) {
      const o = obj as { objectType?: string; fields?: { name?: string; value?: string }[] };
      if (o.objectType !== 'Account') continue;
      const fields = o.fields || [];
      for (const f of fields) {
        if (f.name === 'Name' && f.value) return f.value;
      }
    }
  }
  return null;
}

function parseCall(
  metaData: Record<string, unknown>,
  parties: { speakerId?: string; name?: string; emailAddress?: string; affiliation?: string; title?: string }[],
  accountName: string | null
): GongCall {
  const callId = String(metaData.id ?? '');
  const title = String(metaData.title ?? '');
  const start = metaData.started ?? metaData.startTime;
  const startTime = start instanceof Date ? start : new Date(String(start));
  const durationSeconds = Number(metaData.durationSeconds ?? metaData.duration ?? 0);
  const callUrl = metaData.callUrl != null ? String(metaData.callUrl) : null;

  const participants = (parties || []).map((p) => ({
    name: String(p.name ?? ''),
    emailAddress: String(p.emailAddress ?? ''),
    affiliation: String(p.affiliation ?? ''),
    title: String(p.title ?? ''),
    speakerId: String(p.speakerId ?? ''),
  }));

  return {
    callId,
    title,
    startTime,
    durationSeconds,
    accountName,
    participants: participants.length ? participants : null,
    callUrl,
  };
}

export async function* getAllCallsExtensive(
  fromDate: Date,
  toDate: Date
): AsyncGenerator<GongCall> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();
  const fromDateTime = fromDate.toISOString();
  const toDateTime = toDate.toISOString();

  let cursor: string | null = null;

  do {
    const body: Record<string, unknown> = {
      filter: { fromDateTime, toDateTime },
      contentSelector: {
        context: 'Extended',
        exposedFields: { parties: true },
      },
    };
    if (cursor) body.cursor = cursor;

    const res = await rateLimitedFetch(`${baseUrl}/v2/calls/extensive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gong API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      calls?: { metaData?: Record<string, unknown>; context?: unknown[]; parties?: unknown[] }[];
      records?: { cursor?: string; totalRecords?: number };
    };

    const calls = data.calls || [];
    if (calls.length === 0) break;

    for (const callData of calls) {
      const metaData = callData.metaData || {};
      const context = (callData.context || []) as unknown[];
      const parties = (callData.parties || []) as { speakerId?: string; name?: string; emailAddress?: string; affiliation?: string; title?: string }[];
      const accountName = extractAccountName(context);
      yield parseCall(metaData, parties, accountName);
    }

    console.log(`  Gong: fetched ${calls.length} calls`);
    cursor = data.records?.cursor ?? null;
  } while (cursor);
}

export async function getTranscript(callId: string): Promise<Transcript> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();

  const body = {
    filter: {
      callIds: [callId],
      fromDateTime: '2021-01-01T00:00:00Z',
      toDateTime: '2030-12-31T23:59:59Z',
    },
  };

  const res = await rateLimitedFetch(`${baseUrl}/v2/calls/transcript`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gong transcript API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    callTranscripts?: {
      callId?: string;
      transcript?: {
        speakerId?: string;
        sentences?: { text?: string; start?: number; end?: number }[];
      }[];
    }[];
    speakers?: { speakerId?: string; name?: string }[];
  };

  const callTranscripts = data.callTranscripts || [];
  const speakersMap = new Map<string, string>();
  for (const s of data.speakers || []) {
    if (s.speakerId && s.name) speakersMap.set(s.speakerId, s.name);
  }

  const utterances: Utterance[] = [];
  let resolvedCallId = callId;

  for (const ct of callTranscripts) {
    if (ct.callId) resolvedCallId = ct.callId;
    const transcript = ct.transcript || [];
    for (const seg of transcript) {
      const speakerId = seg.speakerId ?? null;
      const speaker = speakerId ? speakersMap.get(speakerId) ?? `Speaker ${speakerId}` : 'Unknown';
      const sentences = seg.sentences || [];
      for (const sent of sentences) {
        const text = String(sent.text ?? '').trim();
        if (!text) continue;
        const startMs = Number(sent.start ?? 0);
        const endMs = Number(sent.end ?? startMs);
        utterances.push({
          speaker,
          text,
          startTime: startMs / 1000,
          endTime: endMs / 1000,
          speakerId,
        });
      }
    }
  }

  return { callId: resolvedCallId, utterances };
}
