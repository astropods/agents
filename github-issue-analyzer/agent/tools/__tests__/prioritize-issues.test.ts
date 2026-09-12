import neo4j from 'neo4j-driver';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockDriver } = vi.hoisted(() => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn(),
  };
  const mockDriver = {
    session: vi.fn(() => mockSession),
  };
  return { mockSession, mockDriver };
});

vi.mock('../../../src/services/neo4j', () => ({
  getDriver: vi.fn(() => mockDriver),
}));

import { prioritizeIssuesTool } from '../prioritize-issues';

type PrioritizeResult = {
  issues: { number: number; category: string | null; priorityScore: number | null }[];
  groups?: { category: string; count: number; issues: { number: number }[] }[];
  total: number;
  error?: string;
};

const ctx = {} as Parameters<NonNullable<typeof prioritizeIssuesTool.execute>>[1];

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeRecord(data: Record<string, unknown>) {
  return { keys: Object.keys(data), get: (key: string) => data[key] };
}

function issueRecord(number: number, category: string, priorityScore: number) {
  return fakeRecord({
    number: neo4j.int(number),
    title: `Issue ${number}`,
    category,
    severity: 'high',
    impact: 'broad',
    effort: 'small',
    priorityScore: neo4j.int(priorityScore),
    priorityRationale: 'because',
  });
}

describe('prioritizeIssuesTool', () => {
  it('returns issues ranked highest score first', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [issueRecord(1, 'backend', 90), issueRecord(2, 'frontend', 55)],
    });

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 20, groupByCategory: false },
      ctx,
    )) as PrioritizeResult;

    expect(result.issues.map((i) => i.number)).toEqual([1, 2]);
    expect(result.total).toBe(2);
  });

  it('converts neo4j integers to plain numbers', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [issueRecord(42, 'cli', 73)] });

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 20, groupByCategory: false },
      ctx,
    )) as PrioritizeResult;

    expect(result.issues[0].number, 'number must not be a neo4j Integer').toBe(42);
    expect(result.issues[0].priorityScore).toBe(73);
  });

  it('passes the category filter to Cypher and null when unfiltered', async () => {
    mockSession.run.mockResolvedValue({ records: [] });

    await prioritizeIssuesTool.execute!(
      { category: 'security', limit: 5, groupByCategory: false },
      ctx,
    );
    expect(mockSession.run.mock.calls[0][1]).toEqual({ category: 'security' });

    await prioritizeIssuesTool.execute!({ limit: 5, groupByCategory: false }, ctx);
    expect(mockSession.run.mock.calls[1][1]).toEqual({ category: null });
  });

  it('excludes unclassified issues so pre-classification rows never rank', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });

    await prioritizeIssuesTool.execute!({ limit: 20, groupByCategory: false }, ctx);

    expect(mockSession.run.mock.calls[0][0]).toContain('i.priorityScore IS NOT NULL');
  });

  it('applies limit to the flat list', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        issueRecord(1, 'backend', 90),
        issueRecord(2, 'backend', 80),
        issueRecord(3, 'backend', 70),
      ],
    });

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 2, groupByCategory: false },
      ctx,
    )) as PrioritizeResult;

    expect(result.issues).toHaveLength(2);
    expect(result.total, 'total reflects all matches, not the truncated page').toBe(3);
  });

  it('groups by category ordered by group size, limiting within each group', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        issueRecord(1, 'backend', 90),
        issueRecord(2, 'backend', 80),
        issueRecord(3, 'backend', 70),
        issueRecord(4, 'docs', 60),
      ],
    });

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 2, groupByCategory: true },
      ctx,
    )) as PrioritizeResult;

    expect(result.groups?.map((g) => g.category)).toEqual(['backend', 'docs']);
    expect(result.groups?.[0].count, 'count is the full group size').toBe(3);
    expect(result.groups?.[0].issues, 'issues are capped by limit').toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it('returns the error message instead of throwing when Cypher fails', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('connection lost'));

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 20, groupByCategory: false },
      ctx,
    )) as PrioritizeResult;

    expect(result.error).toBe('connection lost');
    expect(result.issues).toEqual([]);
  });

  it('always closes the session, including on failure', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('boom'));
    await prioritizeIssuesTool.execute!({ limit: 20, groupByCategory: false }, ctx);
    expect(mockSession.close).toHaveBeenCalledTimes(1);
  });

  it('opens the session in read-only mode', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    await prioritizeIssuesTool.execute!({ limit: 20, groupByCategory: false }, ctx);
    expect(mockDriver.session).toHaveBeenCalledWith({
      defaultAccessMode: neo4j.session.READ,
    });
  });
});
