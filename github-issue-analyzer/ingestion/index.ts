/**
 * GitHub Issue Analyzer — Ingestion
 *
 * Single entry point for both startup (full sync) and schedule (incremental sync).
 * Set SYNC_MODE=startup for full sync, SYNC_MODE=schedule for incremental.
 *
 * Required environment variables:
 *   GITHUB_TOKEN    — GitHub API token
 *   GITHUB_OWNER    — Repo owner 
 *   GITHUB_REPO     — Repo name
 *   OPENAI_API_KEY  — OpenAI API key (required for analysis)
 *
 * Optional:
 *   SYNC_MODE       — "startup" (full sync, default) or "schedule" (incremental)
 *   NEO4J_HOST      — Neo4j host (injected by ast dev)
 *   NEO4J_URI       — Neo4j bolt URI
 *   NEO4J_AUTH      — Set to enable auth (default: disabled)
 *   ISSUE_STATE     — open | closed | all (default: all)
 *   ISSUE_LIMIT     — Max issues to process (0 = all, default: 0)
 *   SKIP_ANALYSIS   — Set to "true" to skip OpenAI analysis
 */

import { runPipeline, type PipelineConfig } from '../src/services/pipeline';
import { closeDriver } from '../src/services/neo4j';
import type { IssueState } from '../src/services/github';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

async function main() {
  const syncMode = process.env.SYNC_MODE || 'startup';
  const fullSync = syncMode === 'startup';

  console.log(`Starting ingestion (${fullSync ? 'full sync' : 'incremental'})...`);

  let owner: string;
  let repo: string;
  try {
    owner = requireEnv('GITHUB_OWNER');
    repo = requireEnv('GITHUB_REPO');
  } catch (err) {
    console.error((err as Error).message);
    console.error('Set these in astroai.yml under ingestion.*.container.build.args');
    process.exit(1);
  }

  const config: PipelineConfig = {
    owner,
    repo,
    state: (process.env.ISSUE_STATE as IssueState) || 'all',
    limit: parseInt(process.env.ISSUE_LIMIT || '0', 10),
    analyze: process.env.SKIP_ANALYSIS !== 'true',
    fullSync,
  };

  console.log(`  Owner: ${config.owner}`);
  console.log(`  Repo:  ${config.repo}`);
  console.log(`  Mode:  ${syncMode}`);
  console.log(`  Limit: ${config.limit || 'all'}`);
  console.log('');

  try {
    const result = await runPipeline(config);

    if (result.errors.length > 0) {
      console.error(`\nCompleted with ${result.errors.length} error(s):`);
      result.errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal pipeline error:', err);
    process.exit(1);
  } finally {
    await closeDriver();
  }
}

main();
