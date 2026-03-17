import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateEmbedding } from '../../src/services/embeddings';
import { searchVectors } from '../../src/services/vectors';

export const gongSemanticSearchTool = createTool({
  id: 'gongSemanticSearch',
  description: `Search Gong call transcripts using semantic vector search.
Returns matching call transcript chunks with metadata for further analysis.
Include participant names directly in the query string for semantic matching.
If user provides a Gong call URL (https://gong.io/call?id=123), extract call_id and pass it.`,
  inputSchema: z.object({
    query: z.string().describe('Natural language search query (include participant names if relevant)'),
    accountName: z.string().optional().default('').describe('Filter by account name'),
    fromDate: z.string().optional().default('').describe('Start date YYYY-MM-DD'),
    toDate: z.string().optional().default('').describe('End date YYYY-MM-DD'),
    callId: z.string().optional().default('').describe('Specific Gong call ID to filter'),
    topK: z.number().optional().default(60).describe('Number of results (max 60)'),
  }),
  outputSchema: z.object({
    sources: z.array(z.record(z.unknown())),
    totalResults: z.number(),
    filtersApplied: z.record(z.unknown()),
    query: z.string(),
  }),
  execute: async (input) => {
    const topK = Math.min(Math.max(input.topK ?? 60, 1), 60);

    let callId = input.callId || '';
    if (!callId) {
      const match = input.query.match(/id=(\d+)/);
      if (match) callId = match[1];
    }

    console.log(`  [gongSearch] query="${input.query.slice(0, 80)}" account="${input.accountName}" callId="${callId}"`);

    try {
      const queryVector = await generateEmbedding(input.query);

      const filter: Record<string, unknown> = {};
      if (callId) filter.call_id = callId;
      if (input.accountName) filter.account_name = input.accountName;
      if (input.fromDate) {
        const fromUnix = Math.floor(new Date(input.fromDate).getTime() / 1000) - 86400;
        filter.call_date_unix = { ...(filter.call_date_unix as Record<string, number> || {}), $gte: fromUnix };
      }
      if (input.toDate) {
        const toUnix = Math.floor(new Date(input.toDate).getTime() / 1000) + 2 * 86400;
        const existing = (filter.call_date_unix as Record<string, number>) || {};
        filter.call_date_unix = { ...existing, $lte: toUnix };
      }

      const matches = await searchVectors(queryVector, topK, Object.keys(filter).length ? filter : undefined);

      const GONG_BASE = `${process.env.GONG_APP_URL ?? 'https://app.gong.io'}/call?id=`;
      const sources = matches.map((m) => {
        const md = m.metadata;
        const cid = String(md.call_id ?? '');
        return {
          call_id: cid,
          call_title: String(md.call_title ?? ''),
          call_date: String(md.call_date ?? ''),
          account_name: String(md.account_name ?? ''),
          gong_link: cid ? `${GONG_BASE}${cid}` : '',
          chunk_start_time: String(md.chunk_start_time ?? ''),
          speaker: typeof md.speaker === 'object' ? (md.speaker as Record<string, string>)?.name ?? 'Unknown' : String(md.speaker ?? 'Unknown'),
          text: String(md.text ?? ''),
          participants: md.participant_names ?? [],
          external_participants: md.external_participants ?? [],
          score: Math.round((m.score ?? 0) * 1000) / 1000,
        };
      });

      const filtersApplied: Record<string, string> = {};
      if (input.accountName) filtersApplied.account_name = input.accountName;
      if (input.fromDate) filtersApplied.from_date = input.fromDate;
      if (input.toDate) filtersApplied.to_date = input.toDate;
      if (callId) filtersApplied.call_id = callId;

      console.log(`  [gongSearch] returning ${sources.length} sources`);
      return { sources, totalResults: sources.length, filtersApplied, query: input.query };
    } catch (err) {
      console.error(`  [gongSearch] error:`, err);
      return { sources: [], totalResults: 0, filtersApplied: {}, query: input.query };
    }
  },
});
