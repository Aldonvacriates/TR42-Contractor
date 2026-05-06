// cache.ts
// Read-through cache for GET responses. Callers look up a cached body by path,
// and writers persist fresh responses after a successful network fetch.
// Only paths passed through api.authGet/api.authCachedGet end up here, so the
// store only holds data we intentionally want available offline.

import { getDb } from './db';

export interface CachedEntry<T = unknown> {
  body:      T;
  updatedAt: number;
}

export async function readCache<T = unknown>(path: string): Promise<CachedEntry<T> | null> {
  const db  = await getDb();
  const row = await db.getFirstAsync<{ body: string; updated_at: number }>(
    'SELECT body, updated_at FROM cache WHERE path = ?',
    [path],
  );
  if (!row) return null;

  try {
    return { body: JSON.parse(row.body) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function writeCache(path: string, body: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO cache (path, body, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    [path, JSON.stringify(body), Date.now()],
  );
}

export async function clearCache(path?: string): Promise<void> {
  const db = await getDb();
  if (path) {
    await db.runAsync('DELETE FROM cache WHERE path = ?', [path]);
  } else {
    await db.runAsync('DELETE FROM cache');
  }
}
