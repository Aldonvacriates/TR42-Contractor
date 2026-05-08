// db.ts
// SQLite layer backing the offline cache and outbox queue.
// Tables:
//   cache  — read-through cache for GET responses keyed by path
//   outbox — FIFO queue of mutations (POST/PUT/PATCH/DELETE) captured while offline

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'field_force_offline.db';

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);

    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS cache (
        path       TEXT PRIMARY KEY,
        body       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        method     TEXT NOT NULL,
        path       TEXT NOT NULL,
        body       TEXT,
        created_at INTEGER NOT NULL,
        retries    INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox (created_at);
    `);

    _db = db;
    return db;
  })();

  return _initPromise;
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  return openDb();
}

// Wipe everything — used on logout so a new user doesn't inherit queued items
// or stale cache entries from the previous session.
export async function resetDb(): Promise<void> {
  const db = await openDb();
  await db.execAsync(`
    DELETE FROM cache;
    DELETE FROM outbox;
  `);
}
