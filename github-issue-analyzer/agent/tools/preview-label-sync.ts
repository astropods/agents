import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { syncLabels } from '../../src/services/github-labels';
import { TAXONOMY } from '../../src/services/priority';

export const previewLabelSyncTool = createTool({
  id: 'previewLabelSync',
  description:
    'Show which GitHub labels would change if the derived category, ' +
    'subcategory, and priority were pushed back to the repository, including ' +
    'the labels that would be created and the unused ones that would be ' +
    'deleted. Read-only: this never writes to GitHub. Use it to inspect the diff.',
  inputSchema: z.object({
    limit: z.number().default(25).describe('Max per-issue changes to list back'),
    category: z
      .enum(TAXONOMY)
      .optional()
      .describe('Restrict the preview to one category, e.g. security'),
  }),
  outputSchema: z.object({
    issuesChanged: z.number(),
    labelsToCreate: z.array(z.string()),
    labelsToDelete: z.array(z.string()),
    changes: z.array(
      z.object({
        issueNumber: z.number(),
        add: z.array(z.string()),
        remove: z.array(z.string()),
      }),
    ),
    truncated: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!owner || !repo) {
      return {
        issuesChanged: 0,
        labelsToCreate: [],
        labelsToDelete: [],
        changes: [],
        truncated: false,
        error: 'GITHUB_OWNER and GITHUB_REPO are not set',
      };
    }

    try {
      console.log(`  [previewLabelSync] planning against ${owner}/${repo}`);
      // `limit` truncates the listing only, so the plan itself stays unchunked.
      const result = await syncLabels({
        owner,
        repo,
        dryRun: true,
        category: input.category,
      });

      if (result.errors.length > 0) {
        return {
          issuesChanged: 0,
          labelsToCreate: [],
          labelsToDelete: [],
          changes: [],
          truncated: false,
          error: result.errors.join('; '),
        };
      }

      console.log(`  [previewLabelSync] ${result.planned.length} issues would change`);

      return {
        issuesChanged: result.planned.length,
        labelsToCreate: result.labelsCreated,
        labelsToDelete: result.labelsDeleted,
        changes: result.planned.slice(0, input.limit),
        truncated: result.planned.length > input.limit,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [previewLabelSync] error: ${msg}`);
      return {
        issuesChanged: 0,
        labelsToCreate: [],
        labelsToDelete: [],
        changes: [],
        truncated: false,
        error: msg,
      };
    }
  },
});
