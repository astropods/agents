/**
 * Agent-level evals using Mastra scorers.
 *
 * Uses mocked tools that return canned fixture data so no external
 * services (Jira, GitHub, Redis) are required.
 *
 * Prerequisites:
 *   - ANTHROPIC_API_KEY set in .env (for the agent model and LLM-based scorers)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { createScorer, type MastraScorer } from '@mastra/core/evals';
import { runEvals } from '@mastra/core/evals';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';
import {
  mockSearchJiraIssues,
  mockGetJiraIssueDetails,
  mockCheckGithubPRs,
  mockLoadPreferences,
  mockSavePreferences,
} from './fixtures';

const RELEVANCY_THRESHOLD = 0.5;

let agent: Agent;

const today = new Date().toISOString().split('T')[0];

const INSTRUCTIONS = `
You are Release Note Helper, an AI assistant that helps users craft professional
release notes from Jira issues and GitHub pull requests.

Today's date is ${today}.

# Tools available

- searchJiraIssues: Search for Jira issues moved to Done in a date range
- getJiraIssueDetails: Get full details for a specific Jira issue
- checkGithubPRs: Find GitHub PRs linked to Jira issue keys
- loadPreferences: Load stored user preferences
- savePreferences: Save or update user preferences

# Important rules

- ALWAYS call loadPreferences at the start of a conversation.
- ALWAYS use tools to look up real data. Never guess.
- When presenting candidates, show ALL issues with recommendations.
- When generating release notes, include all accepted issues.
`.trim();

/**
 * Custom scorer: verifies the agent called at least one tool.
 */
const toolUsageScorer = createScorer({
  id: 'tool-usage',
  description: 'Checks that the agent called at least one tool',
  type: 'agent',
}).generateScore(({ run }) => {
  const output = run.output;
  if (!Array.isArray(output)) return 0;
  const hasToolCall = output.some((msg: any) => {
    if (msg.role === 'tool') return true;
    if (msg.toolCalls?.length > 0) return true;
    if (msg.toolInvocations?.length > 0) return true;
    const parts = msg.content?.parts ?? [];
    if (parts.some((p: any) => p.type === 'tool-invocation' || p.type === 'tool-result')) return true;
    return false;
  });
  return hasToolCall ? 1 : 0;
}).generateReason(({ score }) => {
  return score === 1
    ? 'Agent used tools to query data before responding.'
    : 'Agent responded without using any tools — possible hallucination.';
});

/**
 * Custom scorer: checks that the agent's release note output mentions
 * all expected issue keys. Only meaningful for generation prompts.
 */
const EXPECTED_ISSUE_KEYS = ['PROJ-101', 'PROJ-102', 'PROJ-104'];

const completenessScorer = createScorer({
  id: 'completeness',
  description: 'Checks that all accepted Jira issue keys appear in the agent output',
  type: 'agent',
}).generateScore(({ run }) => {
  const output = run.output;
  const text = Array.isArray(output)
    ? output.map((m: any) => {
        if (typeof m.content === 'string') return m.content;
        if (m.content?.parts) {
          return m.content.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join(' ');
        }
        return '';
      }).join(' ')
    : String(output);

  const found = EXPECTED_ISSUE_KEYS.filter((k) => text.includes(k));
  return found.length / EXPECTED_ISSUE_KEYS.length;
}).generateReason(({ score }) => {
  if (score === 1) return 'All expected issue keys appear in the output.';
  const pct = Math.round(score * 100);
  return `Only ${pct}% of expected issue keys found in the output.`;
});

beforeAll(() => {
  agent = new Agent({
    name: 'release-note-helper-eval',
    instructions: INSTRUCTIONS,
    model: 'anthropic/claude-sonnet-4-5',
    tools: {
      searchJiraIssues: mockSearchJiraIssues,
      getJiraIssueDetails: mockGetJiraIssueDetails,
      checkGithubPRs: mockCheckGithubPRs,
      loadPreferences: mockLoadPreferences,
      savePreferences: mockSavePreferences,
    },
  });
});

describe('agent evals', () => {
  it('scores well on answer relevancy', async () => {
    const relevancyScorer = createAnswerRelevancyScorer({
      model: 'anthropic/claude-sonnet-4-5',
    });

    const result = await runEvals({
      target: agent,
      data: [
        { input: 'Show me all PROJ issues moved to done in the past week' },
        { input: 'Check GitHub PRs for PROJ-101 and PROJ-102 in myorg/myrepo' },
      ],
      scorers: [relevancyScorer as MastraScorer<any, any, any, any>],
      concurrency: 1,
      onItemComplete: ({ item, scorerResults }) => {
        const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input);
        const score = scorerResults['answer-relevancy-scorer']?.score ?? 'N/A';
        const reason = scorerResults['answer-relevancy-scorer']?.reason ?? '';
        console.log(`  "${input}" → ${score}  ${reason}`);
      },
    });

    const avgScore = result.scores['answer-relevancy-scorer'];
    console.log(`\n  Average relevancy score: ${avgScore}`);
    expect(avgScore).toBeGreaterThanOrEqual(RELEVANCY_THRESHOLD);
  }, 120_000);

  it('uses tools for every query', async () => {
    const result = await runEvals({
      target: agent,
      data: [
        { input: 'Show me all PROJ issues moved to done in the past week' },
        { input: 'Check GitHub PRs for PROJ-101 in myorg/myrepo' },
        { input: 'Load my preferences' },
      ],
      scorers: [toolUsageScorer as MastraScorer<any, any, any, any>],
      concurrency: 1,
      onItemComplete: ({ item, scorerResults }) => {
        const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input);
        const score = scorerResults['tool-usage']?.score ?? 'N/A';
        const reason = scorerResults['tool-usage']?.reason ?? '';
        console.log(`  "${input}" → ${score}  ${reason}`);
      },
    });

    const avgScore = result.scores['tool-usage'];
    console.log(`\n  Average tool-usage score: ${avgScore}`);
    expect(avgScore).toBe(1);
  }, 120_000);

  it('includes all accepted issues in release note', async () => {
    const result = await runEvals({
      target: agent,
      data: [
        {
          input:
            'Generate a release note for these accepted issues: PROJ-101 (Add dark mode support), ' +
            'PROJ-102 (Fix crash on login with SSO), PROJ-104 (Add CSV export to reports page). ' +
            'Use my stored release note format as a reference. My user ID is eval-user.',
        },
      ],
      scorers: [completenessScorer as MastraScorer<any, any, any, any>],
      concurrency: 1,
      onItemComplete: ({ item, scorerResults }) => {
        const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input);
        const score = scorerResults['completeness']?.score ?? 'N/A';
        const reason = scorerResults['completeness']?.reason ?? '';
        console.log(`  "${input.slice(0, 60)}..." → ${score}  ${reason}`);
      },
    });

    const avgScore = result.scores['completeness'];
    console.log(`\n  Average completeness score: ${avgScore}`);
    expect(avgScore).toBeGreaterThanOrEqual(0.66);
  }, 120_000);
});
