import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isManaged,
  labelsInUseAfter,
  planLabelChanges,
  priorityBand,
  selectChunk,
  selectOrphans,
  syncLabels,
} from '../github-labels';

const MANAGED = 'Derived by github-issue-analyzer';
const OWNER = 'o';
const REPO = 'r';

const session = vi.hoisted(() => ({
  run: vi.fn(),
  close: vi.fn(async () => {}),
}));

vi.mock('../neo4j', () => ({
  getDriver: () => ({ session: () => session }),
}));

vi.mock('../http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../http')>()),
  WRITE_INTERVAL_MS: 0,
  sleep: vi.fn(async () => {}),
}));

describe('priorityBand', () => {
  it('maps scores to bands at the documented boundaries', () => {
    expect(priorityBand(100)).toBe('P0');
    expect(priorityBand(80)).toBe('P0');
    expect(priorityBand(79)).toBe('P1');
    expect(priorityBand(60)).toBe('P1');
    expect(priorityBand(59)).toBe('P2');
    expect(priorityBand(40)).toBe('P2');
    expect(priorityBand(39)).toBe('P3');
    expect(priorityBand(0)).toBe('P3');
  });
});

describe('isManaged', () => {
  it('claims only the three derived namespaces', () => {
    expect(isManaged('area/backend')).toBe(true);
    expect(isManaged('type/feature-request')).toBe(true);
    expect(isManaged('priority/P1')).toBe(true);
  });

  it('disclaims every human label seen on the repo', () => {
    for (const name of ['bug', 'enhancement', 'good first issue', 'front end', 'security']) {
      expect(isManaged(name), `${name} is human-managed and must not be touched`).toBe(false);
    }
  });
});

describe('planLabelChanges', () => {
  it('adds the derived labels to an unlabelled issue', () => {
    const plan = planLabelChanges(
      [{ number: 1, labels: ['area/backend', 'priority/P1'] }],
      new Map([[1, []]]),
    );

    expect(plan).toEqual([{ issueNumber: 1, add: ['area/backend', 'priority/P1'], remove: [] }]);
  });

  it('plans nothing when the issue already carries exactly the derived labels', () => {
    const plan = planLabelChanges(
      [{ number: 1, labels: ['area/backend', 'priority/P1'] }],
      new Map([[1, ['area/backend', 'priority/P1']]]),
    );

    expect(plan, 'a correct issue must produce no API calls').toEqual([]);
  });

  it('never removes a label outside the managed namespaces', () => {
    const plan = planLabelChanges(
      [{ number: 1, labels: ['area/backend'] }],
      new Map([[1, ['bug', 'good first issue', 'front end']]]),
    );

    expect(plan[0].remove, 'human labels must survive untouched').toEqual([]);
    expect(plan[0].add).toEqual(['area/backend']);
  });

  it('removes a stale managed label when the classification changes', () => {
    const plan = planLabelChanges(
      [{ number: 1, labels: ['area/frontend', 'priority/P0'] }],
      new Map([[1, ['area/backend', 'priority/P0', 'bug']]]),
    );

    expect(plan[0].add).toEqual(['area/frontend']);
    expect(plan[0].remove, 'only the stale managed label goes').toEqual(['area/backend']);
  });

  it('treats an issue missing from GitHub as having no labels', () => {
    const plan = planLabelChanges([{ number: 99, labels: ['area/docs'] }], new Map());

    expect(plan).toEqual([{ issueNumber: 99, add: ['area/docs'], remove: [] }]);
  });

  it('is idempotent: re-planning its own result produces no further changes', () => {
    const desired = [{ number: 1, labels: ['area/cli', 'type/error-handling', 'priority/P2'] }];
    const first = planLabelChanges(desired, new Map([[1, ['bug']]]));
    const applied = new Map([[1, ['bug', ...first[0].add]]]);

    expect(planLabelChanges(desired, applied)).toEqual([]);
  });
});

