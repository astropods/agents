/**
 * Writes the derived classification back to GitHub as namespaced labels.
 *
 * Only labels under the prefixes below are ever added or removed, so
 * human-managed labels are never touched. The repository's label list is
 * reconciled too: a missing label is created, and a label this agent created
 * is deleted once no issue carries it.
 */

import neo4j from 'neo4j-driver';
import { WRITE_INTERVAL_MS, fetchWithRetry, sleep } from './http';
import { getDriver } from './neo4j';

const AREA_PREFIX = 'area/';
const TYPE_PREFIX = 'type/';
const PRIORITY_PREFIX = 'priority/';
const MANAGED_PREFIXES = [AREA_PREFIX, TYPE_PREFIX, PRIORITY_PREFIX];

const COLORS: Record<string, string> = {
  [AREA_PREFIX]: '0e8a16',
  [TYPE_PREFIX]: '1d76db',
  [PRIORITY_PREFIX]: 'b60205',
};

/** Marks a label as this agent's, so cleanup never deletes a human's label. */
const MANAGED_DESCRIPTION = 'Derived by github-issue-analyzer';

export interface LabelPlan {
  issueNumber: number;
  add: string[];
  remove: string[];
}

export interface RepoLabel {
  name: string;
  description: string | null;
}

export interface SyncResult {
  planned: LabelPlan[];
  labelsCreated: string[];
  labelsDeleted: string[];
  applied: number;
  /** Issues that still differ after this chunk. */
  remaining: number;
  dryRun: boolean;
  errors: string[];
}

export function priorityBand(score: number): string {
  if (score >= 80) return 'P0';
  if (score >= 60) return 'P1';
  if (score >= 40) return 'P2';
  return 'P3';
}

export function isManaged(name: string): boolean {
  return MANAGED_PREFIXES.some((p) => name.startsWith(p));
}

function colorFor(name: string): string {
  const prefix = MANAGED_PREFIXES.find((p) => name.startsWith(p));
  return (prefix && COLORS[prefix]) || 'ededed';
}

async function api<T>(
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetchWithRetry(
    () =>
      fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      }),
    `${init.method ?? 'GET'} ${path}`,
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/** Reads the classification this project derived, straight from the graph. */
export async function loadDesiredLabels(): Promise<{ number: number; labels: string[] }[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      `MATCH (i:Issue)
       WHERE i.category IS NOT NULL AND i.priorityScore IS NOT NULL
       RETURN i.number AS number, i.category AS category,
              i.subcategory AS subcategory, i.priorityScore AS priorityScore
       ORDER BY i.number`,
    );
    return result.records.map((r) => {
      const labels = [
        `${AREA_PREFIX}${r.get('category')}`,
        `${PRIORITY_PREFIX}${priorityBand(neo4j.int(r.get('priorityScore')).toNumber())}`,
      ];
      const sub = r.get('subcategory') as string | null;
      if (sub) labels.push(`${TYPE_PREFIX}${sub}`);
      return { number: neo4j.int(r.get('number')).toNumber(), labels };
    });
  } finally {
    await session.close();
  }
}

/** Computes the add/remove plan without contacting GitHub for writes. */
export function planLabelChanges(
  desired: { number: number; labels: string[] }[],
  current: Map<number, string[]>,
): LabelPlan[] {
  const planned: LabelPlan[] = [];
  for (const { number, labels } of desired) {
    const existing = current.get(number) ?? [];
    const add = labels.filter((l) => !existing.includes(l));
    const remove = existing.filter((l) => isManaged(l) && !labels.includes(l));
    if (add.length > 0 || remove.length > 0) planned.push({ issueNumber: number, add, remove });
  }
  return planned;
}

/** Labels attached to at least one issue or pull request. */
export function labelsInUse(current: Map<number, string[]>): Set<string> {
  return new Set([...current.values()].flat());
}

/** Projects label usage forward over a plan, so a dry run can report deletions. */
export function labelsInUseAfter(
  current: Map<number, string[]>,
  planned: LabelPlan[],
): Set<string> {
  const projected = new Map(current);
  for (const plan of planned) {
    const kept = (projected.get(plan.issueNumber) ?? []).filter((l) => !plan.remove.includes(l));
    projected.set(plan.issueNumber, [...kept, ...plan.add]);
  }
  return labelsInUse(projected);
}

/**
 * Managed labels this agent created that no issue carries any more. GitHub
 * reports no usage count on a label, so the caller supplies the in-use set.
 */
export function selectOrphans(repoLabels: RepoLabel[], inUse: Set<string>): string[] {
  return repoLabels
    .filter((l) => isManaged(l.name) && l.description === MANAGED_DESCRIPTION && !inUse.has(l.name))
    .map((l) => l.name)
    .sort();
}

export async function fetchRepoLabels(owner: string, repo: string): Promise<RepoLabel[]> {
  const labels: RepoLabel[] = [];
  let page = 1;
  for (;;) {
    const { ok, status, body } = await api<RepoLabel[]>(
      `/repos/${owner}/${repo}/labels?per_page=100&page=${page}`,
    );
    if (!ok) throw new Error(`list labels failed: HTTP ${status}`);
    if (!Array.isArray(body) || body.length === 0) break;
    for (const label of body) {
      labels.push({ name: label.name, description: label.description ?? null });
    }
    if (body.length < 100) break;
    page++;
  }
  return labels;
}

