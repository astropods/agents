import type { Utterance, Transcript, GongCall } from './gong';

export interface Chunk {
  chunkId: string;
  callId: string;
  text: string;
  speaker: string;
  timestamp: string;
  chunkStartTime: string;
  accountName: string;
  callTitle: string;
  callDate: string;
  chunkIndex: number;
  totalChunks: number;
  tokenCount: number;
  containsSpeakerTransition: boolean;
  durationSeconds: number;
  participants: GongCall['participants'];
}

const TARGET_TOKENS = 600;
const MAX_TOKENS = 800;
const OVERLAP_TOKENS = 75;

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function formatChunkStartTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function formatCallDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPrimarySpeaker(utterances: Utterance[]): string {
  const bySpeaker = new Map<string, number>();
  for (const u of utterances) {
    const dur = u.endTime - u.startTime;
    bySpeaker.set(u.speaker, (bySpeaker.get(u.speaker) ?? 0) + dur);
  }
  let best = 'Unknown';
  let maxDur = 0;
  for (const [speaker, dur] of bySpeaker) {
    if (dur > maxDur) {
      maxDur = dur;
      best = speaker;
    }
  }
  return best;
}

function hasSpeakerTransition(utterances: Utterance[]): boolean {
  if (utterances.length < 2) return false;
  const first = utterances[0].speaker;
  for (let i = 1; i < utterances.length; i++) {
    if (utterances[i].speaker !== first) return true;
  }
  return false;
}


export function chunkTranscript(transcript: Transcript, call: GongCall): Chunk[] {
  const { callId, utterances } = transcript;
  const accountName = call.accountName ?? 'Unknown';
  const callTitle = call.title ?? '';
  const callDate = formatCallDate(call.startTime);
  const participants = call.participants;

  if (utterances.length === 0) return [];

  const chunks: Chunk[] = [];
  let currentUtts: Utterance[] = [];
  let currentTokens = 0;

  function flushChunk() {
    if (currentUtts.length === 0) return;

    const text = currentUtts.map((u) => u.text).join(' ');
    const tokenCount = estimateTokens(text);
    const firstUtt = currentUtts[0];
    const lastUtt = currentUtts[currentUtts.length - 1];
    const startSeconds = firstUtt.startTime;
    const durationSeconds = lastUtt.endTime - startSeconds;
    const paddedIdx = String(chunks.length).padStart(3, '0');

    chunks.push({
      chunkId: `${callId}_chunk_${paddedIdx}`,
      callId,
      text,
      speaker: getPrimarySpeaker(currentUtts),
      timestamp: call.startTime.toISOString(),
      chunkStartTime: formatChunkStartTime(startSeconds),
      accountName,
      callTitle,
      callDate,
      chunkIndex: chunks.length,
      totalChunks: 0,
      tokenCount,
      containsSpeakerTransition: hasSpeakerTransition(currentUtts),
      durationSeconds,
      participants,
    });

    const overlap = getOverlapUtterances(currentUtts, OVERLAP_TOKENS);
    currentUtts = [...overlap];
    currentTokens = currentUtts.reduce((s, u) => s + estimateTokens(u.text), 0);
  }

  for (const utt of utterances) {
    const uttTokens = estimateTokens(utt.text);

    if (currentTokens + uttTokens > MAX_TOKENS && currentUtts.length > 0) {
      flushChunk();
    }

    currentUtts.push(utt);
    currentTokens += uttTokens;

    if (currentTokens >= TARGET_TOKENS && currentUtts.length >= 2) {
      flushChunk();
    }
  }

  flushChunk();

  for (const c of chunks) c.totalChunks = chunks.length;
  console.log(`  Chunked call ${callId}: ${chunks.length} chunks`);
  return chunks;
}

function getOverlapUtterances(utterances: Utterance[], maxTokens: number): Utterance[] {
  const overlap: Utterance[] = [];
  let tokens = 0;
  for (let i = utterances.length - 1; i >= 0; i--) {
    const t = estimateTokens(utterances[i].text);
    if (tokens + t > maxTokens) break;
    overlap.unshift(utterances[i]);
    tokens += t;
  }
  return overlap;
}
