import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockDriver, mockOpenAICreate } = vi.hoisted(() => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn(),
  };
  const mockDriver = {
    session: vi.fn(() => mockSession),
  };
  const mockOpenAICreate = vi.fn();
  return { mockSession, mockDriver, mockOpenAICreate };
});

vi.mock('../../../src/services/neo4j', () => ({
  getDriver: vi.fn(() => mockDriver),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}));

import { summarizeCommentsTool } from '../summarize-comments';

type SummaryResult = {
  summary: string;
  commentCount: number;
  error?: string;
};

const ctx = {} as Parameters<NonNullable<typeof summarizeCommentsTool.execute>>[1];

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeRecord(data: Record<string, unknown>) {
  const keys = Object.keys(data);
  return {
    keys,
    get: (key: string) => data[key],
  };
}

describe('summarizeCommentsTool', () => {
  it('returns "no comments" when issue has no comments', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });

    const result = (await summarizeCommentsTool.execute!(
      { issueNumber: 999 },
      ctx,
    )) as SummaryResult;

    expect(result).toEqual({
      summary: 'No comments found for issue #999.',
      commentCount: 0,
    });
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  it('fetches comments and calls OpenAI for summary', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ text: 'This is broken', date: '2025-01-01', author: 'alice' }),
        fakeRecord({ text: 'Me too', date: '2025-01-02', author: 'bob' }),
      ],
    });
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Users report a bug affecting multiple people.' } }],
    });

    const result = (await summarizeCommentsTool.execute!(
      { issueNumber: 42 },
      ctx,
    )) as SummaryResult;

    expect(result).toEqual({
      summary: 'Users report a bug affecting multiple people.',
      commentCount: 2,
    });
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);

    const callArgs = mockOpenAICreate.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.messages[1].content).toContain('[alice — 2025-01-01]: This is broken');
    expect(callArgs.messages[1].content).toContain('[bob — 2025-01-02]: Me too');
  });

  it('passes userQuery to the summary prompt', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ text: 'We switched to competitor X', date: '2025-03-01', author: 'carol' }),
      ],
    });
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'One user mentioned switching to competitor X.' } }],
    });

    const result = (await summarizeCommentsTool.execute!(
      { issueNumber: 7, userQuery: 'competitor mentions' },
      ctx,
    )) as SummaryResult;

    expect(result.summary).toBe('One user mentioned switching to competitor X.');
    const prompt = mockOpenAICreate.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain('focusing on: competitor mentions');
  });

  it('handles null author gracefully', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [fakeRecord({ text: 'Anonymous feedback', date: '2025-02-01', author: null })],
    });
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Summary of anonymous feedback.' } }],
    });

    const result = (await summarizeCommentsTool.execute!(
      { issueNumber: 5 },
      ctx,
    )) as SummaryResult;

    expect(result.commentCount).toBe(1);
    const prompt = mockOpenAICreate.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain('[unknown — 2025-02-01]: Anonymous feedback');
  });

  it('always closes the session even when Neo4j fails', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      summarizeCommentsTool.execute!({ issueNumber: 1 }, ctx),
    ).rejects.toThrow('connection lost');

    expect(mockSession.close).toHaveBeenCalledTimes(1);
  });
});