describe('selectChunk', () => {
  const plan = [1, 2, 3, 4].map((n) => ({ issueNumber: n, add: ['area/cli'], remove: [] }));

  it('returns the whole plan when no limit is given', () => {
    expect(selectChunk(plan)).toHaveLength(4);
    expect(selectChunk(plan, 0), '0 means unlimited, matching ISSUE_LIMIT').toHaveLength(4);
  });

  it('takes the first N when limited', () => {
    expect(selectChunk(plan, 2).map((p) => p.issueNumber)).toEqual([1, 2]);
  });

  it('is a no-op when the limit exceeds the plan', () => {
    expect(selectChunk(plan, 99)).toHaveLength(4);
  });

  it('advances without a cursor, because applied issues leave the plan', () => {
    const applied = new Set(selectChunk(plan, 2).map((p) => p.issueNumber));
    const nextRound = plan.filter((p) => !applied.has(p.issueNumber));

    expect(
      selectChunk(nextRound, 2).map((p) => p.issueNumber),
      'a re-plan after applying the first chunk yields the next one',
    ).toEqual([3, 4]);
  });
});

describe('labelsInUseAfter', () => {
  it('drops a label the plan takes off its last issue', () => {
    const inUse = labelsInUseAfter(new Map([[1, ['area/backend', 'bug']]]), [
      { issueNumber: 1, add: ['area/frontend'], remove: ['area/backend'] },
    ]);

    expect(inUse.has('area/backend')).toBe(false);
    expect([...inUse].sort()).toEqual(['area/frontend', 'bug']);
  });

  it('keeps a label another issue still carries', () => {
    const inUse = labelsInUseAfter(
      new Map([
        [1, ['area/backend']],
        [2, ['area/backend']],
      ]),
      [{ issueNumber: 1, add: [], remove: ['area/backend'] }],
    );

    expect(inUse.has('area/backend')).toBe(true);
  });

  it('counts a label added to an issue GitHub has not listed', () => {
    const inUse = labelsInUseAfter(new Map(), [
      { issueNumber: 99, add: ['area/docs'], remove: [] },
    ]);

    expect(inUse.has('area/docs'), 'a just-added label cannot be an orphan').toBe(true);
  });
});

describe('selectOrphans', () => {
  const unused = new Set(['area/frontend']);

  it('claims an unused managed label this agent created', () => {
    const orphans = selectOrphans([{ name: 'area/backend', description: MANAGED }], unused);

    expect(orphans).toEqual(['area/backend']);
  });

  it('disclaims a label with someone else description', () => {
    const orphans = selectOrphans(
      [
        { name: 'area/backend', description: 'kept by hand' },
        { name: 'type/legacy', description: null },
      ],
      unused,
    );

    expect(orphans, 'only labels this agent created may be deleted').toEqual([]);
  });

  it('disclaims an unmanaged label however unused', () => {
    const orphans = selectOrphans([{ name: 'bug', description: MANAGED }], unused);

    expect(orphans).toEqual([]);
  });

  it('disclaims a managed label that is still in use', () => {
    const orphans = selectOrphans([{ name: 'area/frontend', description: MANAGED }], unused);

    expect(orphans).toEqual([]);
  });
});

interface FakeRepo {
  issues: Map<number, string[]>;
  labels: Map<string, string | null>;
}

