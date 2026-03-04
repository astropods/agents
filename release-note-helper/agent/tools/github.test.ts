import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/github-client', () => ({
  checkPRsForIssues: vi.fn(),
}));

import { checkGithubPRsTool } from './github';
import { checkPRsForIssues } from '../../src/github-client';

const mockCheckPRs = vi.mocked(checkPRsForIssues);

describe('checkGithubPRsTool', () => {
  it('passes args through and wraps results', async () => {
    const fakeResults = [
      {
        issueKey: 'PROJ-1',
        prs: [
          {
            number: 10,
            title: 'Fix PROJ-1',
            url: 'https://github.com/org/repo/pull/10',
            merged: true,
            targetBranch: 'main',
            mergeCommitSha: 'abc123',
            version: 'v1.0.0',
          },
        ],
      },
    ];
    mockCheckPRs.mockResolvedValueOnce(fakeResults);

    const result = await checkGithubPRsTool.execute!(
      { issueKeys: ['PROJ-1'], owner: 'org', repo: 'repo' } as any,
      {} as any,
      {} as any,
    );

    expect(result).toEqual({ results: fakeResults });
    expect(mockCheckPRs).toHaveBeenCalledWith(['PROJ-1'], 'org', 'repo');
  });

  it('returns error envelope on failure', async () => {
    mockCheckPRs.mockRejectedValueOnce(new Error('Token expired'));

    const result = await checkGithubPRsTool.execute!(
      { issueKeys: ['PROJ-1'], owner: 'org', repo: 'repo' } as any,
      {} as any,
      {} as any,
    );

    expect(result).toEqual({ results: [], error: 'Token expired' });
  });

  it('handles multiple issue keys', async () => {
    mockCheckPRs.mockResolvedValueOnce([
      { issueKey: 'PROJ-1', prs: [] },
      { issueKey: 'PROJ-2', prs: [] },
    ]);

    const result = await checkGithubPRsTool.execute!(
      { issueKeys: ['PROJ-1', 'PROJ-2'], owner: 'org', repo: 'repo' } as any,
      {} as any,
      {} as any,
    );

    expect(result.results).toHaveLength(2);
  });
});
