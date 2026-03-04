/**
 * Jira REST API client.
 *
 * Env vars (injected by the custom jira provider declared in astropods.yml):
 *   JIRA_BASE_URL — e.g. https://yourcompany.atlassian.net
 *   JIRA_EMAIL    — Atlassian account email
 *   JIRA_API_KEY  — Atlassian API token
 */

const MAX_RETRIES = 4;
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);

function getConfig() {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_KEY;
  if (!baseUrl || !email || !token) {
    throw new Error('Missing Jira env vars: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_KEY');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), email, token };
}

function authHeader(): string {
  const { email, token } = getConfig();
  return `Basic ${btoa(`${email}:${token}`)}`;
}

async function jiraFetch<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  const { baseUrl } = getConfig();
  const url = new URL(`${baseUrl}/rest/api/3${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
      },
    });

    if (res.ok) return (await res.json()) as T;

    if (attempt < MAX_RETRIES && RETRY_STATUS_CODES.has(res.status)) {
      const backoff = Math.min(1000 * 2 ** attempt, 30_000);
      console.warn(`  Jira API ${res.status}, retrying in ${backoff / 1000}s (${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    const body = await res.text().catch(() => '');
    throw new Error(`Jira API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  throw new Error('Jira API: max retries exceeded');
}

// ── Types ──────────────────────────────────────────────────────────────

export interface JiraIssueSummary {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  status: string;
  assignee: string | null;
  labels: string[];
  resolutionDate: string | null;
}

export interface JiraIssueDetail extends JiraIssueSummary {
  description: string | null;
  resolution: string | null;
  created: string;
  updated: string;
  components: string[];
  fixVersions: string[];
  linkedIssues: { type: string; key: string; summary: string }[];
}

// ── Public API ─────────────────────────────────────────────────────────

const SEARCH_FIELDS = [
  'summary', 'issuetype', 'priority', 'status', 'assignee',
  'labels', 'resolutiondate', 'resolution',
].join(',');

interface JiraSearchResponse {
  issues: {
    key: string;
    fields: Record<string, unknown>;
  }[];
  total?: number;
}

export async function searchIssues(jql: string): Promise<JiraIssueSummary[]> {
  const allIssues: JiraIssueSummary[] = [];
  let startAt = 0;
  const maxResults = 100;

  console.log(`  [jira] JQL: ${jql}`);

  while (true) {
    const data = await jiraFetch<JiraSearchResponse>('/search/jql', {
      jql,
      fields: SEARCH_FIELDS,
      startAt: String(startAt),
      maxResults: String(maxResults),
    });

    const page = data.issues ?? [];

    for (const issue of page) {
      const f = issue.fields;
      allIssues.push({
        key: issue.key,
        summary: (f.summary as string) ?? '',
        issueType: (f.issuetype as { name: string })?.name ?? 'Unknown',
        priority: (f.priority as { name: string })?.name ?? 'None',
        status: (f.status as { name: string })?.name ?? 'Unknown',
        assignee: (f.assignee as { displayName: string })?.displayName ?? null,
        labels: (f.labels as string[]) ?? [],
        resolutionDate: (f.resolutiondate as string) ?? null,
      });
    }

    console.log(`  [jira] fetched ${allIssues.length} issues so far`);

    if (page.length < maxResults) break;
    startAt += page.length;
  }

  return allIssues;
}

const DETAIL_FIELDS = [
  'summary', 'issuetype', 'priority', 'status', 'assignee',
  'labels', 'resolutiondate', 'resolution', 'description',
  'created', 'updated', 'components', 'fixVersions', 'issuelinks',
].join(',');

interface JiraIssueResponse {
  key: string;
  fields: Record<string, unknown>;
}

export async function getIssue(issueKey: string): Promise<JiraIssueDetail> {
  console.log(`  [jira] fetching ${issueKey}`);
  const data = await jiraFetch<JiraIssueResponse>(`/issue/${issueKey}`, {
    fields: DETAIL_FIELDS,
  });

  const f = data.fields;

  const linkedIssues = ((f.issuelinks as { type: { name: string }; outwardIssue?: { key: string; fields: { summary: string } }; inwardIssue?: { key: string; fields: { summary: string } } }[]) ?? []).map((link) => {
    const target = link.outwardIssue ?? link.inwardIssue;
    return {
      type: link.type.name,
      key: target?.key ?? '',
      summary: target?.fields?.summary ?? '',
    };
  });

  const descField = f.description;
  let description: string | null = null;
  if (descField && typeof descField === 'object' && 'content' in (descField as Record<string, unknown>)) {
    description = extractTextFromAdf(descField as AdfNode);
  } else if (typeof descField === 'string') {
    description = descField;
  }

  return {
    key: data.key,
    summary: (f.summary as string) ?? '',
    issueType: (f.issuetype as { name: string })?.name ?? 'Unknown',
    priority: (f.priority as { name: string })?.name ?? 'None',
    status: (f.status as { name: string })?.name ?? 'Unknown',
    assignee: (f.assignee as { displayName: string })?.displayName ?? null,
    labels: (f.labels as string[]) ?? [],
    resolutionDate: (f.resolutiondate as string) ?? null,
    resolution: (f.resolution as { name: string })?.name ?? null,
    created: (f.created as string) ?? '',
    updated: (f.updated as string) ?? '',
    description,
    components: ((f.components as { name: string }[]) ?? []).map((c) => c.name),
    fixVersions: ((f.fixVersions as { name: string }[]) ?? []).map((v) => v.name),
    linkedIssues,
  };
}

// ── ADF text extraction ────────────────────────────────────────────────

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

function extractTextFromAdf(node: AdfNode): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractTextFromAdf).join('');
}
