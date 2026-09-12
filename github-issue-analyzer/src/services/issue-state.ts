/**
 * Reconciles issue open/closed state in the graph against GitHub.
 *
 * The startup sync fetches `ISSUE_STATE=open`, so an issue closed after it was
 * ingested is never re-fetched and keeps a stale OPEN state. The scheduled sync
 * uses `all` but only sees issues touched since its last run, so it cannot clear
 * the backlog. This asks GitHub for the current state of every issue we hold.
 */

import neo4j from 'neo4j-driver';
import { fetchWithRetry } from './http';
import { getDriver } from './neo4j';

export interface LiveIssue {
  number: number;
  state: string;
  closedAt: string | null;
  updatedAt: string;
}

export interface StateDrift {
  number: number;
  storedState: string;
  liveState: string;
  closedAt: string | null;
}

export interface ReconcileResult {
  checked: number;
  resolved: number;
  unresolved: number[];
  drift: StateDrift[];
  applied: number;
  dryRun: boolean;
  error?: string;
}

const BATCH = 50;

/** Current state of each issue, fetched in aliased batches to bound request count. */
export async function fetchLiveStates(
  owner: string,
  repo: string,
  numbers: number[],
): Promise<Map<number, LiveIssue>> {
  const live = new Map<number, LiveIssue>();

  for (let i = 0; i < numbers.length; i += BATCH) {
    const fields = numbers
      .slice(i, i + BATCH)
      .map((n) => `i${n}: issue(number:${n}){ number state closedAt updatedAt }`)
      .join('\n');

    const res = await fetchWithRetry(
      () =>
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ ${fields} } }`,
            variables: { owner, repo },
          }),
        }),
      'GitHub issue states',
    );
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);

    const json = (await res.json()) as {
      data?: { repository: Record<string, LiveIssue | null> };
      errors?: { message: string }[];
    };
    if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
    for (const v of Object.values(json.data?.repository ?? {})) {
      if (v) live.set(v.number, v);
    }
  }

  return live;
}

/** Compares stored state against live state. Pure, so the diff is testable. */
export function findDrift(
  stored: { number: number; state: string }[],
  live: Map<number, LiveIssue>,
): StateDrift[] {
  const drift: StateDrift[] = [];
  for (const row of stored) {
    const l = live.get(row.number);
    if (l && l.state !== row.state) {
      drift.push({
        number: row.number,
        storedState: row.state,
        liveState: l.state,
        closedAt: l.closedAt,
      });
    }
  }
  return drift;
}

export async function reconcileIssueState(opts: {
  owner: string;
  repo: string;
  dryRun: boolean;
}): Promise<ReconcileResult> {
  const { owner, repo, dryRun } = opts;
  const session = getDriver().session();

  try {
    const stored = await session.run(
      `MATCH (i:Issue) RETURN i.number AS number, i.state AS state ORDER BY i.number`,
    );
    const rows = stored.records.map((r) => ({
      number: neo4j.int(r.get('number')).toNumber(),
      state: r.get('state') as string,
    }));

    if (rows.length === 0) {
      return { checked: 0, resolved: 0, unresolved: [], drift: [], applied: 0, dryRun };
    }

    const live = await fetchLiveStates(
      owner,
      repo,
      rows.map((r) => r.number),
    );
    const drift = findDrift(rows, live);
    const unresolved = rows.filter((r) => !live.has(r.number)).map((r) => r.number);

    if (dryRun || drift.length === 0) {
      return {
        checked: rows.length,
        resolved: live.size,
        unresolved,
        drift,
        applied: 0,
        dryRun,
      };
    }

    let applied = 0;
    for (const d of drift) {
      const l = live.get(d.number) as LiveIssue;
      await session.run(
        `MATCH (i:Issue {number: $n})
         SET i.state = $state, i.closedAt = $closedAt, i.updatedAt = $updatedAt`,
        { n: d.number, state: l.state, closedAt: l.closedAt, updatedAt: l.updatedAt },
      );
      applied++;
    }

    return { checked: rows.length, resolved: live.size, unresolved, drift, applied, dryRun: false };
  } finally {
    await session.close();
  }
}
