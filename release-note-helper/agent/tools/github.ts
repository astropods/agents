import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { checkPRsForIssues } from '../../src/github-client';

export const checkGithubPRsTool = createTool({
  id: 'checkGithubPRs',
  description:
    'For a list of Jira issue keys, search GitHub for linked pull requests. ' +
    'Returns merge status, target branch, and release version for each PR found. ' +
    'Uses the issue key to search PR titles and branch names.',
  inputSchema: z.object({
    issueKeys: z.array(z.string()).describe('Jira issue keys to look up, e.g. ["ACME-123", "ACME-456"]'),
    owner: z.string().describe('GitHub repository owner/org'),
    repo: z.string().describe('GitHub repository name'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      issueKey: z.string(),
      prs: z.array(z.object({
        number: z.number(),
        title: z.string(),
        url: z.string(),
        merged: z.boolean(),
        targetBranch: z.string(),
        mergeCommitSha: z.string().nullable(),
        version: z.string().nullable(),
      })),
    })),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const results = await checkPRsForIssues(input.issueKeys, input.owner, input.repo);
      return { results };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [checkGithubPRs] error: ${msg}`);
      return { results: [], error: msg };
    }
  },
});