interface FakeCall {
  method: string;
  path: string;
  body?: { name?: string; description?: string; labels?: string[] };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** A GitHub stand-in that applies the writes, so cleanup sees their effect. */
function installFetch(repo: FakeRepo, failIssueListAfter?: number): FakeCall[] {
  const calls: FakeCall[] = [];
  const issueLabels = new RegExp(`^/repos/${OWNER}/${REPO}/issues/(\\d+)/labels$`);
  const issueLabel = new RegExp(`^/repos/${OWNER}/${REPO}/issues/(\\d+)/labels/(.+)$`);
  const repoLabel = new RegExp(`^/repos/${OWNER}/${REPO}/labels/(.+)$`);
  let issueListReads = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? 'GET';
      const path = url.replace('https://api.github.com', '');
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const page = Number(new URL(url).searchParams.get('page') ?? '1');

      if (method === 'GET' && path.startsWith(`/repos/${OWNER}/${REPO}/issues?`)) {
        if (page === 1) issueListReads++;
        if (failIssueListAfter && issueListReads > failIssueListAfter) {
          return new Response(null, { status: 403 });
        }
        if (page > 1) return jsonResponse([]);
        return jsonResponse(
          [...repo.issues].map(([number, labels]) => ({
            number,
            labels: labels.map((name) => ({ name })),
          })),
        );
      }

      if (method === 'GET' && path.startsWith(`/repos/${OWNER}/${REPO}/labels?`)) {
        if (page > 1) return jsonResponse([]);
        return jsonResponse([...repo.labels].map(([name, description]) => ({ name, description })));
      }

      if (method === 'POST' && path === `/repos/${OWNER}/${REPO}/labels`) {
        repo.labels.set(body.name, body.description ?? null);
        return new Response('', { status: 201 });
      }

      const added = method === 'POST' && path.match(issueLabels);
      if (added) {
        const number = Number(added[1]);
        repo.issues.set(number, [...(repo.issues.get(number) ?? []), ...body.labels]);
        return new Response('', { status: 200 });
      }

      const detached = method === 'DELETE' && path.match(issueLabel);
      if (detached) {
        const number = Number(detached[1]);
        const name = decodeURIComponent(detached[2]);
        repo.issues.set(
          number,
          (repo.issues.get(number) ?? []).filter((l) => l !== name),
        );
        return new Response('', { status: 200 });
      }

      const deleted = method === 'DELETE' && path.match(repoLabel);
      if (deleted) {
        const name = decodeURIComponent(deleted[1]);
        repo.labels.delete(name);
        for (const [number, labels] of repo.issues) {
          repo.issues.set(
            number,
            labels.filter((l) => l !== name),
          );
        }
        return new Response(null, { status: 204 });
      }

      return new Response('', { status: 404 });
    }),
  );

  return calls;
}

function setGraph(
  rows: { number: number; category: string; subcategory?: string; priorityScore: number }[],
): void {
  session.run.mockResolvedValue({
    records: rows.map((row) => ({
      get: (key: string) => (row as Record<string, unknown>)[key] ?? null,
    })),
  });
}

