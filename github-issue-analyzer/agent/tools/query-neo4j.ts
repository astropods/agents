import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import neo4j from 'neo4j-driver';
import { getDriver } from '../../src/services/neo4j';

export const queryNeo4jTool = createTool({
  id: 'queryNeo4j',
  description:
    'Execute a read-only Cypher query against the Neo4j knowledge graph. ' +
    'Returns JSON rows. Always use LIMIT to keep results manageable. ' +
    'Build queries ONLY with the schema provided in your instructions.',
  inputSchema: z.object({
    cypher: z.string().describe('A read-only Cypher query'),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.unknown())),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const session = getDriver().session({
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      console.log(
        `  [queryNeo4j] ${input.cypher.replace(/\n/g, ' ').slice(0, 120)}…`,
      );
      const result = await session.run(input.cypher);
      const rows = result.records.map((r) => {
        const obj: Record<string, unknown> = {};
        r.keys.forEach((key) => {
          const k = String(key);
          const val = r.get(k);
          obj[k] = neo4j.isInt(val) ? val.toNumber() : val;
        });
        return obj;
      });
      console.log(`  [queryNeo4j] returned ${rows.length} rows`);
      return { rows, count: rows.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [queryNeo4j] error: ${msg}`);
      return { rows: [], count: 0, error: msg };
    } finally {
      await session.close();
    }
  },
});
