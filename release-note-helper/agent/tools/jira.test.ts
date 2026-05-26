import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/jira-client', () => ({
  searchIssues: vi.fn(),
  getIssue: vi.fn(),
}));

import { getIssue, searchIssues } from '../../src/jira-client';
import { getJiraIssueDetailsTool, searchJiraIssuesTool } from './jira';

const mockSearchIssues = vi.mocked(searchIssues);
const mockGetIssue = vi.mocked(getIssue);

const searchCtx = {} as Parameters<NonNullable<typeof searchJiraIssuesTool.execute>>[1];
const getCtx = {} as Parameters<NonNullable<typeof getJiraIssueDetailsTool.execute>>[1];

type SearchResult = {
  issues: unknown[];
  total: number;
  error?: string;
};

type IssueDetailResult = {
  key: string;
  summary: string;
  error?: string;
  [k: string]: unknown;
};

describe('searchJiraIssuesTool', () => {
  it('builds JQL and returns issues with total', async () => {
    const fakeIssues = [
      {
        key: 'PROJ-1',
        summary: 'Fix bug',
        issueType: 'Bug',
        priority: 'High',
        status: 'Done',
        assignee: 'Alice',
        labels: [],
        resolutionDate: '2026-03-01',
      },
    ];
    mockSearchIssues.mockResolvedValueOnce(fakeIssues);

    const result = (await searchJiraIssuesTool.execute!(
      { projectKey: 'PROJ', startDate: '2026-02-01', endDate: '2026-03-01' },
      searchCtx,
    )) as SearchResult;

    expect(result).toEqual({ issues: fakeIssues, total: 1 });
    expect(mockSearchIssues).toHaveBeenCalledWith(expect.stringContaining('project = "PROJ"'));
    expect(mockSearchIssues).toHaveBeenCalledWith(expect.stringContaining('AFTER "2026-02-01"'));
  });

  it('sanitizes projectKey to prevent JQL injection', async () => {
    mockSearchIssues.mockResolvedValueOnce([]);

    await searchJiraIssuesTool.execute!(
      { projectKey: 'PROJ"; DROP TABLE', startDate: '2026-01-01', endDate: '2026-02-01' },
      searchCtx,
    );

    const jql = mockSearchIssues.mock.calls[0][0];
    expect(jql).not.toContain(';');
    expect(jql).not.toContain('DROP');
  });

  it('returns error envelope on failure', async () => {
    mockSearchIssues.mockRejectedValueOnce(new Error('Network timeout'));

    const result = (await searchJiraIssuesTool.execute!(
      { projectKey: 'PROJ', startDate: '2026-01-01', endDate: '2026-02-01' },
      searchCtx,
    )) as SearchResult;

    expect(result).toEqual({
      issues: [],
      total: 0,
      error: 'Network timeout',
    });
  });
});

describe('getJiraIssueDetailsTool', () => {
  it('returns issue detail from client', async () => {
    const fakeDetail = {
      key: 'PROJ-42',
      summary: 'Feature X',
      issueType: 'Story',
      priority: 'High',
      status: 'Done',
      assignee: 'Bob',
      labels: ['backend'],
      resolutionDate: '2026-03-01',
      resolution: 'Done',
      created: '2026-02-01',
      updated: '2026-03-01',
      description: 'Implement feature X',
      components: ['core'],
      fixVersions: ['v2.0.0'],
      linkedIssues: [],
    };
    mockGetIssue.mockResolvedValueOnce(fakeDetail);

    const result = (await getJiraIssueDetailsTool.execute!(
      { issueKey: 'PROJ-42' },
      getCtx,
    )) as IssueDetailResult;

    expect(result).toEqual(fakeDetail);
    expect(mockGetIssue).toHaveBeenCalledWith('PROJ-42');
  });

  it('returns error envelope on failure', async () => {
    mockGetIssue.mockRejectedValueOnce(new Error('404 Not Found'));

    const result = (await getJiraIssueDetailsTool.execute!(
      { issueKey: 'PROJ-999' },
      getCtx,
    )) as IssueDetailResult;

    expect(result.error).toBe('404 Not Found');
    expect(result.key).toBe('PROJ-999');
    expect(result.summary).toBe('');
  });
});
