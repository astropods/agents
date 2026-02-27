/**
 * Agent-level evals using Mastra scorers.
 *
 * Starts a Neo4j testcontainer, seeds it with fixture data, then runs
 * the agent against test prompts and scores the results.
 *
 * Prerequisites:
 *   - Docker running
 *   - test/fixtures/seed.cypher exists (run `bun test/dump-fixtures.ts` first)
 *   - OPENAI_API_KEY set in env (for the agent + LLM-based scorers)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Neo4jContainer, type StartedNeo4jContainer } from '@testcontainers/neo4j';
import neo4j, { type Driver } from 'neo4j-driver';
import { Agent } from '@mastra/core/agent';
import { createScorer, type MastraScorer } from '@mastra/core/evals';
import { runEvals } from '@mastra/core/evals';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';
import { queryNeo4jTool } from '../../agent/tools/query-neo4j';
import { summarizeCommentsTool } from '../../agent/tools/summarize-comments';

const FIXTURE_PATH = join(import.meta.dirname, '..', 'fixtures', 'seed.cypher');
const RELEVANCY_THRESHOLD = 0.5;

let container: StartedNeo4jContainer;
let driver: Driver;
let agent: Agent;

/**
 * Custom scorer: checks that the agent actually used tools (didn't hallucinate
 * an answer without querying the knowledge base).
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

async function seedDatabase(driver: Driver, cypherPath: string) {
  const raw = readFileSync(cypherPath, 'utf-8');
  const statements = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));

  const session = driver.session();
  try {
    for (const stmt of statements) {
      await session.run(stmt);
    }
    console.log(`  Seeded ${statements.length} statements`);
  } finally {
    await session.close();
  }
}

beforeAll(async () => {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Fixture file not found: ${FIXTURE_PATH}\n` +
        'Run `bun test/dump-fixtures.ts` while ast dev is running to generate it.',
    );
  }

  console.log('Starting Neo4j testcontainer...');
  container = await new Neo4jContainer('neo4j:5').start();

  const boltUri = container.getBoltUri();
  const username = container.getUsername();
  const password = container.getPassword();

  process.env.NEO4J_URI = boltUri;
  process.env.NEO4J_AUTH = 'basic';
  process.env.NEO4J_USERNAME = username;
  process.env.NEO4J_PASSWORD = password;

  driver = neo4j.driver(boltUri, neo4j.auth.basic(username, password));
  await seedDatabase(driver, FIXTURE_PATH);

  const instructionsRaw = readFileSync(
    join(import.meta.dirname, '..', '..', 'agent', 'index.ts'),
    'utf-8',
  );
  const match = instructionsRaw.match(/const INSTRUCTIONS = `([\s\S]*?)`.trim\(\)/);
  const instructions = match?.[1]?.trim() ?? 'You are a GitHub issue analyzer agent.';

  agent = new Agent({
    name: 'github-issue-analyzer-test',
    instructions,
    model: 'openai/gpt-4o',
    tools: {
      queryNeo4j: queryNeo4jTool,
      summarizeComments: summarizeCommentsTool,
    },
  });
}, 120_000);

afterAll(async () => {
  if (driver) await driver.close();
  if (container) await container.stop();
});

describe('agent evals', () => {
  it('scores well on answer relevancy', async () => {
    const relevancyScorer = createAnswerRelevancyScorer({
      model: 'openai/gpt-4o-mini',
    });

    const result = await runEvals({
      target: agent,
      data: [
        { input: 'How many issues are in the database?' },
        { input: 'What labels exist in the database?' },
        { input: 'List the 5 most recent issues by creation date' },
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
        { input: 'How many issues are in the database?' },
        { input: 'What labels exist?' },
        { input: 'List the most recent issues' },
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
});
