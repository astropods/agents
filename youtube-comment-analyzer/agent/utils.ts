// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface SentimentResult {
  comment: string;
  sentiment: Sentiment;
  hasReplies: boolean;
}

// ---------------------------------------------------------------------------
// Video ID extraction
// ---------------------------------------------------------------------------

export function extractVideoId(input: string): string | null {
  const short = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short) return short[1];

  const watch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watch) return watch[1];

  const shorts = input.match(/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shorts) return shorts[1];

  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();

  return null;
}

// ---------------------------------------------------------------------------
// Sentiment normalisation
// ---------------------------------------------------------------------------

const VALID_SENTIMENTS = new Set<string>(['positive', 'neutral', 'negative']);

export function normalizeSentiment(value: unknown): Sentiment {
  const s = String(value ?? '').toLowerCase().trim();
  return VALID_SENTIMENTS.has(s) ? (s as Sentiment) : 'neutral';
}

// ---------------------------------------------------------------------------
// OpenAI batch message builder
// ---------------------------------------------------------------------------

export function buildBatchUserMessage(comments: string[]): string {
  return JSON.stringify(comments.map((c, i) => `${i + 1}. ${c.slice(0, 300)}`));
}

// ---------------------------------------------------------------------------
// JSON sentiment response parser
// ---------------------------------------------------------------------------

export function parseJsonSentiments(raw: string): Sentiment[] {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(clean) as { sentiments: unknown[] };
  return parsed.sentiments.map(normalizeSentiment);
}

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

export function formatReport(results: SentimentResult[], videoId: string): string {
  const counts: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  const examples: Record<Sentiment, string[]> = { positive: [], neutral: [], negative: [] };
  const unrepliedExamples: string[] = [];

  for (const r of results) {
    counts[r.sentiment]++;
    if (examples[r.sentiment].length < 3) {
      examples[r.sentiment].push(r.comment.slice(0, 160).replace(/\n/g, ' '));
    }
    if (!r.hasReplies && unrepliedExamples.length < 5) {
      unrepliedExamples.push(r.comment.slice(0, 160).replace(/\n/g, ' '));
    }
  }

  const total = results.length;
  const unrepliedCount = results.filter(r => !r.hasReplies).length;
  const pct = (n: number) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';

  const section = (label: string, prefix: string, sentiment: Sentiment) => [
    `${label}  ${counts[sentiment]} comments (${pct(counts[sentiment])})`,
    ...examples[sentiment].map(e => `  ${prefix} "${e}"`),
  ];

  return [
    `YouTube Comment Sentiment Analysis`,
    `Video : https://youtube.com/watch?v=${videoId}`,
    `Total : ${total} comments analysed`,
    '='.repeat(65),
    '',
    ...section('POSITIVE', '+', 'positive'),
    '',
    ...section('NEUTRAL ', '~', 'neutral'),
    '',
    ...section('NEGATIVE', '-', 'negative'),
    '',
    `NEEDS REPLY  ${unrepliedCount} comments`,
    ...unrepliedExamples.map(e => `  ! "${e}"`),
    '',
    '='.repeat(65),
  ].join('\n');
}
