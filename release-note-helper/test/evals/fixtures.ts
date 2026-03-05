import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Canned data and mocked tools for agent evals.
 * These tools return deterministic fixture data so evals run without
 * external dependencies (Jira, GitHub, Redis).
 */

const JIRA_ISSUES = [
  {
    key: 'PROJ-101',
    summary: 'Add dark mode support',
    issueType: 'Story',
    priority: 'High',
    status: 'Done',
    assignee: 'Alice',
    labels: ['frontend', 'ux'],
    resolutionDate: '2026-02-28',
  },
  {
    key: 'PROJ-102',
    summary: 'Fix crash on login with SSO',
    issueType: 'Bug',
    priority: 'Critical',
    status: 'Done',
    assignee: 'Bob',
    labels: ['auth'],
    resolutionDate: '2026-02-27',
  },
  {
    key: 'PROJ-103',
    summary: 'Upgrade eslint config to v9',
    issueType: 'Task',
    priority: 'Low',
    status: 'Done',
    assignee: 'Charlie',
    labels: ['chore', 'internal'],
    resolutionDate: '2026-02-26',
  },
  {
    key: 'PROJ-104',
    summary: 'Add CSV export to reports page',
    issueType: 'Story',
    priority: 'Medium',
    status: 'Done',
    assignee: 'Alice',
    labels: ['backend', 'reports'],
    resolutionDate: '2026-02-25',
  },
];

const PR_RESULTS = [
  {
    issueKey: 'PROJ-101',
    prs: [
      {
        number: 201,
        title: 'feat: dark mode support',
        url: 'https://github.com/myorg/myrepo/pull/201',
        merged: true,
        targetBranch: 'main',
        mergeCommitSha: 'aaa111',
        version: 'v3.2.0',
      },
    ],
  },
  {
    issueKey: 'PROJ-102',
    prs: [
      {
        number: 202,
        title: 'fix: SSO login crash',
        url: 'https://github.com/myorg/myrepo/pull/202',
        merged: true,
        targetBranch: 'main',
        mergeCommitSha: 'bbb222',
        version: 'v3.2.0',
      },
    ],
  },
  {
    issueKey: 'PROJ-104',
    prs: [
      {
        number: 204,
        title: 'feat: CSV export for reports',
        url: 'https://github.com/myorg/myrepo/pull/204',
        merged: true,
        targetBranch: 'main',
        mergeCommitSha: 'ddd444',
        version: 'v3.2.0',
      },
    ],
  },
];

const USER_PREFS = {
  defaultProject: 'PROJ',
  githubOwner: 'myorg',
  githubRepo: 'myrepo',
  selectionCriteria:
    'Include bug fixes and new features visible to users. Skip internal refactors, chore tasks, and dependency bumps.',
  releaseNoteExample: `## Release v3.1.0

### New Features
- **Dark mode** — Toggle between light and dark themes in Settings.

### Bug Fixes
- Fixed a crash when logging in with SSO on mobile.

### Improvements
- CSV export is now available on the Reports page.`,
};

// ── Mocked tools ───────────────────────────────────────────────────────

export const mockSearchJiraIssues = createTool({
  id: 'searchJiraIssues',
  description: 'Search Jira issues moved to Done in a date range (mock)',
  inputSchema: z.object({
    projectKey: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.object({
    issues: z.array(z.any()),
    total: z.number(),
  }),
  execute: async () => ({ issues: JIRA_ISSUES, total: JIRA_ISSUES.length }),
});

export const mockGetJiraIssueDetails = createTool({
  id: 'getJiraIssueDetails',
  description: 'Get full Jira issue details (mock)',
  inputSchema: z.object({ issueKey: z.string() }),
  outputSchema: z.any(),
  execute: async (input) => {
    const issue = JIRA_ISSUES.find((i) => i.key === input.issueKey);
    return issue ?? { key: input.issueKey, summary: 'Not found', error: 'Issue not found' };
  },
});

export const mockCheckGithubPRs = createTool({
  id: 'checkGithubPRs',
  description: 'Check GitHub PRs for Jira issue keys (mock)',
  inputSchema: z.object({
    issueKeys: z.array(z.string()),
    owner: z.string(),
    repo: z.string(),
  }),
  outputSchema: z.object({ results: z.array(z.any()) }),
  execute: async (input) => {
    const results = input.issueKeys.map((key) => {
      const match = PR_RESULTS.find((r) => r.issueKey === key);
      return match ?? { issueKey: key, prs: [] };
    });
    return { results };
  },
});

export const mockLoadPreferences = createTool({
  id: 'loadPreferences',
  description: 'Load user preferences (mock)',
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.any(),
  execute: async () => ({ ...USER_PREFS, found: true }),
});

export const mockSavePreferences = createTool({
  id: 'savePreferences',
  description: 'Save user preferences (mock)',
  inputSchema: z.object({
    userId: z.string(),
    preferences: z.any(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async () => ({ success: true }),
});
