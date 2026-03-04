/**
 * Redis-backed per-user preferences store.
 *
 * Env vars (auto-injected by Astro when knowledge.preferences is declared):
 *   REDIS_HOST — Redis host (default: localhost)
 *   REDIS_PORT — Redis port (default: 6379)
 */

import Redis from 'ioredis';

export interface UserPreferences {
  defaultProject?: string;
  githubOwner?: string;
  githubRepo?: string;
  selectionCriteria?: string;
  releaseNoteExample?: string;
}

const DEFAULT_PREFS: UserPreferences = {};

const KEY_PREFIX = 'prefs:';

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    client = new Redis({ host, port, lazyConnect: true });
    client.on('error', (err) => console.error('[preferences] Redis error:', err.message));
  }
  return client;
}

export async function loadPreferences(userId: string): Promise<UserPreferences> {
  try {
    const raw = await getClient().get(`${KEY_PREFIX}${userId}`);
    if (!raw) return { ...DEFAULT_PREFS };
    return JSON.parse(raw) as UserPreferences;
  } catch (err) {
    console.error(`[preferences] failed to load for ${userId}:`, err);
    return { ...DEFAULT_PREFS };
  }
}

export async function savePreferences(userId: string, prefs: UserPreferences): Promise<void> {
  try {
    const existing = await loadPreferences(userId);
    const merged = { ...existing, ...prefs };
    await getClient().set(`${KEY_PREFIX}${userId}`, JSON.stringify(merged));
    console.log(`[preferences] saved for ${userId}`);
  } catch (err) {
    console.error(`[preferences] failed to save for ${userId}:`, err);
    throw err;
  }
}
