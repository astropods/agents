/**
 * OpenAI analysis — sends issue data to GPT-4o and extracts structured info
 * (summary, categories, competitors, solutions, workarounds).
 */

import OpenAI from 'openai';
import {
  EFFORTS,
  type Effort,
  IMPACTS,
  type Impact,
  SEVERITIES,
  type Severity,
  TAXONOMY,
} from './priority';
import type { SubcategoryTerm } from './subcategory';

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
  category: string;
  subcategory: string | null;
  severity: Severity;
  impact: Impact;
  effort: Effort;
  priorityRationale: string;
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

function buildJsonSchema(subcategories: string[]) {
  const schema = {
    type: 'object' as const,
    properties: {
      summary: { type: 'string' as const, description: 'One-sentence summary of the issue' },
      categories: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Relevant categories',
      },
      category: {
        type: 'string' as const,
        enum: TAXONOMY,
        description: 'The single best-fitting bucket for this issue',
      },
      severity: {
        type: 'string' as const,
        enum: SEVERITIES,
        description: 'How damaging the issue is if left unfixed',
      },
      impact: {
        type: 'string' as const,
        enum: IMPACTS,
        description: 'How much of the user base the issue affects',
      },
      effort: {
        type: 'string' as const,
        enum: EFFORTS,
        description: 'Rough size of the work to resolve it',
      },
      priorityRationale: {
        type: 'string' as const,
        description: 'One sentence justifying the severity, impact, and effort call',
      },
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
            solutionText: {
              type: 'string' as const,
              description: 'AI-generated description of the solution',
            },
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
            workaroundText: {
              type: 'string' as const,
              description: 'AI-generated description of the workaround',
            },
            source: { type: 'string' as const, description: 'commentId where mentioned' },
            keywords: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['workaroundText', 'source', 'keywords'] as const,
          additionalProperties: false,
        },
      },
    },
    required: [
      'summary',
      'categories',
      'category',
      'severity',
      'impact',
      'effort',
      'priorityRationale',
      'competitors',
      'solutions',
      'workarounds',
    ] as const,
    additionalProperties: false,
  };

  if (subcategories.length === 0) return schema;

  return {
    ...schema,
    properties: {
      ...schema.properties,
      subcategory: {
        type: 'string' as const,
        enum: subcategories,
        description: 'The single best-fitting corpus-derived subcategory',
      },
    },
    required: [...schema.required, 'subcategory'] as const,
  };
}

export async function analyzeIssueWithOpenAI(
  issueData: AnalysisInput,
  vocabulary: SubcategoryTerm[] = [],
): Promise<AnalysisResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
You are analyzing a GitHub issue and its comments to extract structured information.

**CRITICAL INSTRUCTIONS:**
- Only extract information that is explicitly stated in the text
- The no-inference rule below governs extraction only. The category, severity,
  impact, and effort fields are deliberate judgments: make your best call from
  the title, description, and labels even when nothing states them outright
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

**Then classify the issue (judgment, not extraction):**

6. Category: exactly one bucket, the single best fit:
   - frontend: web client UI, React components, styling, design, accessibility
   - backend: server APIs, handlers, database, business logic, jobs
   - cli: the ast command line tool and local dev workflow
   - infra: Kubernetes, Terraform, networking, registry, deploys, clusters
   - docs: documentation content, guides, references
   - security: auth, permissions, secrets, tenant isolation, vulnerabilities
   - observability: traces, metrics, logs, dashboards, alerting
   - tooling: build system, tests, CI, repo hygiene, developer tooling
   - other: none of the above fits

7. Severity — how damaging if left unfixed:
   - critical: data loss, security hole, or the product is unusable
   - high: a core workflow is broken with no workaround
   - medium: a workflow is degraded, or a workaround exists
   - low: cosmetic, or a minor annoyance

8. Impact — how much of the user base it touches:
   - broad: most users hit this
   - moderate: a common workflow or a sizeable subset
   - narrow: an edge case or a single user

9. Effort — rough size of the fix:
   - small: a contained change, roughly under a day
   - medium: several files or a subsystem
   - large: cross-cutting work, migration, or new architecture

10. PriorityRationale: one sentence justifying those three calls
${
  vocabulary.length === 0
    ? ''
    : `
11. Subcategory: exactly one term from this corpus-derived vocabulary, naming
    the concern or work type. This is a second axis, independent of the area
    category above. Pick the closest fit:
${vocabulary.map((t) => `   - ${t.name}: ${t.definition}`).join('\n')}
`
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are an expert at analyzing GitHub issues. Extract only explicitly stated information for summary, competitors, solutions, and workarounds. Classify category, severity, impact, and effort using your own judgment.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'issue_analysis',
        schema: buildJsonSchema(vocabulary.map((t) => t.name)),
        strict: true,
      },
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
