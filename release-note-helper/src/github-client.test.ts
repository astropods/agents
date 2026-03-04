import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchPRsByKey, findVersionForCommit, checkPRsForIssues } from './github-client';

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function prDetailResponse(overrides: Record<string, unknown> = {}) {
  return {
    number: 10,
    title: 'fix: login issue',
    html_url: 'https://github.com/org/repo/pull/10',
    merged: true,
    merge_commit_sha: 'abc123def456',
    base: { ref: 'main' },
    ...overrides,
  };
}

describe('github-client', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
  });

  describe('searchPRsByKey', () => {
    it('searches and enriches PRs with detail', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse({
            total_count: 1,
            items: [
              { number: 10, title: 'PROJ-1 fix', html_url: 'https://github.com/org/repo/pull/10' },
            ],
          }),
        )
        .mockResolvedValueOnce(mockFetchResponse(prDetailResponse()));

      const prs = await searchPRsByKey('PROJ-1', 'org', 'repo');

      expect(prs).toHaveLength(1);
      expect(prs[0]).toEqual({
        number: 10,
        title: 'fix: login issue',
        url: 'https://github.com/org/repo/pull/10',
        merged: true,
        targetBranch: 'main',
        mergeCommitSha: 'abc123def456',
      });

      const searchUrl = new URL(fetchSpy.mock.calls[0][0]);
      expect(searchUrl.pathname).toBe('/search/issues');
      expect(searchUrl.searchParams.get('q')).toContain('PROJ-1');
      expect(searchUrl.searchParams.get('q')).toContain('type:pr');
    });

    it('returns empty array when no PRs found', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ total_count: 0, items: [] }),
      );

      const prs = await searchPRsByKey('PROJ-999', 'org', 'repo');
      expect(prs).toHaveLength(0);
    });

    it('sets mergeCommitSha to null for unmerged PRs', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse({
            total_count: 1,
            items: [{ number: 5, title: 'WIP', html_url: 'https://github.com/org/repo/pull/5' }],
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse(prDetailResponse({ number: 5, merged: false, merge_commit_sha: 'should_be_null' })),
        );

      const prs = await searchPRsByKey('PROJ-2', 'org', 'repo');
      expect(prs[0].mergeCommitSha).toBeNull();
      expect(prs[0].merged).toBe(false);
    });
  });

  describe('findVersionForCommit', () => {
    it('returns tag name when commit is identical', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse([
            { name: 'v1.0.0', commit: { sha: 'tag_sha_1' } },
          ]),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({ status: 'identical' }),
        );

      const version = await findVersionForCommit('org', 'repo', 'abc123');
      expect(version).toBe('v1.0.0');
    });

    it('returns tag name when commit is behind (tag is ahead)', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse([
            { name: 'v2.0.0', commit: { sha: 'tag_sha_2' } },
          ]),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({ status: 'ahead' }),
        );

      const version = await findVersionForCommit('org', 'repo', 'abc123');
      expect(version).toBe('v2.0.0');
    });

    it('returns null when no tag contains the commit', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse([
            { name: 'v1.0.0', commit: { sha: 'tag_sha_1' } },
          ]),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({ status: 'behind' }),
        );

      const version = await findVersionForCommit('org', 'repo', 'abc123');
      expect(version).toBeNull();
    });

    it('returns null for empty sha', async () => {
      const version = await findVersionForCommit('org', 'repo', '');
      expect(version).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null when tag lookup fails', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 500));

      const version = await findVersionForCommit('org', 'repo', 'abc123');
      expect(version).toBeNull();
    });
  });

  describe('checkPRsForIssues', () => {
    it('aggregates results for multiple issue keys', async () => {
      // PROJ-1: has a merged PR with a version tag
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse({
            total_count: 1,
            items: [{ number: 10, title: 'PROJ-1', html_url: 'https://github.com/org/repo/pull/10' }],
          }),
        )
        .mockResolvedValueOnce(mockFetchResponse(prDetailResponse()))
        .mockResolvedValueOnce(
          mockFetchResponse([{ name: 'v3.0.0', commit: { sha: 'tag_sha' } }]),
        )
        .mockResolvedValueOnce(mockFetchResponse({ status: 'identical' }))
        // PROJ-2: no PRs
        .mockResolvedValueOnce(mockFetchResponse({ total_count: 0, items: [] }));

      const results = await checkPRsForIssues(['PROJ-1', 'PROJ-2'], 'org', 'repo');

      expect(results).toHaveLength(2);
      expect(results[0].issueKey).toBe('PROJ-1');
      expect(results[0].prs).toHaveLength(1);
      expect(results[0].prs[0].version).toBe('v3.0.0');
      expect(results[1].issueKey).toBe('PROJ-2');
      expect(results[1].prs).toHaveLength(0);
    });
  });

  describe('config validation', () => {
    it('throws when GITHUB_TOKEN is missing', async () => {
      delete process.env.GITHUB_TOKEN;
      await expect(searchPRsByKey('X-1', 'o', 'r')).rejects.toThrow(
        'GITHUB_TOKEN environment variable is required',
      );
    });
  });

  describe('retry behavior', () => {
    it('retries on 502 then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse({}, 502))
        .mockResolvedValueOnce(
          mockFetchResponse({ total_count: 0, items: [] }),
        );

      const prs = await searchPRsByKey('PROJ-1', 'org', 'repo');
      expect(prs).toHaveLength(0);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws on non-retryable 404', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({ message: 'Not Found' }, 404));

      await expect(searchPRsByKey('PROJ-1', 'org', 'repo')).rejects.toThrow(
        'GitHub API HTTP 404',
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
