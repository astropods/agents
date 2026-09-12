/**
 * GitHub Issue Analyzer — Agent
 *
 * Researches GitHub issues in the knowledge graph and answers questions
 * using Cypher queries and comment summarization.
 *
 * Environment variables (auto-injected by ast dev):
 *   GRPC_SERVER_ADDR  — Messaging service address (default: localhost:9090)
 *   ASTRO_GATEWAY_URL — AI gateway host, injected by the platform
 *   ASTRO_GATEWAY_API_KEY — AI gateway key, injected by the platform
 *   MODEL_REASONING   — Model for the agent (default: claude-sonnet-4-6)
 *   MODEL_FAST        — Model for classification and summaries (default: claude-haiku-4-5)
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
import { gatewayModel } from '../src/services/models';
import { buildInstructions } from './instructions';
import { applyLabelSyncTool } from './tools/apply-label-sync';
import { previewLabelSyncTool } from './tools/preview-label-sync';
import { prioritizeIssuesTool } from './tools/prioritize-issues';
import { queryNeo4jTool } from './tools/query-neo4j';
import { reconcileIssueStateTool } from './tools/reconcile-issue-state';
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
  model: gatewayModel('agent'),
  tools: {
    queryNeo4j: queryNeo4jTool,
    summarizeComments: summarizeCommentsTool,
    prioritizeIssues: prioritizeIssuesTool,
    previewLabelSync: previewLabelSyncTool,
    applyLabelSync: applyLabelSyncTool,
    reconcileIssueState: reconcileIssueStateTool,
  },
  memory,
});

serve(agent);
