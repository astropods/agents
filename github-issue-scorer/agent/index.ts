import { serve } from "@astropods/adapter-core";
import { MastraAdapter } from "@astropods/adapter-mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import pMap from "p-map";
import { z } from "zod";
import type { AnalyzedIssue } from "./utils";
import { buildUserMessage, formatFullReport, normalizeAnalysis } from "./utils";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI();

const MAX_ISSUES = 50;

// ---------------------------------------------------------------------------
// GitHub — issues + paginated comments
// ---------------------------------------------------------------------------

async function fetchIssues(owner: string, repo: string, maxIssues: number) {
  const issues: Awaited<
    ReturnType<typeof octokit.rest.issues.listForRepo>
  >["data"] = [];
  let page = 1;

  while (issues.length < maxIssues) {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      per_page: 100,
      page,
    });
    if (data.length === 0) break;
    for (const issue of data) {
      if (!issue.pull_request) issues.push(issue);
      if (issues.length >= maxIssues) break;
    }
    if (data.length < 100) break;
    page++;
  }

  return issues.slice(0, maxIssues);
}

async function fetchSingleIssue(
  owner: string,
  repo: string,
  issueNumber: number,
) {
  const { data } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });
  return data;
}

async function fetchComments(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string[]> {
  const bodies: string[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
      page,
    });
    if (data.length === 0) break;
    for (const c of data) {
      if (c.body) bodies.push(c.body);
    }
    if (data.length < 100) break;
    page++;
  }

  return bodies;
}

// ---------------------------------------------------------------------------
// LLM analysis
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM_PROMPT = [
  "You are a senior product manager analysing a GitHub issue.",
  "Return ONLY a JSON object with these exact keys:",
  "  summary            — 2-3 sentence description of the request or bug",
  '  sentiment          — one of: "frustration" | "urgency" | "neutral" | "positive"',
  "  sentiment_details  — one sentence explaining the detected tone",
  "  competitive_mentions — array of competitor/alternative tool names mentioned (empty array if none)",
  "  workarounds        — array of workarounds users described (empty array if none)",
  '  priority           — one of: "high" | "medium" | "low"',
  "    high:   security vulnerability, data loss, crash, or blocker",
  "    medium: significant bug, degraded UX, or important feature request",
  "    low:    minor bug, cosmetic issue, nice-to-have, or question",
  "  priority_reason    — one sentence justifying the priority",
].join("\n");

async function analyzeIssue(title: string, body: string, comments: string[]) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(title, body, comments) },
    ],
  });
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(response.choices[0].message.content ?? "{}");
  } catch {
    raw = {};
  }
  return normalizeAnalysis(raw);
}

// ---------------------------------------------------------------------------
// Issue pipeline helper
// ---------------------------------------------------------------------------

async function buildAnalyzedIssue(
  owner: string,
  repo: string,
  raw: Awaited<ReturnType<typeof fetchSingleIssue>>,
): Promise<AnalyzedIssue> {
  const comments = await fetchComments(owner, repo, raw.number);
  const analysis = await analyzeIssue(raw.title, raw.body ?? "", comments);
  const reactions =
    (raw as { reactions?: Record<string, number> }).reactions ?? {};
  return {
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    upvotes: reactions["+1"] ?? 0,
    total_reactions: Object.entries(reactions)
      .filter(([k]) => k !== "url" && k !== "total_count")
      .reduce((sum, [, v]) => sum + (typeof v === "number" ? v : 0), 0),
    comment_count: raw.comments,
    analysis,
  };
}

// ---------------------------------------------------------------------------
// Mastra tool
// ---------------------------------------------------------------------------

const scoreGithubIssues = createTool({
  id: "score_github_issues",
  description:
    "Fetch GitHub issues and score each by priority, sentiment, competitor mentions, and workarounds. " +
    "Call this whenever the user provides a GitHub repository in owner/repo format.",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner or organisation"),
    repo: z.string().describe("Repository name"),
    issue_number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Score a single issue by number; omit to score multiple issues",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ISSUES)
      .optional()
      .describe(`Max issues to score (default 5, max ${MAX_ISSUES})`),
  }),
  execute: async ({
    owner,
    repo,
    issue_number,
    limit = 5,
  }: {
    owner: string;
    repo: string;
    issue_number?: number;
    limit?: number;
  }) => {
    try {
      const repoName = `${owner}/${repo}`;
      const analyzed: AnalyzedIssue[] = [];

      if (issue_number) {
        const raw = await fetchSingleIssue(owner, repo, issue_number);
        analyzed.push(await buildAnalyzedIssue(owner, repo, raw));
      } else {
        const maxIssues = Math.min(limit, MAX_ISSUES);
        const issues = await fetchIssues(owner, repo, maxIssues);
        const results = await pMap(
          issues,
          async (raw) => {
            try {
              return await buildAnalyzedIssue(owner, repo, raw);
            } catch (err) {
              console.error(`Failed to analyse issue #${raw.number}:`, err);
              return null;
            }
          },
          { concurrency: 5 },
        );
        for (const result of results) {
          if (result !== null) analyzed.push(result);
        }
      }

      return formatFullReport(analyzed, repoName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error scoring issues for ${owner}/${repo}: ${message}`;
    }
  },
});

// ---------------------------------------------------------------------------
// Mastra agent
// ---------------------------------------------------------------------------

const memory = new Memory({
  storage: new LibSQLStore({ id: "memory", url: ":memory:" }),
});

const agent = new Agent({
  id: "github-issue-scorer",
  name: "GitHub Issue Scorer",
  instructions: `You are a GitHub issue scorer for product teams. When a user provides a GitHub repository, call the score_github_issues tool with the parsed owner, repo, and any optional limit or issue_number. Return the tool output verbatim without reformatting.

Supported input formats:
- "owner/repo"       → score top 5 open issues
- "owner/repo 20"    → score top 20 issues (max 50)
- "owner/repo#123"   → score a single issue by number`,
  model: "openai/gpt-4o-mini",
  memory,
  tools: { score_github_issues: scoreGithubIssues },
});

new Mastra({ agents: { "github-issue-scorer": agent } });

serve(new MastraAdapter(agent));
