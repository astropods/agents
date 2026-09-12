import { createTool } from '@mastra/core/tools';
import neo4j from 'neo4j-driver';
import { z } from 'zod';
import { getDriver } from '../../src/services/neo4j';
import { TAXONOMY } from '../../src/services/priority';

const issueShape = z.object({
  number: z.number(),
  title: z.string(),
  category: z.string().nullable(),
  severity: z.string().nullable(),
  impact: z.string().nullable(),
  effort: z.string().nullable(),
  priorityScore: z.number().nullable(),
  priorityRationale: z.string().nullable(),
});

export const prioritizeIssuesTool = createTool({
  id: 'prioritizeIssues',
  description:
    'List issues ranked by priority score (highest first), optionally filtered ' +
    'to one category or grouped by category. Use this instead of hand-written ' +
    'Cypher whenever the question is about what to work on next, or how issues ' +
    'break down by area.',
  inputSchema: z.object({
    category: z
      .enum(TAXONOMY)
      .optional()
      .describe('Restrict to a single category; omit for all categories'),
    limit: z.number().default(20).describe('Max issues to return, or per group when grouping'),
    groupByCategory: z
      .boolean()
      .default(false)
      .describe('Return issues grouped by category instead of one flat ranked list'),
  }),
  outputSchema: z.object({
    issues: z.array(issueShape),
    groups: z
      .array(z.object({ category: z.string(), count: z.number(), issues: z.array(issueShape) }))
      .optional(),
    total: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const session = getDriver().session({
      defaultAccessMode: neo4j.session.READ,
    });

    try {
      console.log(
        `  [prioritizeIssues] category=${input.category ?? 'all'} limit=${input.limit} grouped=${input.groupByCategory}`,
      );

      const result = await session.run(
        `MATCH (i:Issue)
         WHERE i.priorityScore IS NOT NULL
           AND ($category IS NULL OR i.category = $category)
         RETURN i.number AS number, i.title AS title, i.category AS category,
                i.severity AS severity, i.impact AS impact, i.effort AS effort,
                i.priorityScore AS priorityScore, i.priorityRationale AS priorityRationale
         ORDER BY i.priorityScore DESC, i.number ASC`,
        { category: input.category ?? null },
      );

      const all = result.records.map((r) => ({
        number: neo4j.int(r.get('number')).toNumber(),
        title: (r.get('title') as string) ?? '',
        category: (r.get('category') as string) ?? null,
        severity: (r.get('severity') as string) ?? null,
        impact: (r.get('impact') as string) ?? null,
        effort: (r.get('effort') as string) ?? null,
        priorityScore: neo4j.int(r.get('priorityScore')).toNumber(),
        priorityRationale: (r.get('priorityRationale') as string) ?? null,
      }));

      console.log(`  [prioritizeIssues] matched ${all.length} classified issues`);

      if (!input.groupByCategory) {
        return { issues: all.slice(0, input.limit), total: all.length };
      }

      const byCategory = new Map<string, typeof all>();
      for (const issue of all) {
        const key = issue.category ?? 'other';
        const bucket = byCategory.get(key);
        if (bucket) bucket.push(issue);
        else byCategory.set(key, [issue]);
      }

      const groups = [...byCategory.entries()]
        .map(([category, issues]) => ({
          category,
          count: issues.length,
          issues: issues.slice(0, input.limit),
        }))
        .sort((a, b) => b.count - a.count);

      return { issues: [], groups, total: all.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [prioritizeIssues] error: ${msg}`);
      return { issues: [], total: 0, error: msg };
    } finally {
      await session.close();
    }
  },
});