export async function fetchCurrentLabels(
  owner: string,
  repo: string,
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  let page = 1;
  for (;;) {
    const { ok, status, body } = await api<{ number: number; labels: { name: string }[] }[]>(
      `/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`,
    );
    if (!ok) throw new Error(`list issues failed: HTTP ${status}`);
    if (!Array.isArray(body) || body.length === 0) break;
    for (const issue of body) {
      map.set(
        issue.number,
        issue.labels.map((l) => l.name),
      );
    }
    if (body.length < 100) break;
    page++;
  }
  return map;
}

export interface SyncOptions {
  owner: string;
  repo: string;
  dryRun: boolean;
  /** Apply at most this many issues. Omit or 0 for the whole plan. */
  limit?: number;
  /** Restrict to one taxonomy category. */
  category?: string;
  /** Restrict to specific issue numbers. */
  issueNumbers?: number[];
}

/**
 * Narrows a plan to the requested slice. Chunking needs no cursor: the plan is
 * recomputed from the live labels each run, so applied issues drop out of it.
 */
export function selectChunk(planned: LabelPlan[], limit?: number): LabelPlan[] {
  return limit && limit > 0 ? planned.slice(0, limit) : planned;
}

/** Deletes the managed labels that nothing carries once the writes are done. */
async function deleteOrphans(
  owner: string,
  repo: string,
  repoLabels: RepoLabel[],
  errors: string[],
): Promise<string[]> {
  let orphans: string[];
  try {
    orphans = selectOrphans(repoLabels, labelsInUse(await fetchCurrentLabels(owner, repo)));
  } catch (err) {
    errors.push(`cleanup skipped: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const deleted: string[] = [];

  for (const [i, name] of orphans.entries()) {
    const { ok, status } = await api(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (ok) deleted.push(name);
    else if (status !== 404) errors.push(`delete label ${name}: HTTP ${status}`);
    if (i < orphans.length - 1) await sleep(WRITE_INTERVAL_MS);
  }

  return deleted;
}

export async function syncLabels(opts: SyncOptions): Promise<SyncResult> {
  const { owner, repo, dryRun, limit, category, issueNumbers } = opts;
  const errors: string[] = [];

  const all = await loadDesiredLabels();
  if (all.length === 0) {
    return {
      planned: [],
      labelsCreated: [],
      labelsDeleted: [],
      applied: 0,
      remaining: 0,
      dryRun,
      errors: ['no classified issues in the graph yet'],
    };
  }

  const wanted = new Set(issueNumbers ?? []);
  const desired = all.filter(
    (d) =>
      (wanted.size === 0 || wanted.has(d.number)) &&
      (!category || d.labels.includes(`${AREA_PREFIX}${category}`)),
  );

  const current = await fetchCurrentLabels(owner, repo);
  const matching = planLabelChanges(desired, current);
  const planned = selectChunk(matching, limit);
  const remaining = matching.length - planned.length;

  const needed = [...new Set(planned.flatMap((p) => p.add))].sort();
  const repoLabels = await fetchRepoLabels(owner, repo);
  const have = new Set(repoLabels.map((l) => l.name));
  const labelsCreated = needed.filter((n) => !have.has(n));

  if (dryRun) {
    return {
      planned,
      labelsCreated,
      labelsDeleted: selectOrphans(repoLabels, labelsInUseAfter(current, planned)),
      applied: 0,
      remaining,
      dryRun: true,
      errors,
    };
  }

  for (const name of labelsCreated) {
    const { ok, status } = await api(`/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        color: colorFor(name),
        description: MANAGED_DESCRIPTION,
      }),
    });
    if (!ok && status !== 422) errors.push(`create label ${name}: HTTP ${status}`);
  }

  let applied = 0;
  for (const plan of planned) {
    try {
      if (plan.add.length > 0) {
        const { ok, status } = await api(
          `/repos/${owner}/${repo}/issues/${plan.issueNumber}/labels`,
          { method: 'POST', body: JSON.stringify({ labels: plan.add }) },
        );
        if (!ok) throw new Error(`add HTTP ${status}`);
      }
      for (const name of plan.remove) {
        const { ok, status } = await api(
          `/repos/${owner}/${repo}/issues/${plan.issueNumber}/labels/${encodeURIComponent(name)}`,
          { method: 'DELETE' },
        );
        if (!ok && status !== 404) throw new Error(`remove ${name} HTTP ${status}`);
      }
      applied++;
    } catch (err) {
      errors.push(`#${plan.issueNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (applied < planned.length) await sleep(WRITE_INTERVAL_MS);
  }

  const labelsDeleted = await deleteOrphans(
    owner,
    repo,
    [...repoLabels, ...labelsCreated.map((name) => ({ name, description: MANAGED_DESCRIPTION }))],
    errors,
  );

  return { planned, labelsCreated, labelsDeleted, applied, remaining, dryRun: false, errors };
}
