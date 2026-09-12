import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { syncLabels } from '../../src/services/github-labels';
import type { LabelPlan, SyncResult } from '../../src/services/github-labels';
import { TAXONOMY } from '../../src/services/priority';

const PREVIEW_LINES = 15;

function describe(
  planned: LabelPlan[],
  labelsToCreate: string[],
  labelsToDelete: string[],
): string {
  const lines = planned.slice(0, PREVIEW_LINES).map((p) => {
    const add = p.add.map((l) => `+${l}`).join(' ');
    const remove = p.remove.map((l) => `-${l}`).join(' ');
    return `#${p.issueNumber} ${[add, remove].filter(Boolean).join(' ')}`;
  });

  if (planned.length > PREVIEW_LINES) {
    lines.push(`...and ${planned.length - PREVIEW_LINES} more issues`);
  }

  return [
    lines.join('\n'),
    labelsToCreate.length > 0 ? `New labels to create: ${labelsToCreate.join(', ')}` : '',
    labelsToDelete.length > 0 ? `Unused labels to delete: ${labelsToDelete.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const applyLabelSyncTool = createTool({
  id: 'applyLabelSync',
  description:
    'Push the derived category, subcategory, and priority to GitHub as labels. ' +
    'Creates the labels it needs and deletes the ones it created that no issue ' +
    'carries any more. Always shows the full diff and waits for explicit user ' +
    'confirmation before writing anything. Only labels under area/, type/, and ' +
    'priority/ are touched.',
  inputSchema: z.object({
    limit: z
      .number()
      .optional()
      .describe('Apply at most this many issues. Omit for the whole plan.'),
    category: z.enum(TAXONOMY).optional().describe('Restrict to one category, e.g. security'),
    issueNumbers: z.array(z.number()).optional().describe('Restrict to specific issue numbers'),
  }),
  suspendSchema: z.object({
    message: z.string(),
    issuesChanged: z.number(),
    labelsToCreate: z.array(z.string()),
    labelsToDelete: z.array(z.string()),
  }),
  resumeSchema: z.object({
    confirm: z
      .boolean()
      .describe('Set true to write these label changes to GitHub. False cancels.'),
  }),
  outputSchema: z.object({
    applied: z.number(),
    issuesChanged: z.number(),
    labelsCreated: z.array(z.string()),
    labelsDeleted: z.array(z.string()),
    confirmed: z.boolean(),
    errors: z.array(z.string()),
    message: z.string(),
  }),
  execute: async (input, ctx) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!owner || !repo) {
      return {
        applied: 0,
        issuesChanged: 0,
        labelsCreated: [],
        labelsDeleted: [],
        confirmed: false,
        errors: ['GITHUB_OWNER and GITHUB_REPO are not set'],
        message: 'Cannot sync labels: the repository is not configured.',
      };
    }

    const resumeData = ctx?.agent?.resumeData as { confirm?: boolean } | undefined;

    if (resumeData?.confirm === true) {
      // Re-plan rather than trusting the pre-suspension diff, so a stale
      // confirmation cannot apply changes the graph no longer supports.
      console.log('  [applyLabelSync] confirmed, applying');
      const result = await syncLabels({ owner, repo, dryRun: false, ...input });
      return {
        applied: result.applied,
        issuesChanged: result.planned.length,
        labelsCreated: result.labelsCreated,
        labelsDeleted: result.labelsDeleted,
        confirmed: true,
        errors: result.errors,
        message: `Applied label changes to ${result.applied} issues in ${owner}/${repo}.`,
      };
    }

    if (resumeData) {
      console.log('  [applyLabelSync] declined, nothing written');
      return {
        applied: 0,
        issuesChanged: 0,
        labelsCreated: [],
        labelsDeleted: [],
        confirmed: false,
        errors: [],
        message: 'Cancelled. No labels were written to GitHub.',
      };
    }

    // The same dry run the write path takes, so the diff shown is the one applied.
    let preview: SyncResult;
    try {
      preview = await syncLabels({ owner, repo, dryRun: true, ...input });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [applyLabelSync] planning failed: ${msg}`);
      return {
        applied: 0,
        issuesChanged: 0,
        labelsCreated: [],
        labelsDeleted: [],
        confirmed: false,
        errors: [msg],
        message: 'Cannot plan the label sync, so nothing was written.',
      };
    }

    const { planned, labelsCreated, labelsDeleted, remaining, errors } = preview;

    if (planned.length === 0 && labelsDeleted.length === 0) {
      return {
        applied: 0,
        issuesChanged: 0,
        labelsCreated: [],
        labelsDeleted: [],
        confirmed: false,
        errors,
        message:
          errors.length > 0
            ? `Nothing to sync: ${errors.join('; ')}.`
            : `${owner}/${repo} labels already match the graph. Nothing to do.`,
      };
    }

    console.log(`  [applyLabelSync] suspending for confirmation, ${planned.length} issues`);

    const header =
      planned.length > 0
        ? `About to write labels to ${planned.length} issues in ${owner}/${repo}.`
        : `About to delete ${labelsDeleted.length} unused labels in ${owner}/${repo}.`;

    const chunkNote =
      remaining > 0
        ? `This is a chunk. ${remaining} more issues still differ; run the tool again after this to continue.`
        : '';

    await ctx.agent!.suspend({
      message: [
        header,
        describe(planned, labelsCreated, labelsDeleted),
        chunkNote,
        'Confirm to apply these changes to GitHub.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      issuesChanged: planned.length,
      labelsToCreate: labelsCreated,
      labelsToDelete: labelsDeleted,
    });

    return {
      applied: 0,
      issuesChanged: planned.length,
      labelsCreated: [],
      labelsDeleted: [],
      confirmed: false,
      errors: [],
      message: 'Waiting for confirmation before writing to GitHub.',
    };
  },
});
