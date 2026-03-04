import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/jira-client', () => ({
  searchIssues: vi.fn(),
  getIssue: vi.fn(),
}));

import { searchJiraIssuesTool, getJiraIssueDetailsTool } from './jira';
import { searchIssues, getIssue } from '../../src/jira-client';

const mockSearchIssues = vi.mocked(searchIssues);
const mockGetIssue = vi.mocked(getIssue);

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

    const result = await searchJiraIssuesTool.execute!({
      projectKey: 'PROJ',
      startDate: '2026-02-01',
      endDate: '2026-03-01',
    } as any, {} as any, {} as any);

    expect(result).toEqual({ issues: fakeIssues, total: 1 });
    expect(mockSearchIssues).toHaveBeenCalledWith(
      expect.stringContaining('project = "PROJ"'),
    );
    expect(mockSearchIssues).toHaveBeenCalledWith(
      expect.stringContaining('AFTER "2026-02-01"'),
    );
  });

  it('sanitizes projectKey to prevent JQL injection', async () => {
    mockSearchIssues.mockResolvedValueOnce([]);

    await searchJiraIssuesTool.execute!({
      projectKey: 'PROJ"; DROP TABLE',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    } as any, {} as any, {} as any);

    const jql = mockSearchIssues.mock.calls[0][0];
    expect(jql).not.toContain(';');
    expect(jql).not.toContain('DROP');
  });

  it('returns error envelope on failure', async () => {
    mockSearchIssues.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await searchJiraIssuesTool.execute!({
      projectKey: 'PROJ',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    } as any, {} as any, {} as any);

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

    const result = await getJiraIssueDetailsTool.execute!(
      { issueKey: 'PROJ-42' } as any,
      {} as any,
      {} as any,
    );

    expect(result).toEqual(fakeDetail);
    expect(mockGetIssue).toHaveBeenCalledWith('PROJ-42');
  });

  it('returns error envelope on failure', async () => {
    mockGetIssue.mockRejectedValueOnce(new Error('404 Not Found'));

    const result = await getJiraIssueDetailsTool.execute!(
      { issueKey: 'PROJ-999' } as any,
      {} as any,
      {} as any,
    );

    expect(result.error).toBe('404 Not Found');
    expect(result.key).toBe('PROJ-999');
    expect(result.summary).toBe('');
  });
});
