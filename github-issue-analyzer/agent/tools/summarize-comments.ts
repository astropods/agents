import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import neo4j from 'neo4j-driver';
import OpenAI from 'openai';
import { getDriver } from '../../src/services/neo4j';

export const summarizeCommentsTool = createTool({
  id: 'summarizeComments',
  description:
    'Fetch and summarize all comments on a GitHub issue. Returns insights ' +
    'on workflows, competitor mentions, workarounds, proposed solutions, ' +
    'and emotional tone. Optionally pass a userQuery to tailor the summary.',
  inputSchema: z.object({
    issueNumber: z.number().describe('The GitHub issue number'),
    userQuery: z
      .string()
      .optional()
      .describe('Optional — specific angle or follow-up to focus the summary on'),
  }),
  outputSchema: z.object({
    summary: z.string(),
    commentCount: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const session = getDriver().session({
      defaultAccessMode: neo4j.session.READ,
    });

    let comments: { author: string; date: string; text: string }[];
    try {
      console.log(
        `  [summarizeComments] fetching comments for issue #${input.issueNumber}`,
      );
      const result = await session.run(
        `MATCH (i:Issue {number: $n})-[:HAS_COMMENT]->(c:Comment)
         OPTIONAL MATCH (c)-[:AUTHORED_BY]->(u:User)
         RETURN c.bodyText AS text, c.createdAt AS date, u.login AS author
         ORDER BY c.createdAt ASC`,
        { n: input.issueNumber },
      );

      comments = result.records.map((r) => ({
        author: (r.get('author') as string) ?? 'unknown',
        date: (r.get('date') as string) ?? '',
        text: (r.get('text') as string) ?? '',
      }));

      console.log(
        `  [summarizeComments] found ${comments.length} comments`,
      );
    } finally {
      await session.close();
    }

    if (comments.length === 0) {
      return {
        summary: `No comments found for issue #${input.issueNumber}.`,
        commentCount: 0,
      };
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const summaryPrompt = input.userQuery
      ? `Summarize the following GitHub issue comments, focusing on: ${input.userQuery}`
      : `Summarize the following GitHub issue comments. Extract:
- Key workflows or use cases mentioned
- Any competitor tools/services mentioned
- Workarounds users have found
- Proposed solutions
- Overall emotional tone (frustrated, neutral, positive)`;

    const formatted = comments
      .map((c) => `[${c.author} — ${c.date}]: ${c.text}`)
      .join('\n\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at summarizing GitHub issue discussions.',
        },
        {
          role: 'user',
          content: `${summaryPrompt}\n\nComments (${comments.length} total):\n${formatted}`,
        },
      ],
      temperature: 0.2,
    });

    console.log(
      `  [summarizeComments] summarised ${comments.length} comments`,
    );

    return {
      summary:
        completion.choices[0].message.content ?? 'Unable to generate summary.',
      commentCount: comments.length,
    };
  },
});
