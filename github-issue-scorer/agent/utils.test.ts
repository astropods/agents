import { describe, expect, test } from 'bun:test';
import {
  normalizeAnalysis,
  splitIntoSlackChunks,
  formatFullReport,
  buildUserMessage,
} from './utils';
import type { AnalyzedIssue } from './utils';

// ---------------------------------------------------------------------------
// normalizeAnalysis
// ---------------------------------------------------------------------------

describe('normalizeAnalysis', () => {
  test('passes through a valid analysis unchanged', () => {
    const input = {
      summary: 'A bug.',
      sentiment: 'frustration',
      sentiment_details: 'Users are upset.',
      competitive_mentions: ['competitor-x'],
      workarounds: ['use flag --foo'],
      priority: 'high',
      priority_reason: 'Causes data loss.',
    };
    const result = normalizeAnalysis(input);
    expect(result.priority).toBe('high');
    expect(result.sentiment).toBe('frustration');
    expect(result.competitive_mentions).toEqual(['competitor-x']);
    expect(result.workarounds).toEqual(['use flag --foo']);
  });

  test('falls back to "low" for unknown priority', () => {
    expect(normalizeAnalysis({ priority: 'critical' }).priority).toBe('low');
    expect(normalizeAnalysis({ priority: '' }).priority).toBe('low');
    expect(normalizeAnalysis({ priority: 123 }).priority).toBe('low');
  });

  test('falls back to "neutral" for unknown sentiment', () => {
    expect(normalizeAnalysis({ sentiment: 'angry' }).sentiment).toBe('neutral');
    expect(normalizeAnalysis({}).sentiment).toBe('neutral');
  });

  test('falls back to "(no summary)" for missing summary', () => {
    expect(normalizeAnalysis({}).summary).toBe('(no summary)');
    expect(normalizeAnalysis({ summary: 42 }).summary).toBe('(no summary)');
  });

  test('returns empty arrays for missing/invalid array fields', () => {
    const result = normalizeAnalysis({ competitive_mentions: 'foo', workarounds: null });
    expect(result.competitive_mentions).toEqual([]);
    expect(result.workarounds).toEqual([]);
  });

  test('filters non-string entries from array fields', () => {
    const result = normalizeAnalysis({
      competitive_mentions: ['validTool', 42, null, 'anotherTool'],
      workarounds: [true, 'use workaround', undefined],
    });
    expect(result.competitive_mentions).toEqual(['validTool', 'anotherTool']);
    expect(result.workarounds).toEqual(['use workaround']);
  });

  test('handles null and non-object input gracefully', () => {
    expect(() => normalizeAnalysis(null)).not.toThrow();
    expect(() => normalizeAnalysis('string')).not.toThrow();
    expect(() => normalizeAnalysis(42)).not.toThrow();
    expect(normalizeAnalysis(null).priority).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// splitIntoSlackChunks
// ---------------------------------------------------------------------------

describe('splitIntoSlackChunks', () => {
  test('returns single chunk for short text', () => {
    const chunks = splitIntoSlackChunks('hello\nworld');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('hello\nworld');
  });

  test('splits on line boundaries, not mid-word', () => {
    const line1 = 'a'.repeat(2800);
    const line2 = 'b'.repeat(2800);
    const text = `${line1}\n${line2}`;
    const chunks = splitIntoSlackChunks(text, 2900);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  test('hard-splits a single line longer than limit', () => {
    const longLine = 'x'.repeat(6000);
    const chunks = splitIntoSlackChunks(longLine, 2900);
    expect(chunks).toHaveLength(3); // 2900 + 2900 + 200
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2900);
    }
  });

  test('no chunk exceeds the limit', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(50)}`);
    const chunks = splitIntoSlackChunks(lines.join('\n'), 2900);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2900);
    }
  });

  test('reassembling chunks preserves full content', () => {
    const original = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
    const chunks = splitIntoSlackChunks(original, 100);
    expect(chunks.join('\n')).toBe(original);
  });

  test('handles empty string', () => {
    expect(splitIntoSlackChunks('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatFullReport — sorting
// ---------------------------------------------------------------------------

function makeIssue(n: number, priority: 'high' | 'medium' | 'low'): AnalyzedIssue {
  return {
    number: n,
    title: `Issue ${n}`,
    url: `https://github.com/owner/repo/issues/${n}`,
    upvotes: 0,
    total_reactions: 0,
    comment_count: 0,
    analysis: {
      summary: 'Summary.',
      sentiment: 'neutral',
      sentiment_details: '',
      competitive_mentions: [],
      workarounds: [],
      priority,
      priority_reason: 'reason',
    },
  };
}

describe('formatFullReport', () => {
  test('sorts issues high → medium → low', () => {
    const issues = [makeIssue(1, 'low'), makeIssue(2, 'high'), makeIssue(3, 'medium')];
    const report = formatFullReport(issues, 'owner/repo');
    const highPos = report.indexOf('Issue 2');
    const medPos = report.indexOf('Issue 3');
    const lowPos = report.indexOf('Issue 1');
    expect(highPos).toBeLessThan(medPos);
    expect(medPos).toBeLessThan(lowPos);
  });

  test('includes totals line', () => {
    const issues = [makeIssue(1, 'high'), makeIssue(2, 'high'), makeIssue(3, 'low')];
    const report = formatFullReport(issues, 'owner/repo');
    expect(report).toContain('high: 2');
    expect(report).toContain('medium: 0');
    expect(report).toContain('low: 1');
  });

  test('includes repo name in header', () => {
    const report = formatFullReport([makeIssue(1, 'low')], 'pallets/flask');
    expect(report).toContain('pallets/flask');
  });
});

// ---------------------------------------------------------------------------
// buildUserMessage
// ---------------------------------------------------------------------------

describe('buildUserMessage', () => {
  test('includes title, body, and comments', () => {
    const msg = buildUserMessage('My bug', 'It crashes.', ['comment one', 'comment two']);
    expect(msg).toContain('Title: My bug');
    expect(msg).toContain('It crashes.');
    expect(msg).toContain('[Comment 1]');
    expect(msg).toContain('[Comment 2]');
  });

  test('shows (no comments) when empty', () => {
    const msg = buildUserMessage('title', 'body', []);
    expect(msg).toContain('(no comments)');
  });

  test('shows (no description) when body is empty', () => {
    const msg = buildUserMessage('title', '', []);
    expect(msg).toContain('(no description)');
  });

  test('truncates body at 2000 chars', () => {
    const longBody = 'x'.repeat(3000);
    const msg = buildUserMessage('title', longBody, []);
    expect(msg).toContain('x'.repeat(2000));
    expect(msg).not.toContain('x'.repeat(2001));
  });

  test('truncates each comment at 500 chars', () => {
    const longComment = 'c'.repeat(600);
    const msg = buildUserMessage('title', 'body', [longComment]);
    expect(msg).toContain('c'.repeat(500));
    expect(msg).not.toContain('c'.repeat(501));
  });
});
