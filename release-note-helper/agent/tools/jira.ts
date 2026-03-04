import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchIssues, getIssue } from '../../src/jira-client';

export const searchJiraIssuesTool = createTool({
  id: 'searchJiraIssues',
  description:
    'Search for Jira issues that were moved to Done in a given date range for a project. ' +
    'Returns a summary list of all matching issues.',
  inputSchema: z.object({
    projectKey: z.string().describe('Jira project key, e.g. "ACME"'),
    startDate: z.string().describe('Start of date range in YYYY-MM-DD format'),
    endDate: z.string().describe('End of date range in YYYY-MM-DD format'),
  }),
  outputSchema: z.object({
    issues: z.array(z.object({
      key: z.string(),
      summary: z.string(),
      issueType: z.string(),
      priority: z.string(),
      status: z.string(),
      assignee: z.string().nullable(),
      labels: z.array(z.string()),
      resolutionDate: z.string().nullable(),
    })),
    total: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const safeKey = input.projectKey.replace(/[^A-Z0-9_]/gi, '');
      const jql =
        `project = "${safeKey}" AND status changed to "Done" ` +
        `AFTER "${input.startDate}" BEFORE "${input.endDate}" ORDER BY resolutiondate DESC`;
      const issues = await searchIssues(jql);
      return { issues, total: issues.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [searchJiraIssues] error: ${msg}`);
      return { issues: [], total: 0, error: msg };
    }
  },
});

export const getJiraIssueDetailsTool = createTool({
  id: 'getJiraIssueDetails',
  description:
    'Fetch full details for a specific Jira issue including description, ' +
    'linked issues, components, and fix versions.',
  inputSchema: z.object({
    issueKey: z.string().describe('Jira issue key, e.g. "ACME-123"'),
  }),
  outputSchema: z.object({
    key: z.string(),
    summary: z.string(),
    issueType: z.string(),
    priority: z.string(),
    status: z.string(),
    assignee: z.string().nullable(),
    labels: z.array(z.string()),
    resolutionDate: z.string().nullable(),
    resolution: z.string().nullable(),
    created: z.string(),
    updated: z.string(),
    description: z.string().nullable(),
    components: z.array(z.string()),
    fixVersions: z.array(z.string()),
    linkedIssues: z.array(z.object({
      type: z.string(),
      key: z.string(),
      summary: z.string(),
    })),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      return await getIssue(input.issueKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [getJiraIssueDetails] error: ${msg}`);
      return {
        key: input.issueKey, summary: '', issueType: '', priority: '', status: '',
        assignee: null, labels: [], resolutionDate: null, resolution: null,
        created: '', updated: '', description: null, components: [],
        fixVersions: [], linkedIssues: [], error: msg,
      };
    }
  },
});
