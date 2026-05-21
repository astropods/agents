import { describe, expect, test } from 'bun:test';
import {
  extractVideoId,
  normalizeSentiment,
  buildBatchUserMessage,
  parseJsonSentiments,
  formatReport,
} from './utils';
import type { SentimentResult } from './utils';

// ---------------------------------------------------------------------------
// extractVideoId
// ---------------------------------------------------------------------------

describe('extractVideoId', () => {
  test('extracts ID from youtu.be short link', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  test('extracts ID from full watch URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  test('extracts ID from watch URL with extra params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
  });

  test('extracts ID from shorts URL', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  test('returns raw 11-char ID as-is', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  test('returns null for plain text', () => {
    expect(extractVideoId('not a video')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractVideoId('')).toBeNull();
  });

  test('returns null for ID that is too short', () => {
    expect(extractVideoId('dQw4w9WgXc')).toBeNull(); // 10 chars
  });
});

// ---------------------------------------------------------------------------
// normalizeSentiment
// ---------------------------------------------------------------------------

describe('normalizeSentiment', () => {
  test('returns valid sentiments unchanged', () => {
    expect(normalizeSentiment('positive')).toBe('positive');
    expect(normalizeSentiment('neutral')).toBe('neutral');
    expect(normalizeSentiment('negative')).toBe('negative');
  });

  test('lowercases before matching', () => {
    expect(normalizeSentiment('POSITIVE')).toBe('positive');
    expect(normalizeSentiment('Neutral')).toBe('neutral');
  });

  test('falls back to neutral for unknown values', () => {
    expect(normalizeSentiment('angry')).toBe('neutral');
    expect(normalizeSentiment('mixed')).toBe('neutral');
    expect(normalizeSentiment('')).toBe('neutral');
  });

  test('falls back to neutral for null and undefined', () => {
    expect(normalizeSentiment(null)).toBe('neutral');
    expect(normalizeSentiment(undefined)).toBe('neutral');
  });

  test('falls back to neutral for non-string types', () => {
    expect(normalizeSentiment(42)).toBe('neutral');
    expect(normalizeSentiment(true)).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// buildBatchUserMessage
// ---------------------------------------------------------------------------

describe('buildBatchUserMessage', () => {
  test('produces a JSON array string', () => {
    const result = buildBatchUserMessage(['hello', 'world']);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  test('numbers comments starting at 1', () => {
    const result = buildBatchUserMessage(['first', 'second']);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
  });

  test('truncates comments at 300 chars', () => {
    const long = 'x'.repeat(400);
    const result = buildBatchUserMessage([long]);
    const parsed: string[] = JSON.parse(result);
    expect(parsed[0].length).toBeLessThanOrEqual(303); // "1. " (3 chars) + 300 chars
    expect(parsed[0]).not.toContain('x'.repeat(301));
  });

  test('handles empty array', () => {
    const result = buildBatchUserMessage([]);
    expect(JSON.parse(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseJsonSentiments
// ---------------------------------------------------------------------------

describe('parseJsonSentiments', () => {
  test('parses a plain JSON response', () => {
    const raw = JSON.stringify({ sentiments: ['positive', 'neutral', 'negative'] });
    expect(parseJsonSentiments(raw)).toEqual(['positive', 'neutral', 'negative']);
  });

  test('strips markdown code fences', () => {
    const raw = '```json\n{"sentiments":["positive","negative"]}\n```';
    expect(parseJsonSentiments(raw)).toEqual(['positive', 'negative']);
  });

  test('normalises unknown values to neutral', () => {
    const raw = JSON.stringify({ sentiments: ['positive', 'angry', 'negative'] });
    expect(parseJsonSentiments(raw)).toEqual(['positive', 'neutral', 'negative']);
  });

  test('throws on invalid JSON', () => {
    expect(() => parseJsonSentiments('not json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

function makeResult(comment: string, sentiment: SentimentResult['sentiment']): SentimentResult {
  return { comment, sentiment };
}

describe('formatReport', () => {
  test('includes video URL in output', () => {
    const report = formatReport([makeResult('great', 'positive')], 'dQw4w9WgXcQ');
    expect(report).toContain('https://youtube.com/watch?v=dQw4w9WgXcQ');
  });

  test('shows correct total count', () => {
    const results = [
      makeResult('a', 'positive'),
      makeResult('b', 'neutral'),
      makeResult('c', 'negative'),
    ];
    const report = formatReport(results, 'abc');
    expect(report).toContain('3 comments analysed');
  });

  test('shows correct counts per sentiment', () => {
    const results = [
      makeResult('a', 'positive'),
      makeResult('b', 'positive'),
      makeResult('c', 'negative'),
    ];
    const report = formatReport(results, 'abc');
    expect(report).toMatch(/POSITIVE\s+2 comments/);
    expect(report).toMatch(/NEUTRAL\s+0 comments/);
    expect(report).toMatch(/NEGATIVE\s+1 comments/);
  });

  test('shows percentage for each sentiment', () => {
    const results = [
      makeResult('a', 'positive'),
      makeResult('b', 'positive'),
      makeResult('c', 'negative'),
      makeResult('d', 'negative'),
    ];
    const report = formatReport(results, 'abc');
    expect(report).toContain('50%');
    expect(report).toContain('0%');
  });

  test('shows up to 3 examples per sentiment', () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      makeResult(`positive comment ${i}`, 'positive'),
    );
    const report = formatReport(results, 'abc');
    const matches = report.match(/\+ "/g) ?? [];
    expect(matches.length).toBe(3);
  });

  test('truncates examples at 160 chars', () => {
    const long = 'x'.repeat(200);
    const report = formatReport([makeResult(long, 'positive')], 'abc');
    expect(report).toContain('x'.repeat(160));
    expect(report).not.toContain('x'.repeat(161));
  });

  test('replaces newlines in examples', () => {
    const report = formatReport([makeResult('line1\nline2', 'neutral')], 'abc');
    expect(report).not.toContain('line1\nline2');
    expect(report).toContain('line1 line2');
  });

  test('shows 0% when there are no results', () => {
    const report = formatReport([], 'abc');
    expect(report).toContain('0 comments analysed');
    expect(report).toContain('0%');
  });
});
