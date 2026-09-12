import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { reconcileIssueState } from '../../src/services/issue-state';

export const reconcileIssueStateTool = createTool({
  id: 'reconcileIssueState',
  description:
    'Check every issue in the graph against GitHub and report which ones have a ' +
    'stale open/closed state, optionally correcting them. Writes only to the ' +
    'graph, never to GitHub. Use this when counts look wrong, when an issue the ' +
    'graph calls open turns out to be closed, or before trusting a state filter.',
  inputSchema: z.object({
    apply: z
      .boolean()
      .default(false)
      .describe('Write the corrections. False reports the drift without changing anything.'),
  }),
  outputSchema: z.object({
    checked: z.number(),
    resolved: z.number(),
    driftCount: z.number(),
    applied: z.number(),
    drift: z.array(
      z.object({
        number: z.number(),
        storedState: z.string(),
        liveState: z.string(),
        closedAt: z.string().nullable(),
      }),
    ),
    unresolved: z.array(z.number()),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const empty = { checked: 0, resolved: 0, driftCount: 0, applied: 0, drift: [], unresolved: [] };

    if (!owner || !repo) {
      return {
        ...empty,
        message: 'Cannot reconcile: the repository is not configured.',
        error: 'GITHUB_OWNER and GITHUB_REPO are not set',
      };
    }

    try {
      console.log(`  [reconcileIssueState] ${owner}/${repo} apply=${input.apply}`);
      const r = await reconcileIssueState({ owner, repo, dryRun: !input.apply });

      const message =
        r.drift.length === 0
          ? `All ${r.checked} issues match GitHub. Nothing to correct.`
          : input.apply
            ? `Corrected ${r.applied} of ${r.checked} issues.`
            : `${r.drift.length} of ${r.checked} issues have a stale state. Re-run with apply to correct them.`;

      console.log(`  [reconcileIssueState] drift=${r.drift.length} applied=${r.applied}`);

      return {
        checked: r.checked,
        resolved: r.resolved,
        driftCount: r.drift.length,
        applied: r.applied,
        drift: r.drift,
        unresolved: r.unresolved,
        message,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [reconcileIssueState] error: ${msg}`);
      return { ...empty, message: 'Reconcile failed.', error: msg };
    }
  },
});
