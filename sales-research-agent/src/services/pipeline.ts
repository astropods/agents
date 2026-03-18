import { getAllCallsExtensive, getTranscript, type GongCall, type Transcript } from './gong';
import { chunkTranscript, type Chunk } from './chunker';
import { generateEmbeddingsBatch } from './embeddings';
import { upsertVectors } from './vectors';
import * as fs from 'fs';
import * as path from 'path';

const CHECKPOINT_DIR = 'data';
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, 'ingestion_checkpoint.json');
const MIN_CALL_DURATION_MINUTES = 5;
const MIN_TRANSCRIPT_WORDS = 50;
const BATCH_SIZE = 10;

interface Stats {
  callsDiscovered: number;
  callsProcessed: number;
  callsFailed: number;
  callsSkipped: number;
  chunksCreated: number;
  chunksUploaded: number;
}

function loadProcessedCalls(): Set<string> {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
      return new Set(data.processed_calls || []);
    }
  } catch (err) {
    console.warn('Failed to load checkpoint:', err);
  }
  return new Set();
}

function saveCheckpoint(processedCalls: Set<string>, stats: Stats) {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    const data = {
      processed_calls: [...processedCalls],
      timestamp: new Date().toISOString(),
      stats,
    };
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save checkpoint:', err);
  }
}

function toVectorMetadata(chunk: Chunk): Record<string, unknown> {
  const callDateUnix = Math.floor(new Date(chunk.callDate).getTime() / 1000);
  const meta: Record<string, unknown> = {
    call_id: chunk.callId,
    text: chunk.text,
    speaker: chunk.speaker,
    timestamp: chunk.timestamp,
    chunk_start_time: chunk.chunkStartTime,
    account_name: chunk.accountName,
    call_title: chunk.callTitle,
    call_date: chunk.callDate,
    call_date_unix: callDateUnix,
    chunk_index: chunk.chunkIndex,
    total_chunks: chunk.totalChunks,
    token_count: chunk.tokenCount,
    contains_speaker_transition: chunk.containsSpeakerTransition,
    duration_seconds: chunk.durationSeconds,
  };

  if (chunk.participants) {
    const names: string[] = [];
    const emails: string[] = [];
    const titles: string[] = [];
    const external: string[] = [];
    const internal: string[] = [];
    const companies = new Set<string>();

    for (const p of chunk.participants) {
      if (p.name) names.push(p.name);
      if (p.emailAddress) {
        emails.push(p.emailAddress);
        if (p.emailAddress.includes('@') && !['gmail.com', 'outlook.com', 'yahoo.com'].some((d) => p.emailAddress.includes(d))) {
          companies.add(p.emailAddress.split('@')[1]);
        }
      }
      if (p.title) titles.push(p.title);
      if (p.affiliation === 'External') external.push(p.name || 'Unknown');
      else if (p.affiliation === 'Internal') internal.push(p.name || 'Unknown');
    }

    meta.participant_names = names;
    meta.participant_emails = emails;
    meta.participant_titles = titles;
    meta.external_participants = external;
    meta.internal_participants = internal;
    meta.participant_companies = [...companies];
    meta.participant_count = chunk.participants.length;
    meta.participants_json = JSON.stringify(chunk.participants);
  }

  return meta;
}

async function processCallBatch(
  calls: GongCall[],
  processedCalls: Set<string>,
  stats: Stats,
): Promise<void> {
  const allChunks: Chunk[] = [];

  for (const call of calls) {
    try {
      if (processedCalls.has(call.callId)) {
        stats.callsSkipped++;
        continue;
      }
      if (call.durationSeconds < MIN_CALL_DURATION_MINUTES * 60) {
        stats.callsSkipped++;
        continue;
      }

      console.log(`  Processing call ${call.callId}: ${call.title.slice(0, 60)}...`);
      let transcript: Transcript;
      try {
        transcript = await getTranscript(call.callId);
      } catch (err) {
        console.error(`  Failed to fetch transcript for ${call.callId}:`, err);
        stats.callsFailed++;
        continue;
      }

      const totalWords = transcript.utterances.reduce((s, u) => s + u.text.split(/\s+/).length, 0);
      if (totalWords < MIN_TRANSCRIPT_WORDS) {
        console.log(`  Skipping short transcript (${totalWords} words) for ${call.callId}`);
        stats.callsSkipped++;
        continue;
      }

      const chunks = chunkTranscript(transcript, call);
      if (chunks.length === 0) {
        stats.callsSkipped++;
        continue;
      }

      allChunks.push(...chunks);
      processedCalls.add(call.callId);
      stats.callsProcessed++;
      stats.chunksCreated += chunks.length;
    } catch (err) {
      console.error(`  Failed to process call ${call.callId}:`, err);
      stats.callsFailed++;
    }
  }

  if (allChunks.length === 0) return;

  console.log(`  Generating embeddings for ${allChunks.length} chunks...`);
  const texts = allChunks.map((c) => c.text);
  const embeddings = await generateEmbeddingsBatch(texts);

  const vectors = allChunks.map((chunk, i) => ({
    id: chunk.chunkId,
    values: embeddings[i],
    metadata: toVectorMetadata(chunk),
  }));

  console.log(`  Upserting ${vectors.length} vectors...`);
  const upserted = await upsertVectors(vectors);
  stats.chunksUploaded += upserted;
}

