import { serve } from '@astropods/adapter-core';
import { MastraAdapter } from '@astropods/adapter-mastra';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';
import OpenAI from 'openai';
import {
  extractVideoId,
  buildBatchUserMessage,
  parseJsonSentiments,
  formatReport,
} from './utils';
import type { Sentiment, SentimentResult } from './utils';

const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
const openai = new OpenAI();

// ---------------------------------------------------------------------------
// YouTube helpers
// ---------------------------------------------------------------------------

async function fetchComments(videoId: string, maxComments: number): Promise<string[]> {
  const comments: string[] = [];
  let pageToken: string | undefined;

  while (comments.length < maxComments) {
    const response = await youtube.commentThreads.list({
      part: ['snippet'],
      videoId,
      maxResults: Math.min(100, maxComments - comments.length),
      pageToken,
      textFormat: 'plainText',
      order: 'relevance',
    });

    for (const item of response.data.items ?? []) {
      const text = item.snippet?.topLevelComment?.snippet?.textDisplay;
      if (text) comments.push(text);
      if (comments.length >= maxComments) break;
    }

    pageToken = response.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return comments;
}

// ---------------------------------------------------------------------------
// Sentiment analysis — batched to minimise OpenAI calls
// ---------------------------------------------------------------------------

const SENTIMENT_SYSTEM_PROMPT = [
  'Classify the sentiment of each comment.',
  'Return JSON: { "sentiments": ["positive"|"neutral"|"negative", ...] }',
  'The array must have exactly the same length as the input.',
  'positive — praise, excitement, appreciation, satisfaction',
  'negative — criticism, frustration, disappointment, hostility',
  'neutral  — questions, plain statements, mixed, or off-topic',
].join('\n');

async function analyzeBatch(comments: string[]): Promise<Sentiment[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
      { role: 'user', content: buildBatchUserMessage(comments) },
    ],
  });
  const raw = response.choices[0].message.content ?? '';
  return parseJsonSentiments(raw);
}

async function analyzeAllComments(comments: string[]): Promise<SentimentResult[]> {
  const BATCH_SIZE = 30;
  const results: SentimentResult[] = [];

  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    const batch = comments.slice(i, i + BATCH_SIZE);
    const sentiments = await analyzeBatch(batch);
    for (let j = 0; j < batch.length; j++) {
      results.push({ comment: batch[j], sentiment: sentiments[j] ?? 'neutral' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Mastra tool
// ---------------------------------------------------------------------------

const analyzeYoutubeComments = createTool({
  id: 'analyze_youtube_comments',
  description:
    'Fetch YouTube video comments and classify each as positive, neutral, or negative. ' +
    'Call this whenever the user provides a YouTube video URL or ID.',
  inputSchema: z.object({
    video_url_or_id: z
      .string()
      .describe('YouTube video URL (any format) or bare 11-character video ID'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Max comments to fetch (default 100)'),
  }),
  execute: async ({ video_url_or_id, limit = 100 }: { video_url_or_id: string; limit?: number }) => {
    const videoId = extractVideoId(video_url_or_id);
    if (!videoId) {
      return (
        'Could not extract a video ID from the input. Please provide a YouTube URL or an 11-character video ID.'
      );
    }

    const comments = await fetchComments(videoId, limit);
    if (comments.length === 0) {
      return 'No comments found — comments may be disabled for this video.';
    }

    const results = await analyzeAllComments(comments);
    return formatReport(results, videoId);
  },
});

// ---------------------------------------------------------------------------
// Mastra agent
// ---------------------------------------------------------------------------

const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory', url: ':memory:' }),
});

const agent = new Agent({
  id: 'youtube-comment-analyzer',
  name: 'YouTube Comment Analyzer',
  instructions: `You are a YouTube comment sentiment analyzer. When a user provides a YouTube video URL or ID, call the analyze_youtube_comments tool with the full URL or ID. Return the tool output verbatim without reformatting.

Supported input formats:
- https://www.youtube.com/watch?v=VIDEO_ID
- https://youtu.be/VIDEO_ID
- https://www.youtube.com/shorts/VIDEO_ID
- VIDEO_ID (bare 11-character ID)
- VIDEO_ID 200 (with optional comment limit)`,
  model: 'openai/gpt-4o-mini',
  memory,
  tools: { analyze_youtube_comments: analyzeYoutubeComments },
});

new Mastra({ agents: { 'youtube-comment-analyzer': agent } });

serve(new MastraAdapter(agent));
