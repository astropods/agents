---
description: "Classifies YouTube comments by sentiment and flags unreplied ones, helping creators triage audience feedback fast."
tags:
  - youtube
  - sentiment-analysis
  - comments
  - content-creators
  - openai
  - product-management
capabilities:
  - "Fetch up to 500 YouTube comments with automatic pagination"
  - "Classify each comment as positive, neutral, or negative using GPT-4o mini"
  - "Process comments in batches of 30 to minimise API calls"
  - "Return a summary with counts, percentages, and representative examples"
  - "Flag unreplied top-level comments to prioritise creator responses"
  - "Accept any YouTube URL format or bare video ID"
repository:
  type: github
  url: https://github.com/astropods/agents
  directory: youtube-comment-analyzer
integrations:
  - OpenAI
---

# YouTube Comment Analyzer

You just published a video and the comments are piling up. YouTube Comment Analyzer reads them all — fetching in bulk, processing in batches — and tells you exactly how your audience feels: what percentage loved it, what frustrated them, which comments best represent each camp, and crucially, which ones haven't been replied to yet so you know where to engage first.

## Usage

Send a message with a YouTube video URL or ID:

| Message | Effect |
|---------|--------|
| `https://www.youtube.com/watch?v=VIDEO_ID` | Analyse top 100 comments |
| `https://youtu.be/VIDEO_ID` | Analyse top 100 comments |
| `https://www.youtube.com/shorts/VIDEO_ID` | Analyse top 100 comments |
| `VIDEO_ID` | Bare 11-character ID |
| `VIDEO_ID 200` | Analyse up to 200 comments |

**Examples:**
- *"https://youtu.be/dQw4w9WgXcQ"* — analyse the top 100 comments
- *"dQw4w9WgXcQ 300"* — go deeper with 300 comments

## What the report includes

- **Counts and percentages** — positive / neutral / negative breakdown across all analysed comments
- **Representative examples** — up to 3 real comments shown per sentiment category
- **Needs reply** — up to 5 unreplied top-level comments flagged for creator follow-up
- **Total analysed** — exact count of comments fetched and classified

## Sentiment definitions

| Sentiment | Criteria |
|-----------|----------|
| `positive` | Praise, excitement, appreciation, satisfaction |
| `neutral` | Questions, plain statements, mixed reactions, off-topic |
| `negative` | Criticism, frustration, disappointment, hostility |

## Environment variables

| Variable | Description |
|----------|-------------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key — configured at deploy time |
| `OPENAI_API_KEY` | Auto-injected by Astropods |

## Limitations

- Fetches top-level comments only; reply content is not analysed, only whether a reply exists.
- Comments are sorted by relevance (YouTube default); chronological ordering is not supported.
- Comment text is truncated at 300 characters per comment before sending to OpenAI.
- Videos with disabled comments will return no results.
- YouTube Data API v3 quota applies — high comment limits may consume significant quota.
- The full report is returned once all comments are processed; per-batch progress is not streamed.
