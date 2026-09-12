/**
 * Executes every Cypher query the services issue against a real Neo4j.
 *
 * The mocked-driver unit tests hand back canned records without parsing the
 * query, so an invalid statement passes them. Only a real server rejects it:
 * `fetchIssueTitles` shipped with an `ORDER BY` on a pre-aggregation variable
 * and every unit test still passed.
 */

import { Neo4jContainer, type StartedNeo4jContainer } from '@testcontainers/neo4j';
import neo4j, { type Driver } from 'neo4j-driver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: StartedNeo4jContainer;
let driver: Driver;

beforeAll(async () => {
  container = await new Neo4jContainer('neo4j:5').start();

  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_AUTH = 'basic';
  process.env.NEO4J_USERNAME = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();

  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword()),
  );

  const session = driver.session();
  try {
    await session.run(
      `CREATE (a:Issue {number: 1, issueId: 'A', title: 'cli crashes on second run',
                        state: 'OPEN', category: 'cli', subcategory: 'bug-fixes',
                        severity: 'high', impact: 'broad', effort: 'small', priorityScore: 90,
                        priorityRationale: 'blocks local dev'})
       CREATE (b:Issue {number: 2, issueId: 'B', title: 'document the deploy flow',
                        state: 'OPEN', category: 'docs', subcategory: 'documentation-updates',
                        severity: 'low', impact: 'narrow', effort: 'small', priorityScore: 30,
                        priorityRationale: 'nice to have'})
       CREATE (c:Issue {number: 3, issueId: 'C', title: 'unclassified issue', state: 'OPEN'})
       CREATE (l1:Label {name: 'cli'})
       CREATE (l2:Label {name: 'enhancement'})
       CREATE (a)-[:HAS_LABEL]->(l1)
       CREATE (a)-[:HAS_LABEL]->(l2)`,
    );
  } finally {
    await session.close();
  }
}, 180_000);

afterAll(async () => {
  const { closeDriver } = await import('../../src/services/neo4j');
  await closeDriver();
  await driver?.close();
  await container?.stop();
});

describe('subcategory vocabulary queries', () => {
  it('fetches issue titles with their labels, ordered', async () => {
    const { ensureVocabulary } = await import('../../src/services/subcategory');

    // Two issues is below the derivation floor, so this exercises the title
    // query and returns without calling the model.
    const terms = await ensureVocabulary(false, new Date(0).toISOString());

    expect(terms, 'a small corpus must not invent a vocabulary').toEqual([]);
  });

  it('round-trips a persisted vocabulary', async () => {
    const { loadVocabulary, saveVocabulary } = await import('../../src/services/subcategory');
    const session = driver.session();
    try {
      await saveVocabulary(
        session,
        [
          { name: 'error-handling', definition: 'failures surfaced badly' },
          { name: 'feature-request', definition: 'net new capability' },
        ],
        '2026-09-12T00:00:00Z',
      );

      const loaded = await loadVocabulary(session);
      expect(loaded.map((t) => t.name)).toEqual(['error-handling', 'feature-request']);
      expect(loaded[0].definition).toBe('failures surfaced badly');
    } finally {
      await session.close();
    }
  });

  it('replaces the previous vocabulary rather than accumulating terms', async () => {
    const { loadVocabulary, saveVocabulary } = await import('../../src/services/subcategory');
    const session = driver.session();
    try {
      await saveVocabulary(
        session,
        [{ name: 'only-term', definition: 'x' }],
        '2026-09-12T00:00:00Z',
      );

      const loaded = await loadVocabulary(session);
      expect(
        loaded.map((t) => t.name),
        'a refresh must not leave stale terms',
      ).toEqual(['only-term']);
    } finally {
      await session.close();
    }
  });
});

describe('label sync queries', () => {
  it('builds desired labels from the classification, skipping unclassified issues', async () => {
    const { loadDesiredLabels } = await import('../../src/services/github-labels');

    const desired = await loadDesiredLabels();
    const byNumber = new Map(desired.map((d) => [d.number, d.labels]));

    expect(byNumber.get(1)).toEqual(['area/cli', 'priority/P0', 'type/bug-fixes']);
    expect(byNumber.get(2)).toEqual(['area/docs', 'priority/P3', 'type/documentation-updates']);
    expect(byNumber.has(3), 'issue 3 has no category, so it must be skipped').toBe(false);
  });
});

describe('prioritizeIssues query', () => {
  it('returns classified issues ranked by score', async () => {
    const { prioritizeIssuesTool } = await import('../../agent/tools/prioritize-issues');

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 10, groupByCategory: false },
      {} as never,
    )) as {
      issues: { number: number; priorityScore: number }[];
      total: number;
      error?: string;
    };

    expect(result.error, 'the query must be valid Cypher').toBeUndefined();
    expect(result.issues.map((i) => i.number)).toEqual([1, 2]);
    expect(result.total, 'the unclassified issue is filtered out').toBe(2);
  });

  it('filters to a single category', async () => {
    const { prioritizeIssuesTool } = await import('../../agent/tools/prioritize-issues');

    const result = (await prioritizeIssuesTool.execute!(
      { category: 'docs', limit: 10, groupByCategory: false },
      {} as never,
    )) as { issues: { number: number }[]; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.issues.map((i) => i.number)).toEqual([2]);
  });

  it('groups by category', async () => {
    const { prioritizeIssuesTool } = await import('../../agent/tools/prioritize-issues');

    const result = (await prioritizeIssuesTool.execute!(
      { limit: 10, groupByCategory: true },
      {} as never,
    )) as { groups?: { category: string; count: number }[]; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.groups?.map((g) => g.category).sort()).toEqual(['cli', 'docs']);
  });
});
