import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/neo4j', () => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn(),
  };
  const mockDriver = {
    session: vi.fn(() => mockSession),
  };
  return {
    getDriver: vi.fn(() => mockDriver),
    __mockSession: mockSession,
  };
});

vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    __mockCreate: mockCreate,
  };
});

import { summarizeCommentsTool } from '../summarize-comments';
import { __mockSession as mockSession } from '../../../src/services/neo4j';
import { __mockCreate as mockCreate } from 'openai';

const session = mockSession as unknown as {
  run: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
const openaiCreate = mockCreate as ReturnType<typeof vi.fn>;

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
    session.run.mockResolvedValueOnce({ records: [] });

    const result = await summarizeCommentsTool.execute!({
      issueNumber: 999,
    });

    expect(result).toEqual({
      summary: 'No comments found for issue #999.',
      commentCount: 0,
    });
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it('fetches comments and calls OpenAI for summary', async () => {
    session.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ text: 'This is broken', date: '2025-01-01', author: 'alice' }),
        fakeRecord({ text: 'Me too', date: '2025-01-02', author: 'bob' }),
      ],
    });
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Users report a bug affecting multiple people.' } }],
    });

    const result = await summarizeCommentsTool.execute!({
      issueNumber: 42,
    });

    expect(result).toEqual({
      summary: 'Users report a bug affecting multiple people.',
      commentCount: 2,
    });
    expect(openaiCreate).toHaveBeenCalledTimes(1);

    const callArgs = openaiCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.messages[1].content).toContain('[alice — 2025-01-01]: This is broken');
    expect(callArgs.messages[1].content).toContain('[bob — 2025-01-02]: Me too');
  });

  it('passes userQuery to the summary prompt', async () => {
    session.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ text: 'We switched to competitor X', date: '2025-03-01', author: 'carol' }),
      ],
    });
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'One user mentioned switching to competitor X.' } }],
    });

    const result = await summarizeCommentsTool.execute!({
      issueNumber: 7,
      userQuery: 'competitor mentions',
    });

    expect(result.summary).toBe('One user mentioned switching to competitor X.');
    const prompt = openaiCreate.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain('focusing on: competitor mentions');
  });

  it('handles null author gracefully', async () => {
    session.run.mockResolvedValueOnce({
      records: [
        fakeRecord({ text: 'Anonymous feedback', date: '2025-02-01', author: null }),
      ],
    });
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Summary of anonymous feedback.' } }],
    });

    const result = await summarizeCommentsTool.execute!({ issueNumber: 5 });

    expect(result.commentCount).toBe(1);
    const prompt = openaiCreate.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain('[unknown — 2025-02-01]: Anonymous feedback');
  });

  it('always closes the session even when Neo4j fails', async () => {
    session.run.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      summarizeCommentsTool.execute!({ issueNumber: 1 }),
    ).rejects.toThrow('connection lost');

    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
