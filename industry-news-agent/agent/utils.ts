// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Article {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  description?: string;
}

export type OutputFormat = 'summary' | 'analysis' | 'key insights';

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export function deduplicate(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter(a => {
    const key = a.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export function detectFormat(text: string): { topic: string; format: OutputFormat } {
  const lower = text.toLowerCase();
  let format: OutputFormat = 'summary';

  if (lower.includes('analysis') || lower.includes('analyse') || lower.includes('analyze')) {
    format = 'analysis';
  } else if (lower.includes('key insight') || lower.includes('insights')) {
    format = 'key insights';
  }

  const topic = text
    .replace(/\b(summary|analysis|analyse|analyze|key insights?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { topic: topic || text.trim(), format };
}
