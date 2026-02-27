/**
 * Pipeline orchestrator — ties together GitHub fetch, Neo4j ingest,
 * OpenAI analysis, and analysis ingestion into a single end-to-end flow.
 *
 * Supports incremental sync: when a previous run's timestamp is found in
 * Neo4j (Meta node), only issues updated since then are fetched and
 * re-analyzed. The first run always does a full sync.
 */

import { getAllIssueNumbers, getIssuesData, type IssueState } from './github';
import { ingestMultipleIssues, getLastSyncTimestamp, setLastSyncTimestamp, getIssueUpdatedAt } from './neo4j';
import { fetchMultipleIssueDetails } from './database';
import { analyzeIssueWithOpenAI, transformIssueDataForAnalysis } from './openai';
import { ingestAnalysisResults, type AnalysisData } from './analysis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  /** GitHub repo owner (e.g. "octocat") */
  owner: string;
  /** GitHub repo name (e.g. "hello-world") */
  repo: string;
  /** Which issue states to ingest */
  state: IssueState;
  /** Max issues to process (0 = all). Useful for testing. */
  limit: number;
  /** Whether to run OpenAI analysis after ingestion */
  analyze: boolean;
  /** Force full sync even if a lastSync timestamp exists */
  fullSync?: boolean;
}

export interface PipelineResult {
  issuesFetched: number;
  issuesIngested: number;
  issuesAnalyzed: number;
  issuesSkipped: number;
  errors: string[];
  durationMs: number;
  incremental: boolean;
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const start = Date.now();
  const runTimestamp = new Date().toISOString();
  const errors: string[] = [];

  // Read lastSync to determine if this is incremental
  let since: string | null = null;
  if (!config.fullSync) {
    try {
      since = await getLastSyncTimestamp();
    } catch {
      // Neo4j may not be ready yet on first run — fall through to full sync
    }
  }
  const incremental = !!since;

  console.log('\n========================================');
  console.log(' GitHub Issue Analyzer — Ingestion Pipeline');
  console.log('========================================');
  console.log(`  Repo:    ${config.owner}/${config.repo}`);
  console.log(`  State:   ${config.state}`);
  console.log(`  Limit:   ${config.limit || 'all'}`);
  console.log(`  Analyze: ${config.analyze}`);
  console.log(`  Mode:    ${incremental ? `incremental (since ${since})` : 'full sync'}`);
  console.log('========================================\n');

  // 1. Discover issue numbers
  console.log('Step 1/5: Discovering issues...');
  const listing = await getAllIssueNumbers(config.owner, config.repo, config.state, config.limit, since);
  const numbers = listing.issueNumbers;
  console.log(`  Will process ${numbers.length} issues\n`);

  if (numbers.length === 0) {
    if (incremental) {
      console.log('  No issues updated since last sync — nothing to do.\n');
      await setLastSyncTimestamp(runTimestamp);
    }
    return { issuesFetched: 0, issuesIngested: 0, issuesAnalyzed: 0, issuesSkipped: 0, errors: [], durationMs: Date.now() - start, incremental };
  }

  // 2. Fetch full issue data from GitHub
  console.log('Step 2/5: Fetching issue data from GitHub...');
  const fetched = await getIssuesData(config.owner, config.repo, numbers);
  fetched.errors.forEach((e) => errors.push(`fetch #${e.issueNumber}: ${e.error}`));
  console.log(`  Fetched ${fetched.results.length} issues\n`);

  // 3. Ingest into Neo4j
  console.log('Step 3/5: Ingesting into Neo4j...');
  const ingested = await ingestMultipleIssues(fetched.results);
  ingested.errors.forEach((e) => errors.push(`ingest #${e.issueNumber}: ${e.error}`));
  console.log(`  Ingested ${ingested.results.length} issues\n`);

  let analysisCount = 0;
  let skippedCount = 0;

  if (config.analyze) {
    // 4. Run OpenAI analysis — skip issues whose updatedAt hasn't changed
    console.log('Step 4/5: Running OpenAI analysis...');
    const ingestedNumbers = ingested.results.map((r) => {
      const match = fetched.results.find((f) => f.issue.id === r.issueId);
      return match?.issue.number;
    }).filter((n): n is number => n !== undefined);

    // Build a map of issue number -> new updatedAt from the fetched data
    const updatedAtMap = new Map<number, string>();
    for (const { issue } of fetched.results) {
      updatedAtMap.set(issue.number, issue.updatedAt);
    }

    const dbData = await fetchMultipleIssueDetails(ingestedNumbers);
    const analysisResults: AnalysisData[] = [];

    for (const detail of dbData.results) {
      try {
        // In incremental mode, skip analysis if the issue's updatedAt hasn't changed
        if (incremental) {
          const previousUpdatedAt = await getIssueUpdatedAt(detail.issue.number);
          const currentUpdatedAt = updatedAtMap.get(detail.issue.number);
          if (previousUpdatedAt && currentUpdatedAt && previousUpdatedAt === currentUpdatedAt) {
            console.log(`  Skipping issue #${detail.issue.number} (unchanged)`);
            skippedCount++;
            continue;
          }
        }

        const transformed = transformIssueDataForAnalysis(detail);
        console.log(`  Analyzing issue #${detail.issue.number}: ${detail.issue.title}`);
        const result = await analyzeIssueWithOpenAI(transformed);
        analysisResults.push({
          issueNumber: detail.issue.number,
          title: detail.issue.title,
          analysis: result.analysis,
        });
        analysisCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Analysis failed for #${detail.issue.number}: ${msg}`);
        errors.push(`analysis #${detail.issue.number}: ${msg}`);
      }
    }

    // 5. Ingest analysis results
    if (analysisResults.length > 0) {
      console.log('\nStep 5/5: Ingesting analysis results...');
      const analysisIngested = await ingestAnalysisResults(analysisResults);
      analysisIngested.errors.forEach((e) => errors.push(`analysis-ingest #${e.issueNumber}: ${e.error}`));
    }
  } else {
    console.log('Step 4/5: Skipped (analysis disabled)');
    console.log('Step 5/5: Skipped (analysis disabled)');
  }

  // Record this run's timestamp for the next incremental sync
  await setLastSyncTimestamp(runTimestamp);

  const durationMs = Date.now() - start;

  console.log('\n========================================');
  console.log(' Pipeline Complete');
  console.log('========================================');
  console.log(`  Mode:            ${incremental ? 'incremental' : 'full sync'}`);
  console.log(`  Issues fetched:  ${fetched.results.length}`);
  console.log(`  Issues ingested: ${ingested.results.length}`);
  console.log(`  Issues analyzed: ${analysisCount}`);
  if (skippedCount > 0) {
    console.log(`  Issues skipped:  ${skippedCount} (unchanged)`);
  }
  console.log(`  Errors:          ${errors.length}`);
  console.log(`  Duration:        ${(durationMs / 1000).toFixed(1)}s`);
  console.log('========================================\n');

  return {
    issuesFetched: fetched.results.length,
    issuesIngested: ingested.results.length,
    issuesAnalyzed: analysisCount,
    issuesSkipped: skippedCount,
    errors,
    durationMs,
    incremental,
  };
}

