// photoOutbox.ts
// FIFO queue of pending photo uploads captured while offline. Multipart
// uploads can't ride on the JSON outbox so they get their own SQLite table
// and drain function.
//
// Durability: ImagePicker writes to the OS cache dir, which can be cleared
// at any time. On enqueue we copy the file to documentDirectory/pending_photos/
// so it survives cache eviction and app restarts. The copy is deleted only
// after a successful upload (or after MAX_RETRIES permanent failures).

import { getDb } from './db';
import { API_BASE_URL } from './api';
import { getToken } from './secureStorage';
import * as FileSystem from 'expo-file-system/legacy';

const PENDING_DIR =
  (FileSystem.documentDirectory ?? '') + 'pending_photos/';

async function ensurePendingDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PENDING_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true });
  }
}

async function copyToPendingDir(srcUri: string, submissionUuid: string): Promise<string> {
  await ensurePendingDir();
  // Preserve a sensible extension if the source has one; default to .jpg.
  const ext  = (srcUri.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
  const dest = `${PENDING_DIR}${submissionUuid}.${ext}`;
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  return dest;
}

async function deletePendingFile(uri: string): Promise<void> {
  // Only touch files inside our pending dir — never delete arbitrary URIs.
  if (!uri.startsWith(PENDING_DIR)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup; ignore failures so a missing file doesn't block drain.
  }
}

export async function purgePendingPhotosDir(): Promise<void> {
  // Used on logout/reset. Wipes every queued photo file regardless of whether
  // SQLite still has a row pointing at it.
  try {
    const info = await FileSystem.getInfoAsync(PENDING_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(PENDING_DIR, { idempotent: true });
    }
  } catch {
    // Best-effort.
  }
}

export interface PhotoOutboxItem {
  id:             number;
  ticketId:       string;
  fileUri:        string;
  submissionUuid: string;
  latitude:       number | null;
  longitude:      number | null;
  createdAt:      number;
  retries:        number;
  lastError:      string | null;
}

function newSubmissionUuid(): string {
  // Lightweight UUID-ish identifier; we don't need cryptographic randomness
  // here, just uniqueness for idempotent retries against the backend.
  const rand = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rand()}-${rand()}-${rand()}`;
}

export async function enqueuePhoto(args: {
  ticketId:  string | number;
  fileUri:   string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<{ id: number; submissionUuid: string }> {
  const submissionUuid = newSubmissionUuid();
  // Copy out of the OS cache dir before recording the row, so we never have
  // a SQLite entry pointing at a file we don't own.
  const persistedUri = await copyToPendingDir(args.fileUri, submissionUuid);

  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO photo_outbox (ticket_id, file_uri, submission_uuid, latitude, longitude, created_at, retries, last_error)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    [
      String(args.ticketId),
      persistedUri,
      submissionUuid,
      args.latitude ?? null,
      args.longitude ?? null,
      Date.now(),
    ],
  );
  return { id: result.lastInsertRowId as number, submissionUuid };
}

export async function peekAllPhotos(): Promise<PhotoOutboxItem[]> {
  const db   = await getDb();
  const rows = await db.getAllAsync<{
    id: number; ticket_id: string; file_uri: string; submission_uuid: string;
    latitude: number | null; longitude: number | null;
    created_at: number; retries: number; last_error: string | null;
  }>('SELECT * FROM photo_outbox ORDER BY created_at ASC, id ASC');

  return rows.map(r => ({
    id:             r.id,
    ticketId:       r.ticket_id,
    fileUri:        r.file_uri,
    submissionUuid: r.submission_uuid,
    latitude:       r.latitude,
    longitude:      r.longitude,
    createdAt:      r.created_at,
    retries:        r.retries,
    lastError:      r.last_error,
  }));
}

export async function pendingPhotoCount(): Promise<number> {
  const db  = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM photo_outbox');
  return row?.n ?? 0;
}

async function removePhoto(id: number): Promise<void> {
  const db  = await getDb();
  // Look up the file URI before deleting the row so we can clean up the disk
  // copy. Best-effort: missing rows / files are silently ignored.
  const row = await db.getFirstAsync<{ file_uri: string }>(
    'SELECT file_uri FROM photo_outbox WHERE id = ?',
    [id],
  );
  await db.runAsync('DELETE FROM photo_outbox WHERE id = ?', [id]);
  if (row?.file_uri) await deletePendingFile(row.file_uri);
}

async function markPhotoFailure(id: number, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE photo_outbox SET retries = retries + 1, last_error = ? WHERE id = ?',
    [error, id],
  );
}

// ── Single send ──────────────────────────────────────────────────────────────

interface SendResult {
  ok:        boolean;
  status:    number;
  transient: boolean;
  error?:    string;
  /** Server-assigned photo id, present only on a successful upload. Used by
   *  the inline-analyze flow so the caller can immediately POST the id back
   *  to /api/ai/analyze-photo without re-listing the ticket's photo set. */
  photoId?:  string;
}

async function sendOne(item: PhotoOutboxItem): Promise<SendResult> {
  const token = await getToken();
  const form  = new FormData();
  form.append('ticket_id', item.ticketId);
  form.append('submission_uuid', item.submissionUuid);
  if (item.latitude  !== null) form.append('latitude',  String(item.latitude));
  if (item.longitude !== null) form.append('longitude', String(item.longitude));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form.append('photo', { uri: item.fileUri, name: `photo-${item.id}.jpg`, type: 'image/jpeg' } as any);

  try {
    const res = await fetch(`${API_BASE_URL}/api/photos`, {
      method: 'POST',
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'ngrok-skip-browser-warning': 'true',
      },
      body: form,
    });
    let photoId: string | undefined;
    if (res.ok) {
      try {
        const body = await res.json();
        if (body && typeof body.id === 'string') photoId = body.id;
      } catch {
        // Non-JSON or parse failure — leave photoId undefined so callers
        // that don't need it (the regular outbox drain) carry on as before.
      }
    }
    return {
      ok:        res.ok,
      status:    res.status,
      // 4xx are permanent (validation, auth). 5xx and unknown are transient.
      transient: !(res.status >= 400 && res.status < 500),
      error:     res.ok ? undefined : `HTTP ${res.status}`,
      photoId,
    };
  } catch (err) {
    return {
      ok:        false,
      status:    0,
      transient: true,
      error:     (err as Error)?.message ?? 'network failure',
    };
  }
}

// ── Drain ────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;

export interface PhotoDrainResult {
  drained: number;
  failed:  number;
  stopped: boolean;
  /** Outbox-row-id -> server photo id for items drained on this run. The
   *  inline-analyze flow uses this to look up the just-uploaded photo's
   *  server id when a fresh enqueue+drain sends successfully. */
  sentPhotoIds?: Record<number, string>;
}

let _draining = false;

export async function drainPhotoOutbox(): Promise<PhotoDrainResult> {
  if (_draining) return { drained: 0, failed: 0, stopped: true };
  _draining = true;

  let drained = 0;
  let failed  = 0;
  let stopped = false;
  const sentPhotoIds: Record<number, string> = {};

  try {
    const items = await peekAllPhotos();
    for (const item of items) {
      const result = await sendOne(item);

      if (result.ok) {
        if (result.photoId) sentPhotoIds[item.id] = result.photoId;
        await removePhoto(item.id);
        drained += 1;
        continue;
      }

      if (result.transient) {
        await markPhotoFailure(item.id, result.error ?? `status ${result.status}`);
        stopped = true;
        break;
      }

      await markPhotoFailure(item.id, result.error ?? `status ${result.status}`);
      if (item.retries + 1 >= MAX_RETRIES) {
        await removePhoto(item.id);
        failed += 1;
      }
    }
  } finally {
    _draining = false;
  }

  return { drained, failed, stopped, sentPhotoIds };
}

// Convenience: try to send right away when caller believes we're online; if
// it fails for any reason, queue and let the auto-drain pick it up later.
//
// Returns the server-assigned photoId on the 'sent' branch so the inline
// analyze flow can call /api/ai/analyze-photo without round-tripping
// through GET /api/photos to find the row by submission_uuid.
export async function uploadPhotoOrEnqueue(args: {
  ticketId:  string | number;
  fileUri:   string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<
  | { status: 'sent';   photoId: string; queueId?: number }
  | { status: 'queued'; queueId: number; error?: string }
> {
  // Optimistic path: enqueue first so it's durable, then attempt drain.
  // If the network is up, drainPhotoOutbox will send it and remove it
  // immediately. If not, it stays queued. This avoids a race where the
  // app crashes between fetch() and enqueue().
  const { id } = await enqueuePhoto(args);
  const result = await drainPhotoOutbox();
  const photoId = result.sentPhotoIds?.[id];
  if (result.drained > 0 && photoId) {
    return { status: 'sent', photoId, queueId: id };
  }
  return { status: 'queued', queueId: id };
}
