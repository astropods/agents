/**
 * GitHub Issue Analyzer — Agent
 *
 * Researches GitHub issues in the knowledge graph and answers questions
 * using Cypher queries and comment summarization.
 *
 * Environment variables (auto-injected by ast dev):
 *   GRPC_SERVER_ADDR  — Messaging service address (default: localhost:9090)
 *   OPENAI_API_KEY    — OpenAI API key
 *   GITHUB_OWNER      — Repo owner, used to build issue links
 *   GITHUB_REPO       — Repo name, used to build issue links
 *   NEO4J_HOST        — Neo4j host (default: localhost)
 *   NEO4J_URI         — Neo4j bolt URI (default: bolt://{NEO4J_HOST}:7687)
 *   NEO4J_AUTH        — Set to enable auth (default: disabled)
 */

import { serve } from '@astropods/adapter-mastra';
import { Agent } from '@mastra/core/agent';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { buildInstructions } from './instructions';
import { applyLabelSyncTool } from './tools/apply-label-sync';
import { previewLabelSyncTool } from './tools/preview-label-sync';
import { prioritizeIssuesTool } from './tools/prioritize-issues';
import { queryNeo4jTool } from './tools/query-neo4j';
import { summarizeCommentsTool } from './tools/summarize-comments';

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

if (!owner || !repo) {
  console.warn('agent: GITHUB_OWNER/GITHUB_REPO not set, issue links disabled');
}

const INSTRUCTIONS = buildInstructions(owner, repo);

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'memory',
    url: ':memory:',
  }),
});

const agent = new Agent({
  id: 'github-issue-analyzer',
  name: 'github-issue-analyzer',
  instructions: INSTRUCTIONS,
  model: 'openai/gpt-4o',
  tools: {
    queryNeo4j: queryNeo4jTool,
    summarizeComments: summarizeCommentsTool,
    prioritizeIssues: prioritizeIssuesTool,
    previewLabelSync: previewLabelSyncTool,
    applyLabelSync: applyLabelSyncTool,
  },
  memory,
});

serve(agent);
