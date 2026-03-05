/**
 * GitHub REST API client for PR lookups.
 *
 * Env vars (auto-injected by Astro):
 *   GITHUB_TOKEN — GitHub personal access token
 */

const MAX_RETRIES = 4;
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
const GITHUB_API = 'https://api.github.com';

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is required');
  return token;
}

async function ghFetch<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GITHUB_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${requireToken()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (res.ok) return (await res.json()) as T;

    if (attempt < MAX_RETRIES && RETRY_STATUS_CODES.has(res.status)) {
      const backoff = Math.min(1000 * 2 ** attempt, 30_000);
      console.warn(`  GitHub API ${res.status}, retrying in ${backoff / 1000}s (${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  throw new Error('GitHub API: max retries exceeded');
}

// ── Types ──────────────────────────────────────────────────────────────

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  merged: boolean;
  targetBranch: string;
  mergeCommitSha: string | null;
}

export interface PRWithVersion extends PRInfo {
  version: string | null;
}

// ── Public API ─────────────────────────────────────────────────────────

interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  pull_request?: { merged_at: string | null };
}

interface SearchResponse {
  total_count: number;
  items: SearchItem[];
}

export async function searchPRsByKey(
  issueKey: string,
  owner: string,
  repo: string,
): Promise<PRInfo[]> {
  console.log(`  [github] searching PRs for ${issueKey} in ${owner}/${repo}`);
  const q = `${issueKey} type:pr repo:${owner}/${repo}`;
  const data = await ghFetch<SearchResponse>('/search/issues', {
    q,
    per_page: '20',
  });

  const prs: PRInfo[] = [];
  for (const item of data.items) {
    const detail = await getPRDetail(owner, repo, item.number);
    prs.push(detail);
  }

  console.log(`  [github] found ${prs.length} PRs for ${issueKey}`);
  return prs;
}

interface PRResponse {
  number: number;
  title: string;
  html_url: string;
  merged: boolean;
  merge_commit_sha: string | null;
  base: { ref: string };
}

async function getPRDetail(owner: string, repo: string, prNumber: number): Promise<PRInfo> {
  const pr = await ghFetch<PRResponse>(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    merged: pr.merged,
    targetBranch: pr.base.ref,
    mergeCommitSha: pr.merged ? pr.merge_commit_sha : null,
  };
}

interface TagItem {
  name: string;
  commit: { sha: string };
}

export async function findVersionForCommit(
  owner: string,
  repo: string,
  sha: string,
): Promise<string | null> {
  if (!sha) return null;
  console.log(`  [github] looking up tags containing ${sha.slice(0, 8)} in ${owner}/${repo}`);

  try {
    const tags = await ghFetch<TagItem[]>(`/repos/${owner}/${repo}/tags`, {
      per_page: '30',
    });

    // Check which tags contain this commit by comparing merge base
    for (const tag of tags) {
      try {
        const compare = await ghFetch<{ status: string }>(
          `/repos/${owner}/${repo}/compare/${sha}...${tag.commit.sha}`,
        );
        if (compare.status === 'identical' || compare.status === 'ahead') {
          return tag.name;
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    console.warn(`  [github] tag lookup failed: ${err instanceof Error ? err.message : err}`);
  }

  return null;
}

export async function checkPRsForIssues(
  issueKeys: string[],
  owner: string,
  repo: string,
): Promise<{ issueKey: string; prs: PRWithVersion[] }[]> {
  const results: { issueKey: string; prs: PRWithVersion[] }[] = [];

  for (const key of issueKeys) {
    const prs = await searchPRsByKey(key, owner, repo);
    const prsWithVersion: PRWithVersion[] = [];

    for (const pr of prs) {
      let version: string | null = null;
      if (pr.mergeCommitSha) {
        version = await findVersionForCommit(owner, repo, pr.mergeCommitSha);
      }
      prsWithVersion.push({ ...pr, version });
    }

    results.push({ issueKey: key, prs: prsWithVersion });
  }

  return results;
}
