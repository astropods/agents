import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { Octokit } from '@octokit/rest';
import OpenAI from 'openai';
import { WebClient as SlackClient } from '@slack/web-api';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI();

const MAX_ISSUES = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Priority = 'high' | 'medium' | 'low';
type Sentiment = 'frustration' | 'urgency' | 'neutral' | 'positive';

const VALID_PRIORITIES = new Set<string>(['high', 'medium', 'low']);
const VALID_SENTIMENTS = new Set<string>(['frustration', 'urgency', 'neutral', 'positive']);

interface IssueAnalysis {
  summary: string;
  sentiment: Sentiment;
  sentiment_details: string;
  competitive_mentions: string[];
  workarounds: string[];
  priority: Priority;
  priority_reason: string;
}

interface AnalyzedIssue {
  number: number;
  title: string;
  url: string;
  upvotes: number;
  total_reactions: number;
  comment_count: number;
  analysis: IssueAnalysis;
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

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

function normalizeAnalysis(raw: unknown): IssueAnalysis {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const priority = VALID_PRIORITIES.has(String(obj.priority ?? ''))
    ? (obj.priority as Priority)
    : 'low';
  const sentiment = VALID_SENTIMENTS.has(String(obj.sentiment ?? ''))
    ? (obj.sentiment as Sentiment)
    : 'neutral';
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '(no summary)',
    sentiment,
    sentiment_details: typeof obj.sentiment_details === 'string' ? obj.sentiment_details : '',
    competitive_mentions: Array.isArray(obj.competitive_mentions)
      ? obj.competitive_mentions.filter((x): x is string => typeof x === 'string')
      : [],
    workarounds: Array.isArray(obj.workarounds)
      ? obj.workarounds.filter((x): x is string => typeof x === 'string')
      : [],
    priority,
    priority_reason: typeof obj.priority_reason === 'string' ? obj.priority_reason : '',
  };
}

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

function buildUserMessage(title: string, body: string, comments: string[]): string {
  const commentBlock =
    comments.length > 0
      ? comments.map((c, i) => `[Comment ${i + 1}]\n${c.slice(0, 500)}`).join('\n\n')
      : '(no comments)';
  return [
    `Title: ${title}`,
    '',
    `Body:\n${body.slice(0, 2000) || '(no description)'}`,
    '',
    `Comments (${comments.length} total):\n${commentBlock}`,
  ].join('\n');
}

async function analyzeIssue(title: string, body: string, comments: string[]): Promise<IssueAnalysis> {
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
// Formatting
// ---------------------------------------------------------------------------

function formatIssueReport(issue: AnalyzedIssue): string {
  const { analysis: a } = issue;
  const lines = [
    `#${issue.number} — ${issue.title}`,
    `URL: ${issue.url}`,
    `Reactions: 👍 ${issue.upvotes} upvotes · ${issue.total_reactions} total · ${issue.comment_count} comments`,
    '',
    `Priority  : ${a.priority.toUpperCase()} — ${a.priority_reason}`,
    `Sentiment : ${a.sentiment.toUpperCase()} — ${a.sentiment_details}`,
    '',
    `Summary:\n  ${a.summary}`,
  ];

  if (a.competitive_mentions.length > 0) {
    lines.push(`\nCompetitor/alternative mentions: ${a.competitive_mentions.join(', ')}`);
  }
  if (a.workarounds.length > 0) {
    lines.push(`\nWorkarounds reported:\n${a.workarounds.map(w => `  • ${w}`).join('\n')}`);
  }

  return lines.join('\n');
}

function formatFullReport(issues: AnalyzedIssue[], repoName: string): string {
  const sorted = [...issues].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.analysis.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.analysis.priority] ?? 2;
    return pa - pb;
  });

  const sections = [
    `Issue analysis for \`${repoName}\` — ${issues.length} issue(s)`,
    '='.repeat(70),
    '',
    ...sorted.map(issue => formatIssueReport(issue) + '\n' + '-'.repeat(70)),
  ];

  const totals = { high: 0, medium: 0, low: 0 };
  for (const i of issues) totals[i.analysis.priority]++;
  sections.push(`\nTotals — high: ${totals.high}, medium: ${totals.medium}, low: ${totals.low}`);

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

function splitIntoSlackChunks(text: string, limit = 2900): string[] {
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      if (current) chunks.push(current);
      // If a single line exceeds limit, hard-split it
      if (line.length > limit) {
        for (let i = 0; i < line.length; i += limit) {
          chunks.push(line.slice(i, i + limit));
        }
        current = '';
      } else {
        current = line;
      }
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

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
