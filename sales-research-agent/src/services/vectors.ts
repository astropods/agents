import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'crypto';

const COLLECTION = 'gong-calls';
const VECTOR_SIZE = 1536; // text-embedding-3-small dimension

function toUuid(id: string): string {
  const hex = createHash('md5').update(id).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

let _client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (_client) return _client;
  const host = process.env.QDRANT_HOST || '127.0.0.1';
  const port = Number(process.env.QDRANT_PORT || 6333);
  _client = new QdrantClient({ host, port });
  return _client;
}

async function ensureCollection(): Promise<void> {
  const client = getClient();
  const { collections } = await client.getCollections();
  if (collections.some((c) => c.name === COLLECTION)) return;
  await client.createCollection(COLLECTION, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
  await client.createPayloadIndex(COLLECTION, {
    field_name: 'call_date_unix',
    field_schema: 'integer',
  });
  await client.createPayloadIndex(COLLECTION, {
    field_name: 'account_name',
    field_schema: 'keyword',
  });
  await client.createPayloadIndex(COLLECTION, {
    field_name: 'call_id',
    field_schema: 'keyword',
  });
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export async function searchVectors(
  queryVector: number[],
  topK: number = 10,
  filter?: Record<string, unknown>,
): Promise<SearchResult[]> {
  await ensureCollection();
  const client = getClient();

  const qdrantFilter = filter ? toQdrantFilter(filter) : undefined;

  const results = await client.search(COLLECTION, {
    vector: queryVector,
    limit: topK,
    with_payload: true,
    filter: qdrantFilter,
  });

  return results.map((r) => ({
    id: typeof r.id === 'string' ? r.id : String(r.id),
    score: r.score,
    metadata: (r.payload || {}) as Record<string, unknown>,
  }));
}

export async function upsertVectors(
  vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[],
  batchSize = 100,
): Promise<number> {
  await ensureCollection();
  const client = getClient();
  let total = 0;

  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    await client.upsert(COLLECTION, {
      wait: true,
      points: batch.map((v) => ({
        id: toUuid(v.id),
        vector: v.values,
        payload: { ...v.metadata, chunk_id: v.id },
      })),
    });
    total += batch.length;
    console.log(`  Upserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} vectors`);
  }
  return total;
}

/**
 * Convert Pinecone-style filters to Qdrant filter format.
 * Supports: exact match, $gte/$lte range, $in array.
 */
function toQdrantFilter(filter: Record<string, unknown>): Record<string, unknown> {
  const must: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (value == null) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;

      if ('$in' in obj) {
        must.push({ key, match: { any: obj.$in } });
        continue;
      }

      const range: Record<string, number> = {};
      if ('$gte' in obj) range.gte = Number(obj.$gte);
      if ('$lte' in obj) range.lte = Number(obj.$lte);
      if (Object.keys(range).length > 0) {
        must.push({ key, range });
      }
    } else {
      must.push({ key, match: { value } });
    }
  }

  return { must };
}
