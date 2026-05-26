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

import { queryNeo4jTool } from '../query-neo4j';

type QueryResult = {
  rows: Record<string, unknown>[];
  count: number;
  error?: string;
};

const ctx = {} as Parameters<NonNullable<typeof queryNeo4jTool.execute>>[1];

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeRecord(data: Record<string, unknown>) {
  const keys = Object.keys(data);
  return {
    keys,
    get: (key: string) => data[key],
  };
}

describe('queryNeo4jTool', () => {
  it('returns rows and count from a successful query', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ name: 'bug', count: neo4j.int(42) }),
        fakeRecord({ name: 'feature', count: neo4j.int(10) }),
      ],
    });

    const result = (await queryNeo4jTool.execute!(
      { cypher: 'MATCH (l:Label) RETURN l.name AS name, count(*) AS count LIMIT 5' },
      ctx,
    )) as QueryResult;

    expect(result).toEqual({
      rows: [
        { name: 'bug', count: 42 },
        { name: 'feature', count: 10 },
      ],
      count: 2,
    });
    expect(mockSession.run).toHaveBeenCalledWith(
      'MATCH (l:Label) RETURN l.name AS name, count(*) AS count LIMIT 5',
    );
  });

  it('converts neo4j integers to numbers', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [fakeRecord({ total: neo4j.int(999) })],
    });

    const result = (await queryNeo4jTool.execute!(
      { cypher: 'RETURN 999 AS total' },
      ctx,
    )) as QueryResult;

    expect(result.rows[0].total).toBe(999);
    expect(typeof result.rows[0].total).toBe('number');
  });

  it('returns empty rows on Cypher error', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('Invalid Cypher syntax'));

    const result = (await queryNeo4jTool.execute!(
      { cypher: 'INVALID QUERY' },
      ctx,
    )) as QueryResult;

    expect(result).toEqual({
      rows: [],
      count: 0,
      error: 'Invalid Cypher syntax',
    });
  });

  it('always closes the session', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('fail'));

    await queryNeo4jTool.execute!({ cypher: 'FAIL' }, ctx);

    expect(mockSession.close).toHaveBeenCalledTimes(1);
  });

  it('returns empty rows when query has no results', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });

    const result = (await queryNeo4jTool.execute!(
      { cypher: 'MATCH (n:Nothing) RETURN n LIMIT 5' },
      ctx,
    )) as QueryResult;

    expect(result).toEqual({ rows: [], count: 0 });
  });
});
