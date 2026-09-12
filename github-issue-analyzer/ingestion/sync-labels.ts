/**
 * GitHub Issue Analyzer — label sync
 *
 * Pushes the derived category, subcategory, and priority band back to GitHub
 * as namespaced labels. Deliberately a separate entry point, never a side
 * effect of ingestion.
 *
 * Required environment variables:
 *   GITHUB_TOKEN   — needs issues:write on the target repo
 *   GITHUB_OWNER   — Repo owner
 *   GITHUB_REPO    — Repo name
 *
 * Optional:
 *   APPLY          — "true" performs the writes. Anything else is a dry run.
 *   LABEL_LIMIT    — Apply at most this many issues (0 = all). Re-run to continue.
 *   LABEL_CATEGORY — Restrict to one taxonomy category, e.g. security.
 */

import { syncLabels } from '../src/services/github-labels';
import { closeDriver } from '../src/services/neo4j';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

async function main() {
  const dryRun = process.env.APPLY !== 'true';

  let owner: string;
  let repo: string;
  try {
    owner = requireEnv('GITHUB_OWNER');
    repo = requireEnv('GITHUB_REPO');
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const limit = Number.parseInt(process.env.LABEL_LIMIT || '0', 10);
  const category = process.env.LABEL_CATEGORY || undefined;
  const scope = [limit > 0 ? `limit ${limit}` : null, category ? `category ${category}` : null]
    .filter(Boolean)
    .join(', ');

  console.log(
    `Label sync for ${owner}/${repo} — ${dryRun ? 'DRY RUN' : 'APPLYING WRITES'}${scope ? ` (${scope})` : ''}\n`,
  );

  try {
    const result = await syncLabels({ owner, repo, dryRun, limit, category });

    if (result.labelsCreated.length > 0) {
      const heading = dryRun ? 'Labels to create' : 'Labels created';
      console.log(`${heading} (${result.labelsCreated.length}):`);
      for (const name of result.labelsCreated) console.log(`  + ${name}`);
      console.log('');
    }

    if (result.labelsDeleted.length > 0) {
      const heading = dryRun ? 'Unused labels to delete' : 'Unused labels deleted';
      console.log(`${heading} (${result.labelsDeleted.length}):`);
      for (const name of result.labelsDeleted) console.log(`  - ${name}`);
      console.log('');
    }

    console.log(`Issues needing changes: ${result.planned.length}`);
    for (const plan of result.planned.slice(0, 25)) {
      const add = plan.add.map((l) => `+${l}`).join(' ');
      const remove = plan.remove.map((l) => `-${l}`).join(' ');
      console.log(`  #${plan.issueNumber} ${[add, remove].filter(Boolean).join(' ')}`);
    }
    if (result.planned.length > 25) {
      console.log(`  ... and ${result.planned.length - 25} more`);
    }
    if (result.remaining > 0) {
      console.log(`\n${result.remaining} more issues still differ. Re-run to continue.`);
    }

    if (dryRun) {
      console.log('\nDry run — nothing was written. Set APPLY=true to perform these changes.');
    } else {
      console.log(`\nApplied to ${result.applied} issues.`);
    }

    if (result.errors.length > 0) {
      console.error(`\n${result.errors.length} error(s):`);
      for (const e of result.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal label sync error:', err);
    process.exit(1);
  } finally {
    await closeDriver();
  }
}

main();
