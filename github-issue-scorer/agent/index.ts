import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { Octokit } from '@octokit/rest';
import OpenAI from 'openai';
import { WebClient as SlackClient } from '@slack/web-api';
import {
  normalizeAnalysis,
  splitIntoSlackChunks,
  formatFullReport,
  buildUserMessage,
} from './utils';
import type { AnalyzedIssue } from './utils';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI();

const MAX_ISSUES = 50;

// ---------------------------------------------------------------------------
// GitHub — issues + paginated comments
// ---------------------------------------------------------------------------

async function fetchIssues(owner: string, repo: string, maxIssues: number) {
  const issues: Awaited<ReturnType<typeof octokit.rest.issues.listForRepo>>['data'] = [];
  let page = 1;

  while (issues.length < maxIssues) {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
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

async function fetchSingleIssue(owner: string, repo: string, issueNumber: number) {
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
  return data;
}

async function fetchComments(owner: string, repo: string, issueNumber: number): Promise<string[]> {
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
  'You are a senior product manager analysing a GitHub issue.',
  'Return ONLY a JSON object with these exact keys:',
  '  summary            — 2-3 sentence description of the request or bug',
  '  sentiment          — one of: "frustration" | "urgency" | "neutral" | "positive"',
  '  sentiment_details  — one sentence explaining the detected tone',
  '  competitive_mentions — array of competitor/alternative tool names mentioned (empty array if none)',
  '  workarounds        — array of workarounds users described (empty array if none)',
  '  priority           — one of: "high" | "medium" | "low"',
  '    high:   security vulnerability, data loss, crash, or blocker',
  '    medium: significant bug, degraded UX, or important feature request',
  '    low:    minor bug, cosmetic issue, nice-to-have, or question',
  '  priority_reason    — one sentence justifying the priority',
].join('\n');

async function analyzeIssue(title: string, body: string, comments: string[]) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(title, body, comments) },
    ],
  });
  const raw = JSON.parse(response.choices[0].message.content ?? '{}');
  return normalizeAnalysis(raw);
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

async function postToSlack(text: string): Promise<void> {
  const token = process.env.SLACK_POSTING_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  if (!token || !channel) return;

  const slack = new SlackClient(token);
  for (const chunk of splitIntoSlackChunks(text)) {
    await slack.chat.postMessage({ channel, text: chunk });
  }
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

async function processIssue(
  owner: string,
  repo: string,
  rawIssue: Awaited<ReturnType<typeof fetchIssues>>[number] | Awaited<ReturnType<typeof fetchSingleIssue>>,
  hooks: StreamHooks,
): Promise<AnalyzedIssue> {
  hooks.onChunk(`  Fetching comments for #${rawIssue.number}...\n`);
  const comments = await fetchComments(owner, repo, rawIssue.number);

  hooks.onChunk(`  Analysing #${rawIssue.number} (${comments.length} comment(s))...\n`);
  const analysis = await analyzeIssue(rawIssue.title, rawIssue.body ?? '', comments);

  const reactions = (rawIssue as { reactions?: Record<string, number> }).reactions ?? {};

  return {
    number: rawIssue.number,
    title: rawIssue.title,
    url: rawIssue.html_url,
    upvotes: reactions['+1'] ?? 0,
    total_reactions: Object.entries(reactions)
      .filter(([k]) => k !== 'url' && k !== 'total_count')
      .reduce((sum, [, v]) => sum + (typeof v === 'number' ? v : 0), 0),
    comment_count: rawIssue.comments,
    analysis,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const adapter: AgentAdapter = {
  name: 'github-issue-scorer',

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    try {
      const repoMatch = prompt.match(/([\w.-]+\/[\w.-]+)/);
      if (!repoMatch) {
        hooks.onChunk(
          'Please provide a GitHub repository in owner/repo format, e.g. `pallets/flask`.\n' +
          'To analyse a single issue: `pallets/flask#123`',
        );
        hooks.onFinish();
        return;
      }

      const repoName = repoMatch[1];
      const [owner, repo] = repoName.split('/');

      // Single-issue mode: owner/repo#123
      const singleIssueMatch = prompt.match(/[\w.-]+\/[\w.-]+#(\d+)/);

      const analyzed: AnalyzedIssue[] = [];

      if (singleIssueMatch) {
        const issueNumber = parseInt(singleIssueMatch[1], 10);
        hooks.onChunk(`Fetching issue #${issueNumber} from \`${repoName}\`...\n`);
        const raw = await fetchSingleIssue(owner, repo, issueNumber);
        analyzed.push(await processIssue(owner, repo, raw, hooks));
      } else {
        const numMatch = prompt.replace(repoName, '').match(/\btop\s+(\d+)\b|\blimit[: ]+(\d+)\b|\b(\d+)\s+issues?\b/i);
        const requested = numMatch
          ? parseInt(numMatch[1] ?? numMatch[2] ?? numMatch[3], 10)
          : 5;
        const maxIssues = Math.min(Math.max(1, requested), MAX_ISSUES);

        if (requested > MAX_ISSUES) {
          hooks.onChunk(`Note: capped at ${MAX_ISSUES} issues maximum.\n`);
        }

        hooks.onChunk(`Fetching up to ${maxIssues} open issues from \`${repoName}\`...\n`);
        const issues = await fetchIssues(owner, repo, maxIssues);

        if (issues.length === 0) {
          hooks.onChunk(`No open issues found in \`${repoName}\`.`);
          hooks.onFinish();
          return;
        }

        hooks.onChunk(`Found ${issues.length} issue(s). Starting deep analysis...\n\n`);
        for (const issue of issues) {
          analyzed.push(await processIssue(owner, repo, issue, hooks));
        }
      }

      const report = formatFullReport(analyzed, repoName);

      hooks.onChunk('\n' + report);

      if (process.env.SLACK_POSTING_TOKEN && process.env.SLACK_CHANNEL) {
        hooks.onChunk(`\n\nPosting to Slack channel \`${process.env.SLACK_CHANNEL}\`...`);
        try {
          await postToSlack(report);
          hooks.onChunk(' Done.');
        } catch (err) {
          hooks.onChunk(` Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      hooks.onFinish();
    } catch (error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },

  getConfig() {
    return {
      systemPrompt:
        'Fetches GitHub issues with all comments, analyses sentiment, detects competitor mentions and workarounds, assigns priority, and posts results to Slack.',
      tools: [],
    };
  },
};

serve(adapter);
