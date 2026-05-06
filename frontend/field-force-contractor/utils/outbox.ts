// outbox.ts
// FIFO queue of mutations captured while offline. Each item records the HTTP
// method, path, and JSON body. When the network returns, drainOutbox() replays
// entries in creation order. Ordering matters for things like drive-time
// status changes where the sequence of events is part of the record.

import { getDb } from './db';

export type OutboxMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OutboxItem {
  id:        number;
  method:    OutboxMethod;
  path:      string;
  body:      string | null;
  createdAt: number;
  retries:   number;
  lastError: string | null;
}

export async function enqueue(
  method: OutboxMethod,
  path:   string,
  body:   unknown,
): Promise<number> {
  const db  = await getDb();
  const now = Date.now();
  const serialized = body === undefined ? null : JSON.stringify(body);
  const result = await db.runAsync(
    `INSERT INTO outbox (method, path, body, created_at, retries, last_error)
     VALUES (?, ?, ?, ?, 0, NULL)`,
    [method, path, serialized, now],
  );
  return result.lastInsertRowId as number;
}

export async function peekAll(): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number; method: string; path: string; body: string | null;
    created_at: number; retries: number; last_error: string | null;
  }>('SELECT * FROM outbox ORDER BY created_at ASC, id ASC');

  return rows.map(r => ({
    id:        r.id,
    method:    r.method as OutboxMethod,
    path:      r.path,
    body:      r.body,
    createdAt: r.created_at,
    retries:   r.retries,
    lastError: r.last_error,
  }));
}

export async function pendingCount(): Promise<number> {
  const db  = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return row?.n ?? 0;
}

export async function removeItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
}

export async function markFailure(id: number, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE outbox SET retries = retries + 1, last_error = ? WHERE id = ?',
    [error, id],
  );
}

export async function clearOutbox(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox');
}

// ── Drain ────────────────────────────────────────────────────────────────────
// Replay queued items against a sender function (normally a bare fetch that
// bypasses the offline wrapper so we don't re-enqueue). Stops on the first
// network error to preserve ordering; permanent (4xx) failures are dropped
// after MAX_RETRIES so one bad record can't block the queue forever.

const MAX_RETRIES = 5;

export type OutboxSender = (item: OutboxItem) => Promise<{
  ok:       boolean;
  status:   number;
  // true when the error is transient (network) and the item should remain
  // queued; false for permanent (4xx) failures that will never succeed.
  transient: boolean;
  error?:   string;
}>;

export interface DrainResult {
  drained: number;
  failed:  number;
  stopped: boolean;
}

let _draining = false;

export async function drainOutbox(sender: OutboxSender): Promise<DrainResult> {
  if (_draining) return { drained: 0, failed: 0, stopped: true };
  _draining = true;

  let drained = 0;
  let failed  = 0;
  let stopped = false;

  try {
    const items = await peekAll();
    for (const item of items) {
      let result;
      try {
        result = await sender(item);
      } catch (err) {
        result = {
          ok: false,
          status: 0,
          transient: true,
          error: (err as Error)?.message ?? 'send failed',
        };
      }

      if (result.ok) {
        await removeItem(item.id);
        drained += 1;
        continue;
      }

      if (result.transient) {
        // Network hiccup — bail out and try again on next drain.
        await markFailure(item.id, result.error ?? `status ${result.status}`);
        stopped = true;
        break;
      }

      // Permanent failure (e.g. 400 validation error). Bump retries, drop
      // after MAX_RETRIES so a bad row can't wedge the queue.
      await markFailure(item.id, result.error ?? `status ${result.status}`);
      if (item.retries + 1 >= MAX_RETRIES) {
        await removeItem(item.id);
        failed += 1;
      }
    }
  } finally {
    _draining = false;
  }

  return { drained, failed, stopped };
}
