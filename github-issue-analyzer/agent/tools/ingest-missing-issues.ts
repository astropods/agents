import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ingestMissingIssues } from '../../src/services/issue-gap';

export const ingestMissingIssuesTool = createTool({
  id: 'ingestMissingIssues',
  description:
    'Find issues that are open on GitHub but absent from the graph, and ' +
    'optionally fetch and classify them. Use this when a count looks short, or ' +
    'when the user asks whether the graph is complete. reconcileIssueState ' +
    'cannot answer this: it only checks issues the graph already holds.',
  inputSchema: z.object({
    ingest: z
      .boolean()
      .default(false)
      .describe('Fetch and classify the missing issues. False only reports the gap.'),
    limit: z
      .number()
      .default(25)
      .describe('Max issues to fetch in one call. Each carries a model call when classified.'),
    analyze: z
      .boolean()
      .default(true)
      .describe('Classify what is fetched. False ingests raw issues with no model calls.'),
  }),
  outputSchema: z.object({
    githubOpen: z.number(),
    graphTotal: z.number(),
    missingCount: z.number(),
    missing: z.array(z.number()),
    ingested: z.array(z.number()),
    analyzed: z.number(),
    errors: z.array(z.string()),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const empty = {
      githubOpen: 0,
      graphTotal: 0,
      missingCount: 0,
      missing: [],
      ingested: [],
      analyzed: 0,
      errors: [],
    };

    if (!owner || !repo) {
      return {
        ...empty,
        message: 'Cannot check for missing issues: the repository is not configured.',
        error: 'GITHUB_OWNER and GITHUB_REPO are not set',
      };
    }

    try {
      console.log(`  [ingestMissingIssues] ${owner}/${repo} ingest=${input.ingest}`);
      const r = await ingestMissingIssues({
        owner,
        repo,
        dryRun: !input.ingest,
        limit: input.limit,
        analyze: input.analyze,
      });

      const capped = r.missing.length > input.limit;
      const message =
        r.missing.length === 0
          ? `The graph holds every open issue. GitHub has ${r.githubOpen} open; the graph holds ${r.graphTotal} issues in total.`
          : input.ingest
            ? `Ingested ${r.ingested.length} of ${r.missing.length} missing issues${r.analyzed ? `, classified ${r.analyzed}` : ''}.${capped ? ` ${r.missing.length - r.ingested.length} still missing; run again to continue.` : ''}`
            : `${r.missing.length} open issues are missing from the graph. Re-run with ingest to add them${capped ? `, ${input.limit} at a time` : ''}.`;

      console.log(
        `  [ingestMissingIssues] missing=${r.missing.length} ingested=${r.ingested.length}`,
      );

      return {
        githubOpen: r.githubOpen,
        graphTotal: r.graphTotal,
        missingCount: r.missing.length,
        missing: r.missing,
        ingested: r.ingested,
        analyzed: r.analyzed,
        errors: r.errors,
        message,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ingestMissingIssues] error: ${msg}`);
      return { ...empty, message: 'Missing-issue check failed.', error: msg };
    }
  },
});
