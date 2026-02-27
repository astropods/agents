import { describe, it, expect, vi, beforeEach } from 'vitest';
import neo4j from 'neo4j-driver';

vi.mock('../../../src/services/neo4j', () => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn(),
  };
  const mockDriver = {
    session: vi.fn(() => mockSession),
  };
  return {
    getDriver: vi.fn(() => mockDriver),
    __mockSession: mockSession,
  };
});

import { queryNeo4jTool } from '../query-neo4j';
import { __mockSession as mockSession } from '../../../src/services/neo4j';

const session = mockSession as unknown as {
  run: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

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
    session.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ name: 'bug', count: neo4j.int(42) }),
        fakeRecord({ name: 'feature', count: neo4j.int(10) }),
      ],
    });

    const result = await queryNeo4jTool.execute!({ cypher: 'MATCH (l:Label) RETURN l.name AS name, count(*) AS count LIMIT 5' });

    expect(result).toEqual({
      rows: [
        { name: 'bug', count: 42 },
        { name: 'feature', count: 10 },
      ],
      count: 2,
    });
    expect(session.run).toHaveBeenCalledWith(
      'MATCH (l:Label) RETURN l.name AS name, count(*) AS count LIMIT 5',
    );
  });

  it('converts neo4j integers to numbers', async () => {
    session.run.mockResolvedValueOnce({
      records: [fakeRecord({ total: neo4j.int(999) })],
    });

    const result = await queryNeo4jTool.execute!({ cypher: 'RETURN 999 AS total' });

    expect(result.rows[0].total).toBe(999);
    expect(typeof result.rows[0].total).toBe('number');
  });

  it('returns empty rows on Cypher error', async () => {
    session.run.mockRejectedValueOnce(new Error('Invalid Cypher syntax'));

    const result = await queryNeo4jTool.execute!({ cypher: 'INVALID QUERY' });

    expect(result).toEqual({
      rows: [],
      count: 0,
      error: 'Invalid Cypher syntax',
    });
  });

  it('always closes the session', async () => {
    session.run.mockRejectedValueOnce(new Error('fail'));

    await queryNeo4jTool.execute!({ cypher: 'FAIL' });

    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('returns empty rows when query has no results', async () => {
    session.run.mockResolvedValueOnce({ records: [] });

    const result = await queryNeo4jTool.execute!({ cypher: 'MATCH (n:Nothing) RETURN n LIMIT 5' });

    expect(result).toEqual({ rows: [], count: 0 });
  });
});
