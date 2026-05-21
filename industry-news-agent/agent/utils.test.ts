import { describe, expect, test } from 'bun:test';
import { deduplicate, detectFormat } from './utils';
import type { Article } from './utils';

function makeArticle(title: string, source = 'TestSource'): Article {
  return { title, url: `https://example.com/${title}`, source };
}

// ---------------------------------------------------------------------------
// deduplicate
// ---------------------------------------------------------------------------

describe('deduplicate', () => {
  test('returns all articles when titles are unique', () => {
    const articles = [makeArticle('Article A'), makeArticle('Article B'), makeArticle('Article C')];
    expect(deduplicate(articles)).toHaveLength(3);
  });

  test('removes exact duplicate titles', () => {
    const articles = [makeArticle('Same Title'), makeArticle('Same Title')];
    expect(deduplicate(articles)).toHaveLength(1);
  });

  test('deduplicates case-insensitively', () => {
    const articles = [makeArticle('AI News'), makeArticle('ai news'), makeArticle('AI NEWS')];
    expect(deduplicate(articles)).toHaveLength(1);
  });

  test('deduplicates after trimming whitespace', () => {
    const articles = [makeArticle('  spaced title  '), makeArticle('spaced title')];
    expect(deduplicate(articles)).toHaveLength(1);
  });

  test('preserves the first occurrence', () => {
    const first = makeArticle('Duplicate', 'Source A');
    const second = makeArticle('Duplicate', 'Source B');
    const result = deduplicate([first, second]);
    expect(result[0].source).toBe('Source A');
  });

  test('preserves insertion order of unique articles', () => {
    const articles = [makeArticle('C'), makeArticle('A'), makeArticle('B')];
    const result = deduplicate(articles);
    expect(result.map(a => a.title)).toEqual(['C', 'A', 'B']);
  });

  test('does not deduplicate titles that differ only in internal whitespace', () => {
    const articles = [makeArticle('AI  News'), makeArticle('AI News')];
    expect(deduplicate(articles)).toHaveLength(2);
  });

  test('handles empty array', () => {
    expect(deduplicate([])).toEqual([]);
  });

  test('handles single article', () => {
    const articles = [makeArticle('Only One')];
    expect(deduplicate(articles)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  test('defaults to summary format', () => {
    expect(detectFormat('AI news').format).toBe('summary');
    expect(detectFormat('startup funding').format).toBe('summary');
  });

  test('detects "analysis" keyword', () => {
    expect(detectFormat('startup funding analysis').format).toBe('analysis');
  });

  test('detects "analyse" keyword', () => {
    expect(detectFormat('analyse electric vehicles').format).toBe('analysis');
  });

  test('detects "analyze" keyword', () => {
    expect(detectFormat('analyze quantum computing').format).toBe('analysis');
  });

  test('detects "key insights" keyword', () => {
    expect(detectFormat('AI news key insights').format).toBe('key insights');
  });

  test('detects "insights" keyword', () => {
    expect(detectFormat('fintech insights').format).toBe('key insights');
  });

  test('detects "key insight" singular', () => {
    expect(detectFormat('crypto key insight').format).toBe('key insights');
  });

  test('detection is case-insensitive', () => {
    expect(detectFormat('ANALYSIS of AI').format).toBe('analysis');
    expect(detectFormat('Key Insights on fintech').format).toBe('key insights');
  });

  test('analysis takes priority over insights when both present', () => {
    expect(detectFormat('analysis key insights').format).toBe('analysis');
  });

  test('strips format keyword from topic', () => {
    expect(detectFormat('startup funding analysis').topic).toBe('startup funding');
    expect(detectFormat('AI news key insights').topic).toBe('AI news');
  });

  test('strips "analyse" and "analyze" from topic', () => {
    expect(detectFormat('analyse electric vehicles').topic).toBe('electric vehicles');
    expect(detectFormat('analyze quantum computing').topic).toBe('quantum computing');
  });

  test('collapses extra whitespace after stripping', () => {
    const { topic } = detectFormat('AI   analysis   news');
    expect(topic).toBe('AI news');
  });

  test('falls back to original text when topic becomes empty after stripping', () => {
    expect(detectFormat('summary').topic).toBe('summary');
  });

  test('returns trimmed topic', () => {
    const { topic } = detectFormat('  AI news  ');
    expect(topic).toBe('AI news');
  });
});
