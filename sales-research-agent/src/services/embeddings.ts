import OpenAI from 'openai';

const MODEL = 'text-embedding-3-small';
const MAX_BATCH = 2048;
const MAX_RETRIES = 3;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.embeddings.create({ model: MODEL, input: text });
      return res.data[0].embedding;
    } catch (err: unknown) {
      if (attempt < MAX_RETRIES) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`Embedding failed, retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > MAX_BATCH) {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const batchResults = await generateEmbeddingsBatch(batch);
      results.push(...batchResults);
      if (i + MAX_BATCH < texts.length) await new Promise((r) => setTimeout(r, 100));
    }
    return results;
  }

  const client = getClient();
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.embeddings.create({ model: MODEL, input: texts });
      return res.data.map((d) => d.embedding);
    } catch (err: unknown) {
      if (attempt < MAX_RETRIES) {
        const wait = Math.pow(2, attempt) * 1000 + 5000;
        console.warn(`Batch embedding failed, retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}
