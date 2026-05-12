// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Priority = 'high' | 'medium' | 'low';
export type Sentiment = 'frustration' | 'urgency' | 'neutral' | 'positive';

export const VALID_PRIORITIES = new Set<string>(['high', 'medium', 'low']);
export const VALID_SENTIMENTS = new Set<string>(['frustration', 'urgency', 'neutral', 'positive']);

export interface IssueAnalysis {
  summary: string;
  sentiment: Sentiment;
  sentiment_details: string;
  competitive_mentions: string[];
  workarounds: string[];
  priority: Priority;
  priority_reason: string;
}

export interface AnalyzedIssue {
  number: number;
  title: string;
  url: string;
  upvotes: number;
  total_reactions: number;
  comment_count: number;
  analysis: IssueAnalysis;
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

// ---------------------------------------------------------------------------
// LLM output normalisation
// ---------------------------------------------------------------------------

export function normalizeAnalysis(raw: unknown): IssueAnalysis {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const priority = VALID_PRIORITIES.has(String(obj.priority ?? ''))
    ? (obj.priority as Priority)
    : 'low';
  const sentiment = VALID_SENTIMENTS.has(String(obj.sentiment ?? ''))
    ? (obj.sentiment as Sentiment)
    : 'neutral';
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '(no summary)',
    sentiment,
    sentiment_details: typeof obj.sentiment_details === 'string' ? obj.sentiment_details : '',
    competitive_mentions: Array.isArray(obj.competitive_mentions)
      ? obj.competitive_mentions.filter((x): x is string => typeof x === 'string')
      : [],
    workarounds: Array.isArray(obj.workarounds)
      ? obj.workarounds.filter((x): x is string => typeof x === 'string')
      : [],
    priority,
    priority_reason: typeof obj.priority_reason === 'string' ? obj.priority_reason : '',
  };
}

// ---------------------------------------------------------------------------
// Slack chunking
// ---------------------------------------------------------------------------

export function splitIntoSlackChunks(text: string, limit = 2900): string[] {
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      if (current) chunks.push(current);
      if (line.length > limit) {
        for (let i = 0; i < line.length; i += limit) {
          chunks.push(line.slice(i, i + limit));
        }
        current = '';
      } else {
        current = line;
      }
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function buildUserMessage(title: string, body: string, comments: string[]): string {
  const commentBlock =
    comments.length > 0
      ? comments.map((c, i) => `[Comment ${i + 1}]\n${c.slice(0, 500)}`).join('\n\n')
      : '(no comments)';
  return [
    `Title: ${title}`,
    '',
    `Body:\n${body.slice(0, 2000) || '(no description)'}`,
    '',
    `Comments (${comments.length} total):\n${commentBlock}`,
  ].join('\n');
}

export function formatIssueReport(issue: AnalyzedIssue): string {
  const { analysis: a } = issue;
  const lines = [
    `#${issue.number} — ${issue.title}`,
    `URL: ${issue.url}`,
    `Reactions: 👍 ${issue.upvotes} upvotes · ${issue.total_reactions} total · ${issue.comment_count} comments`,
    '',
    `Priority  : ${a.priority.toUpperCase()} — ${a.priority_reason}`,
    `Sentiment : ${a.sentiment.toUpperCase()} — ${a.sentiment_details}`,
    '',
    `Summary:\n  ${a.summary}`,
  ];

  if (a.competitive_mentions.length > 0) {
    lines.push(`\nCompetitor/alternative mentions: ${a.competitive_mentions.join(', ')}`);
  }
  if (a.workarounds.length > 0) {
    lines.push(`\nWorkarounds reported:\n${a.workarounds.map(w => `  • ${w}`).join('\n')}`);
  }

  return lines.join('\n');
}

export function formatFullReport(issues: AnalyzedIssue[], repoName: string): string {
  const sorted = [...issues].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.analysis.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.analysis.priority] ?? 2;
    return pa - pb;
  });

  const sections = [
    `Issue analysis for \`${repoName}\` — ${issues.length} issue(s)`,
    '='.repeat(70),
    '',
    ...sorted.map(issue => formatIssueReport(issue) + '\n' + '-'.repeat(70)),
  ];

  const totals = { high: 0, medium: 0, low: 0 };
  for (const i of issues) totals[i.analysis.priority]++;
  sections.push(`\nTotals — high: ${totals.high}, medium: ${totals.medium}, low: ${totals.low}`);

  return sections.join('\n');
}
