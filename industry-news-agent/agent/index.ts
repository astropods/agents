import { serve } from '@astropods/adapter-core';
import { MastraAdapter } from '@astropods/adapter-mastra';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import OpenAI from 'openai';
import { deduplicate, detectFormat } from './utils';
import type { Article, OutputFormat } from './utils';

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Source fetchers
// ---------------------------------------------------------------------------

async function fetchNewsAPI(topic: string): Promise<Article[]> {
  const { data } = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: topic,
      apiKey: process.env.NEWS_API_KEY,
      pageSize: 10,
      sortBy: 'publishedAt',
      language: 'en',
    },
  });
  return (data.articles ?? []).map((a: Record<string, any>) => ({
    title: a.title,
    url: a.url,
    source: `NewsAPI / ${a.source?.name ?? 'unknown'}`,
    publishedAt: a.publishedAt,
    description: a.description,
  }));
}

async function fetchGNews(topic: string): Promise<Article[]> {
  const { data } = await axios.get('https://gnews.io/api/v4/search', {
    params: {
      q: topic,
      token: process.env.GNEWS_API_KEY,
      max: 10,
      lang: 'en',
    },
  });
  return (data.articles ?? []).map((a: Record<string, any>) => ({
    title: a.title,
    url: a.url,
    source: `GNews / ${a.source?.name ?? 'unknown'}`,
    publishedAt: a.publishedAt,
    description: a.description,
  }));
}

async function fetchGuardian(topic: string): Promise<Article[]> {
  const { data } = await axios.get('https://content.guardianapis.com/search', {
    params: {
      q: topic,
      'api-key': process.env.GUARDIAN_API_KEY,
      'show-fields': 'headline,trailText',
      'page-size': 10,
      'order-by': 'newest',
    },
  });
  return (data.response?.results ?? []).map((a: Record<string, any>) => ({
    title: a.fields?.headline ?? a.webTitle,
    url: a.webUrl,
    source: 'The Guardian',
    publishedAt: a.webPublicationDate,
    description: a.fields?.trailText,
  }));
}

async function fetchMediaStack(topic: string): Promise<Article[]> {
  const { data } = await axios.get('http://api.mediastack.com/v1/news', {
    params: {
      keywords: topic,
      access_key: process.env.MEDIASTACK_API_KEY,
      limit: 10,
      languages: 'en',
      sort: 'published_desc',
    },
  });
  return (data.data ?? []).map((a: Record<string, any>) => ({
    title: a.title,
    url: a.url,
    source: `MediaStack / ${a.source ?? 'unknown'}`,
    publishedAt: a.published_at,
    description: a.description,
  }));
}

// ---------------------------------------------------------------------------
// Parallel fetch + dedup
// ---------------------------------------------------------------------------

const SOURCES: [string, (topic: string) => Promise<Article[]>][] = [
  ['NewsAPI', fetchNewsAPI],
  ['GNews', fetchGNews],
  ['The Guardian', fetchGuardian],
  ['MediaStack', fetchMediaStack],
];

async function fetchAll(topic: string): Promise<Article[]> {
  const results = await Promise.allSettled(SOURCES.map(([, fn]) => fn(topic)));
  const all: Article[] = [];

  for (let i = 0; i < results.length; i++) {
    const [name] = SOURCES[i];
    const result = results[i];
    if (result.status === 'fulfilled') {
      all.push(...result.value);
    } else {
      const msg = result.reason?.response?.data?.message ?? result.reason?.message ?? 'unknown error';
      console.error(`[${name}] fetch failed: ${msg}`);
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Format prompts + summary
// ---------------------------------------------------------------------------

const FORMAT_PROMPTS: Record<OutputFormat, string> = {
  summary: [
    'You are an industry analyst. Summarise the news into a concise briefing.',
    'Structure:',
    'KEY THEMES — 3 bullet points of the main trends',
    'TOP STORIES — the 3-5 most important articles, 1-sentence summary each with source and URL',
    'TAKEAWAY — 1 short paragraph with the overall picture',
  ].join('\n'),
  analysis: [
    'You are an industry analyst. Provide a deep analytical breakdown of the news.',
    'Structure:',
    'MARKET SIGNALS — 3-5 bullet points on what the news signals for the industry',
    'KEY PLAYERS — companies or people driving the narrative',
    'RISKS & OPPORTUNITIES — 2-3 points each',
    'ANALYST VERDICT — 1 paragraph conclusion with forward-looking perspective',
  ].join('\n'),
  'key insights': [
    'You are an industry analyst. Extract only the most actionable key insights.',
    'Structure:',
    'TOP INSIGHTS — 5-7 concise bullet points, each starting with an action verb',
    'WHAT TO WATCH — 2-3 trends or developments worth monitoring',
    'Be direct and specific. No fluff.',
  ].join('\n'),
};

async function summarize(topic: string, articles: Article[], format: OutputFormat): Promise<string> {
  const list = articles
    .slice(0, 20)
    .map(
      (a, i) =>
        `${i + 1}. [${a.source}] ${a.title}\n` +
        `   ${a.description?.slice(0, 200) ?? 'No description'}\n` +
        `   ${a.url}`,
    )
    .join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: FORMAT_PROMPTS[format] },
      { role: 'user', content: `Topic: "${topic}"\n\nArticles:\n\n${list}` },
    ],
  });

  return response.choices[0].message.content ?? '';
}

// ---------------------------------------------------------------------------
// Mastra tool
// ---------------------------------------------------------------------------

const fetchIndustryNews = createTool({
  id: 'fetch_industry_news',
  description:
    'Fetch and summarise industry news from NewsAPI, GNews, The Guardian, and MediaStack. ' +
    'Call this for any news topic. Append "analysis" or "key insights" to the query to change output format.',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'User query including topic and optional format keyword, e.g. "AI news", ' +
        '"startup funding analysis", "fintech key insights"',
      ),
  }),
  execute: async ({ query }: { query: string }) => {
    const { topic, format } = detectFormat(query);
    const raw = await fetchAll(topic);
    const articles = deduplicate(raw);

    if (articles.length === 0) {
      return 'No articles found for this topic. Try a broader search term.';
    }

    return summarize(topic, articles, format);
  },
});

// ---------------------------------------------------------------------------
// Mastra agent
// ---------------------------------------------------------------------------

const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory', url: ':memory:' }),
});

const agent = new Agent({
  id: 'industry-news-agent',
  name: 'Industry News Agent',
  instructions: `You are an industry news analyst. When a user provides a topic, pass their full query to the fetch_industry_news tool and return the result verbatim.

The tool automatically detects output format from keywords in the query:
- "AI news" → summary (default)
- "startup funding analysis" → deep analytical breakdown
- "fintech key insights" → actionable bullet points

Use conversation history to resolve ambiguous follow-ups. If the user says "give me analysis on that" after asking about "AI funding", call fetch_industry_news with "AI funding analysis". If they say "now key insights", reuse the last topic with the new format keyword.`,
  model: 'openai/gpt-4o-mini',
  memory,
  tools: { fetch_industry_news: fetchIndustryNews },
});

new Mastra({ agents: { 'industry-news-agent': agent } });

serve(new MastraAdapter(agent));