export async function runPipeline(startDate: string, endDate: string, maxCalls?: number): Promise<Stats> {
  const stats: Stats = {
    callsDiscovered: 0,
    callsProcessed: 0,
    callsFailed: 0,
    callsSkipped: 0,
    chunksCreated: 0,
    chunksUploaded: 0,
  };

  const processedCalls = loadProcessedCalls();
  if (processedCalls.size > 0) {
    console.log(`  Loaded checkpoint: ${processedCalls.size} previously processed calls`);
  }

  console.log('='.repeat(60));
  console.log('Sales Research Agent — Gong Ingestion Pipeline');
  console.log('='.repeat(60));
  console.log(`  Date range: ${startDate} to ${endDate}`);
  if (maxCalls) console.log(`  Max calls:  ${maxCalls}`);
  console.log('');

  console.log('Step 1/4: Discovering calls via Gong extensive API...');
  const fromDate = new Date(startDate);
  const toDate = new Date(endDate);
  const callBatch: GongCall[] = [];
  let batchNum = 0;
  const startTime = Date.now();
  let hitCap = false;

  for await (const call of getAllCallsExtensive(fromDate, toDate)) {
    stats.callsDiscovered++;
    callBatch.push(call);

    if (maxCalls && stats.callsProcessed + callBatch.length >= maxCalls) {
      const remaining = maxCalls - stats.callsProcessed;
      if (remaining > 0) {
        batchNum++;
        console.log(`\nStep 2-3/4: Processing final batch ${batchNum} (capped at ${remaining} calls)...`);
        await processCallBatch(callBatch.slice(0, remaining), processedCalls, stats);
        saveCheckpoint(processedCalls, stats);
      }
      hitCap = true;
      break;
    }

    if (stats.callsDiscovered % 100 === 0) {
      console.log(`  Discovered ${stats.callsDiscovered} calls so far...`);
    }

    if (callBatch.length >= BATCH_SIZE) {
      batchNum++;
      console.log(`\nStep 2-3/4: Processing batch ${batchNum} (${callBatch.length} calls)...`);
      await processCallBatch(callBatch, processedCalls, stats);
      saveCheckpoint(processedCalls, stats);
      console.log(`  Progress: ${stats.callsProcessed} processed, ${stats.chunksUploaded} chunks uploaded`);
      callBatch.length = 0;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (!hitCap && callBatch.length > 0) {
    batchNum++;
    console.log(`\nStep 2-3/4: Processing final batch ${batchNum} (${callBatch.length} calls)...`);
    await processCallBatch(callBatch, processedCalls, stats);
    saveCheckpoint(processedCalls, stats);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(60));
  console.log('Step 4/4: Ingestion Complete!');
  console.log('='.repeat(60));
  console.log(`  Calls discovered:  ${stats.callsDiscovered}`);
  console.log(`  Calls processed:   ${stats.callsProcessed}`);
  console.log(`  Calls skipped:     ${stats.callsSkipped}`);
  console.log(`  Calls failed:      ${stats.callsFailed}`);
  console.log(`  Chunks created:    ${stats.chunksCreated}`);
  console.log(`  Chunks uploaded:   ${stats.chunksUploaded}`);
  console.log(`  Duration:          ${elapsed}s`);
  console.log('='.repeat(60));

  return stats;
}
