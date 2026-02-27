/**
 * OpenAI analysis — sends issue data to GPT-4o and extracts structured info
 * (summary, categories, competitors, solutions, workarounds).
 */

import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisInput {
  issueId: string;
  issueNumber: number;
  title: string;
  description: string;
  labels: string[];
  comments: { commentId: string; author: string; text: string }[];
}

export interface SolutionAnalysis {
  solutionText: string;
  source: string; // commentId
  keywords: string[];
}

export interface WorkaroundAnalysis {
  workaroundText: string;
  source: string; // commentId
  keywords: string[];
}

export interface CompetitorAnalysis {
  name: string;
  source: string; // commentId
}

export interface IssueAnalysis {
  summary: string;
  categories: string[];
  competitors: CompetitorAnalysis[];
  solutions: SolutionAnalysis[];
  workarounds: WorkaroundAnalysis[];
}

export interface AnalysisResult {
  analysis: IssueAnalysis;
  tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Transform database issue data → analysis input
// ---------------------------------------------------------------------------

export function transformIssueDataForAnalysis(issueData: {
  issue: { issueId: string; number: number; title: string; bodyText: string | null };
  labels: string[];
  comments: { commentId: string; authorLogin?: string | null; bodyText: string | null }[];
}): AnalysisInput {
  return {
    issueId: issueData.issue.issueId,
    issueNumber: issueData.issue.number,
    title: issueData.issue.title,
    description: issueData.issue.bodyText ?? '',
    labels: issueData.labels,
    comments: issueData.comments.map((c) => ({
      commentId: c.commentId,
      author: c.authorLogin ?? 'unknown',
      text: c.bodyText ?? '',
    })),
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const, description: 'One-sentence summary of the issue' },
    categories: { type: 'array' as const, items: { type: 'string' as const }, description: 'Relevant categories' },
    competitors: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          source: { type: 'string' as const, description: 'commentId where mentioned' },
        },
        required: ['name', 'source'] as const,
        additionalProperties: false,
      },
    },
    solutions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          solutionText: { type: 'string' as const, description: 'AI-generated description of the solution' },
          source: { type: 'string' as const, description: 'commentId where mentioned' },
          keywords: { type: 'array' as const, items: { type: 'string' as const } },
        },
        required: ['solutionText', 'source', 'keywords'] as const,
        additionalProperties: false,
      },
    },
    workarounds: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          workaroundText: { type: 'string' as const, description: 'AI-generated description of the workaround' },
          source: { type: 'string' as const, description: 'commentId where mentioned' },
          keywords: { type: 'array' as const, items: { type: 'string' as const } },
        },
        required: ['workaroundText', 'source', 'keywords'] as const,
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'categories', 'competitors', 'solutions', 'workarounds'] as const,
  additionalProperties: false,
};

export async function analyzeIssueWithOpenAI(issueData: AnalysisInput): Promise<AnalysisResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
You are analyzing a GitHub issue and its comments to extract structured information.

**CRITICAL INSTRUCTIONS:**
- Only extract information that is explicitly stated in the text
- Do NOT infer or assume anything
- For competitors, solutions, and workarounds: ONLY extract from COMMENTS, not from the issue description
- For each extracted item, provide the commentId as the source (this is the source of truth)
- For solutions and workarounds, generate a clear descriptive sentence explaining what it is
- Then extract relevant keywords from your generated descriptive sentence
- Keywords should be technical terms, features, tools, concepts, or important terms
- IMPORTANT: Keywords must be present in your generated description text
- If you cannot find explicit information, return empty arrays/strings

**Input Data:**
Issue Title: ${issueData.title}
Issue Description: ${issueData.description}
Issue Labels: ${issueData.labels.join(', ')}

Comments:
${issueData.comments.map((c) => `Comment ID: ${c.commentId}\nText: ${c.text}\n---`).join('\n')}

**Extract the following:**
1. Summary: One-sentence summary of the issue
2. Categories: Array of relevant categories
3. Competitors: Only from comments — explicit mentions of competitor tools/services
4. Solutions: Only from comments — user-proposed solutions mentioned explicitly
5. Workarounds: Only from comments — user-found workarounds mentioned explicitly
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are an expert at analyzing GitHub issues and extracting structured information. Only extract explicitly stated information, do not infer or assume anything.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'issue_analysis', schema: JSON_SCHEMA },
    },
    temperature: 0.1,
  });

  const analysis = JSON.parse(completion.choices[0].message.content!) as IssueAnalysis;
  const usage = completion.usage!;

  console.log(
    `  Token usage — prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, total: ${usage.total_tokens}`,
  );

  return {
    analysis,
    tokenUsage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
  };
}