describe('syncLabels', () => {
  const base = { owner: OWNER, repo: REPO };

  beforeEach(() => {
    vi.clearAllMocks();
    setGraph([{ number: 1, category: 'frontend', priorityScore: 85 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues no write request during a dry run', async () => {
    const repo: FakeRepo = { issues: new Map([[1, []]]), labels: new Map() };
    const calls = installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: true });

    expect(
      calls.every((c) => c.method === 'GET'),
      'a dry run is read-only',
    ).toBe(true);
    expect(result.labelsCreated).toEqual(['area/frontend', 'priority/P0']);
  });

  it('creates only the labels the repository does not already have', async () => {
    const repo: FakeRepo = {
      issues: new Map([[1, []]]),
      labels: new Map([['area/frontend', MANAGED]]),
    };
    const calls = installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.labelsCreated, 'area/frontend already exists').toEqual(['priority/P0']);
    const created = calls.filter(
      (c) => c.method === 'POST' && c.path === `/repos/${OWNER}/${REPO}/labels`,
    );
    expect(created).toHaveLength(1);
    expect(created[0].body?.name).toBe('priority/P0');
    expect(created[0].body?.description, 'cleanup identifies its own labels by this').toBe(MANAGED);
  });

  it('deletes a label it created once no issue carries it', async () => {
    const repo: FakeRepo = {
      issues: new Map([[1, ['area/backend', 'priority/P0']]]),
      labels: new Map([
        ['area/backend', MANAGED],
        ['priority/P0', MANAGED],
      ]),
    };
    installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.labelsDeleted).toEqual(['area/backend']);
    expect(repo.labels.has('area/backend'), 'the definition is gone, not just the link').toBe(
      false,
    );
  });

  it('keeps a label another issue still carries', async () => {
    const repo: FakeRepo = {
      issues: new Map([
        [1, ['area/backend', 'priority/P0']],
        [2, ['area/backend']],
      ]),
      labels: new Map([
        ['area/backend', MANAGED],
        ['priority/P0', MANAGED],
      ]),
    };
    installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.labelsDeleted, 'issue 2 is outside the plan but still uses it').toEqual([]);
    expect(repo.labels.has('area/backend')).toBe(true);
  });

  it('never deletes a label it did not create', async () => {
    const repo: FakeRepo = {
      issues: new Map([[1, []]]),
      labels: new Map([
        ['area/legacy', 'kept by hand'],
        ['bug', null],
      ]),
    };
    installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.labelsDeleted).toEqual([]);
    expect([...repo.labels.keys()].sort()).toEqual([
      'area/frontend',
      'area/legacy',
      'bug',
      'priority/P0',
    ]);
  });

  it('reports a pending deletion in a dry run without issuing it', async () => {
    const repo: FakeRepo = {
      issues: new Map([[1, ['area/backend', 'priority/P0']]]),
      labels: new Map([
        ['area/backend', MANAGED],
        ['priority/P0', MANAGED],
      ]),
    };
    const calls = installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: true });

    expect(result.labelsDeleted, 'the preview must name what the write would delete').toEqual([
      'area/backend',
    ]);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(repo.labels.has('area/backend')).toBe(true);
  });

  it('does not delete a label it created in the same run', async () => {
    const repo: FakeRepo = { issues: new Map([[1, []]]), labels: new Map() };
    installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.labelsCreated).toEqual(['area/frontend', 'priority/P0']);
    expect(result.labelsDeleted).toEqual([]);
    expect(repo.issues.get(1)).toEqual(['area/frontend', 'priority/P0']);
  });

  it('reports how many issues still differ after a chunk', async () => {
    setGraph([
      { number: 1, category: 'frontend', priorityScore: 85 },
      { number: 2, category: 'docs', priorityScore: 20 },
    ]);
    const repo: FakeRepo = {
      issues: new Map([
        [1, []],
        [2, []],
      ]),
      labels: new Map(),
    };
    installFetch(repo);

    const result = await syncLabels({ ...base, dryRun: false, limit: 1 });

    expect(result.applied).toBe(1);
    expect(result.remaining, 'issue 2 waits for the next run').toBe(1);
    expect(repo.issues.get(2), 'an out-of-chunk issue is untouched').toEqual([]);
  });

  it('skips cleanup when the issue list cannot be read back', async () => {
    const repo: FakeRepo = {
      issues: new Map([[1, ['area/backend', 'priority/P0']]]),
      labels: new Map([
        ['area/backend', MANAGED],
        ['priority/P0', MANAGED],
      ]),
    };
    installFetch(repo, 1);

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.applied, 'the per-issue writes still went through').toBe(1);
    expect(result.labelsDeleted).toEqual([]);
    expect(result.errors[0]).toContain('cleanup skipped');
    expect(
      repo.labels.has('area/backend'),
      'a partial read must never be treated as proof a label is unused',
    ).toBe(true);
  });

  it('reports an empty graph instead of planning a wipe', async () => {
    setGraph([]);
    const calls = installFetch({ issues: new Map(), labels: new Map() });

    const result = await syncLabels({ ...base, dryRun: false });

    expect(result.errors).toEqual(['no classified issues in the graph yet']);
    expect(calls, 'GitHub is never contacted without a classification').toHaveLength(0);
  });
});
