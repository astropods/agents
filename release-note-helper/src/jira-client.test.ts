import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchIssues, getIssue } from './jira-client';

const JIRA_ENV = {
  JIRA_BASE_URL: 'https://test.atlassian.net',
  JIRA_EMAIL: 'test@example.com',
  JIRA_API_KEY: 'test-token',
};

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('jira-client', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(process.env, JIRA_ENV);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(JIRA_ENV)) delete process.env[key];
  });

  describe('searchIssues', () => {
    it('returns mapped issues from a single page', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          issues: [
            {
              key: 'PROJ-1',
              fields: {
                summary: 'Fix login bug',
                issuetype: { name: 'Bug' },
                priority: { name: 'High' },
                status: { name: 'Done' },
                assignee: { displayName: 'Alice' },
                labels: ['frontend'],
                resolutiondate: '2026-02-28',
              },
            },
          ],
        }),
      );

      const issues = await searchIssues('project = "PROJ"');

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual({
        key: 'PROJ-1',
        summary: 'Fix login bug',
        issueType: 'Bug',
        priority: 'High',
        status: 'Done',
        assignee: 'Alice',
        labels: ['frontend'],
        resolutionDate: '2026-02-28',
      });

      const url = new URL(fetchSpy.mock.calls[0][0]);
      expect(url.pathname).toBe('/rest/api/3/search/jql');
      expect(url.searchParams.get('jql')).toBe('project = "PROJ"');
    });

    it('paginates when first page is full', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        key: `PROJ-${i}`,
        fields: {
          summary: `Issue ${i}`,
          issuetype: { name: 'Task' },
          priority: { name: 'Medium' },
          status: { name: 'Done' },
          assignee: null,
          labels: [],
          resolutiondate: null,
        },
      }));

      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse({ issues: fullPage }))
        .mockResolvedValueOnce(mockFetchResponse({ issues: [fullPage[0]] }));

      const issues = await searchIssues('project = "PROJ"');

      expect(issues).toHaveLength(101);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('stops paginating when page has fewer than maxResults', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ issues: [{ key: 'PROJ-1', fields: {} }] }),
      );

      await searchIssues('project = "PROJ"');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('handles missing fields gracefully', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          issues: [{ key: 'PROJ-1', fields: {} }],
        }),
      );

      const issues = await searchIssues('project = "PROJ"');
      expect(issues[0]).toEqual({
        key: 'PROJ-1',
        summary: '',
        issueType: 'Unknown',
        priority: 'None',
        status: 'Unknown',
        assignee: null,
        labels: [],
        resolutionDate: null,
      });
    });

    it('throws on non-retryable HTTP errors', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({ error: 'bad request' }, 400));

      await expect(searchIssues('bad jql')).rejects.toThrow('Jira API HTTP 400');
    });

    it('retries on 429 then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse({}, 429))
        .mockResolvedValueOnce(
          mockFetchResponse({ issues: [{ key: 'PROJ-1', fields: {} }] }),
        );

      const issues = await searchIssues('project = "PROJ"');
      expect(issues).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getIssue', () => {
    it('maps all detail fields correctly', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          key: 'PROJ-42',
          fields: {
            summary: 'Implement feature X',
            issuetype: { name: 'Story' },
            priority: { name: 'High' },
            status: { name: 'Done' },
            assignee: { displayName: 'Bob' },
            labels: ['backend', 'api'],
            resolutiondate: '2026-03-01',
            resolution: { name: 'Done' },
            created: '2026-02-01T10:00:00.000+0000',
            updated: '2026-03-01T12:00:00.000+0000',
            description: 'plain text description',
            components: [{ name: 'core' }],
            fixVersions: [{ name: 'v2.1.0' }],
            issuelinks: [
              {
                type: { name: 'Blocks' },
                outwardIssue: { key: 'PROJ-43', fields: { summary: 'Blocked task' } },
              },
            ],
          },
        }),
      );

      const detail = await getIssue('PROJ-42');

      expect(detail.key).toBe('PROJ-42');
      expect(detail.summary).toBe('Implement feature X');
      expect(detail.issueType).toBe('Story');
      expect(detail.resolution).toBe('Done');
      expect(detail.components).toEqual(['core']);
      expect(detail.fixVersions).toEqual(['v2.1.0']);
      expect(detail.linkedIssues).toEqual([
        { type: 'Blocks', key: 'PROJ-43', summary: 'Blocked task' },
      ]);
      expect(detail.description).toBe('plain text description');
    });

    it('extracts text from ADF description', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          key: 'PROJ-1',
          fields: {
            summary: 'ADF test',
            issuetype: { name: 'Bug' },
            priority: { name: 'Low' },
            status: { name: 'Done' },
            assignee: null,
            labels: [],
            resolutiondate: null,
            resolution: null,
            created: '2026-01-01',
            updated: '2026-01-02',
            description: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Hello ' },
                    { type: 'text', text: 'world' },
                  ],
                },
              ],
            },
            components: [],
            fixVersions: [],
            issuelinks: [],
          },
        }),
      );

      const detail = await getIssue('PROJ-1');
      expect(detail.description).toBe('Hello world');
    });

    it('handles inward issue links', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          key: 'PROJ-5',
          fields: {
            summary: 'Test',
            issuetype: { name: 'Task' },
            priority: { name: 'Medium' },
            status: { name: 'Done' },
            assignee: null,
            labels: [],
            resolutiondate: null,
            resolution: null,
            created: '2026-01-01',
            updated: '2026-01-02',
            description: null,
            components: [],
            fixVersions: [],
            issuelinks: [
              {
                type: { name: 'is blocked by' },
                inwardIssue: { key: 'PROJ-4', fields: { summary: 'Blocker' } },
              },
            ],
          },
        }),
      );

      const detail = await getIssue('PROJ-5');
      expect(detail.linkedIssues).toEqual([
        { type: 'is blocked by', key: 'PROJ-4', summary: 'Blocker' },
      ]);
    });
  });

  describe('config validation', () => {
    it('throws when env vars are missing', async () => {
      delete process.env.JIRA_BASE_URL;
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_API_KEY;

      await expect(searchIssues('project = "X"')).rejects.toThrow(
        'Missing Jira env vars',
      );
    });
  });
});
