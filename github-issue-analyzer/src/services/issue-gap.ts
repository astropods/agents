/**
 * Finds issues that exist on GitHub but were never ingested, and backfills them.
 *
 * `reconcileIssueState` keeps the state of known issues correct; it cannot see
 * an issue the graph has never held. That gap is invisible in every count and
 * every state filter, so it needs its own check.
 *
 * Scoped deliberately: this fetches only the missing issues, not a full sync,
 * so it stays fast enough to run from a tool call.
 */

import { type AnalysisData, ingestAnalysisResults } from './analysis';
import { fetchMultipleIssueDetails } from './database';
import { getIssuesData } from './github';
import { fetchWithRetry } from './http';
import { analyzeIssue, transformIssueDataForAnalysis } from './issue-analysis';
import { getDriver, ingestMultipleIssues } from './neo4j';
import { ensureVocabulary } from './subcategory';

import neo4j from 'neo4j-driver';

export interface GapResult {
  githubOpen: number;
  graphTotal: number;
  missing: number[];
  ingested: number[];
  analyzed: number;
  errors: string[];
  dryRun: boolean;
}

/** Every open issue number on GitHub. Excludes pull requests: they are a separate connection. */
export async function fetchOpenIssueNumbers(owner: string, repo: string): Promise<number[]> {
  const numbers: number[] = [];
  let cursor: string | null = null;

  for (;;) {
    const res = await fetchWithRetry(
      () =>
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `query($owner:String!,$repo:String!,$cursor:String){
              repository(owner:$owner,name:$repo){
                issues(states:OPEN, first:100, after:$cursor){
                  pageInfo{ hasNextPage endCursor }
                  nodes{ number }
                }
              }
            }`,
            variables: { owner, repo, cursor },
          }),
        }),
      'GitHub open issues',
    );
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);

    const json = (await res.json()) as {
      data?: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            nodes: { number: number }[];
          };
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);

    const page = json.data!.repository.issues;
    for (const n of page.nodes) numbers.push(n.number);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  return numbers;
}

/** Pure set difference, so the gap calculation is testable without a graph or a network. */
export function findMissing(githubOpen: number[], graphNumbers: number[]): number[] {
  const held = new Set(graphNumbers);
  return githubOpen.filter((n) => !held.has(n)).sort((a, b) => a - b);
}

export async function ingestMissingIssues(opts: {
  owner: string;
  repo: string;
  dryRun: boolean;
  /** Cap how many are fetched in one call; each carries a model call when analysed. */
  limit?: number;
  analyze?: boolean;
}): Promise<GapResult> {
  const { owner, repo, dryRun, limit = 0, analyze = true } = opts;
  const errors: string[] = [];

  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  let graphNumbers: number[];
  try {
    const held = await session.run(`MATCH (i:Issue) RETURN i.number AS n`);
    graphNumbers = held.records.map((r) => neo4j.int(r.get('n')).toNumber());
  } finally {
    await session.close();
  }

  const githubOpen = await fetchOpenIssueNumbers(owner, repo);
  const allMissing = findMissing(githubOpen, graphNumbers);
  const missing = limit > 0 ? allMissing.slice(0, limit) : allMissing;

  const base: GapResult = {
    githubOpen: githubOpen.length,
    graphTotal: graphNumbers.length,
    missing: allMissing,
    ingested: [],
    analyzed: 0,
    errors,
    dryRun,
  };

  if (dryRun || missing.length === 0) return base;

  const fetched = await getIssuesData(owner, repo, missing);
  for (const e of fetched.errors) errors.push(`fetch #${e.issueNumber}: ${e.error}`);

  const ingested = await ingestMultipleIssues(fetched.results);
  for (const e of ingested.errors) errors.push(`ingest #${e.issueNumber}: ${e.error}`);

  const ingestedNumbers = fetched.results.map((f) => f.issue.number);
  base.ingested = ingestedNumbers;

  if (!analyze || ingestedNumbers.length === 0) return base;

  // Reuse the persisted vocabulary; a backfill must not redefine the taxonomy
  // that the rest of the graph is already classified against.
  const vocabulary = await ensureVocabulary(false, new Date().toISOString());
  const details = await fetchMultipleIssueDetails(ingestedNumbers);
  const analyses: AnalysisData[] = [];

  for (const detail of details.results) {
    try {
      const result = await analyzeIssue(transformIssueDataForAnalysis(detail), vocabulary);
      analyses.push({
        issueNumber: detail.issue.number,
        title: detail.issue.title,
        analysis: result.analysis,
      });
    } catch (err) {
      errors.push(
        `analysis #${detail.issue.number}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (analyses.length > 0) {
    const written = await ingestAnalysisResults(analyses);
    for (const e of written.errors) errors.push(`analysis-ingest #${e.issueNumber}: ${e.error}`);
  }
  base.analyzed = analyses.length;

  return base;
}
