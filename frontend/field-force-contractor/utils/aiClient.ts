// aiClient.ts
// Typed wrappers for the /api/ai/* endpoints. Kept in its own module so the
// AI feature surface is easy to find and so api.ts (which carries machine
// specific local edits) doesn't have to absorb every new AI call.
//
// All requests attach the JWT from secureStorage. Errors land as ApiError
// shaped objects with the AI_* code from the backend so screens can branch
// on the failure type.

import { API_BASE_URL, ApiError } from './api';
import { getToken } from './secureStorage';

// ── Types ──────────────────────────────────────────────────────────────────

export interface InspectionReport {
  title:               string;
  priority:            'low' | 'medium' | 'high';
  category:            string;
  description:         string;
  recommended_actions: string[];
}

export interface PhotoAnalysis {
  summary:         string;
  severity:        'none' | 'low' | 'medium' | 'high';
  concerns:        string[];
  recommendations: string[];
}

export interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

export interface ChatReply {
  reply: string;
}

export interface SavedReport extends InspectionReport {
  id:            number;
  contractor_id: string;
  inspection_id: number | null;
  raw_notes:     string | null;
  created_at:    string;
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

/** Throw an ApiError-shaped object. Preserves the AI_* code from the backend. */
async function asApiError(res: Response): Promise<never> {
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON body, leave empty */
  }
  const err: ApiError = {
    status: res.status,
    error:  body.error ?? `HTTP ${res.status}`,
    code:   body.code,
  };
  throw err;
}

async function jsonRequest<T>(
  path:    string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: await authHeaders(options.headers as Record<string, string> | undefined),
  });
  if (!res.ok) await asApiError(res);
  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * One-shot inspection assist. Returns the structured report after Claude
 * finishes generating. Use streamInspectionAssist for a token-by-token UX.
 */
export function inspectionAssist(notes: string): Promise<InspectionReport> {
  return jsonRequest<InspectionReport>('/api/ai/inspection-assist', {
    method: 'POST',
    body:   JSON.stringify({ notes }),
  });
}

export interface StreamHandlers {
  /** Fires for every token-ish chunk Claude emits. Append to your buffer. */
  onChunk: (chunk: string) => void;
  /** Fires once when the stream closes cleanly. Buffer is the full text. */
  onDone:  (full: string)  => void;
  /** Fires on transport or upstream error. Stream terminates. */
  onError: (err: ApiError) => void;
}

/**
 * Streaming variant of inspectionAssist. Backend sends Server Sent Events
 * (text/event-stream) where each `data:` payload is a JSON object holding
 * the next chunk of text. The full response is the concatenation of every
 * chunk and is meant to parse to a JSON InspectionReport at the end.
 *
 * Returns a function the caller can invoke to abort the stream early
 * (e.g. when the user navigates away mid-generation).
 */
export function streamInspectionAssist(
  notes:    string,
  handlers: StreamHandlers,
): () => void {
  const controller = new AbortController();
  let buffer = '';

  (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/inspection-assist/stream`, {
        method:  'POST',
        headers: await authHeaders({ 'Accept': 'text/event-stream' }),
        body:    JSON.stringify({ notes }),
        signal:  controller.signal,
      });

      if (!res.ok) {
        await asApiError(res);
        return;
      }
      if (!res.body) {
        // Some React Native versions don't expose the stream reader. Fall
        // back to the non-streaming endpoint so the feature still works.
        const report = await inspectionAssist(notes);
        const text = JSON.stringify(report);
        handlers.onChunk(text);
        handlers.onDone(text);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let pending   = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });

        // SSE messages are separated by blank lines. Parse each complete event.
        let sepIdx;
        while ((sepIdx = pending.indexOf('\n\n')) !== -1) {
          const raw   = pending.slice(0, sepIdx);
          pending     = pending.slice(sepIdx + 2);

          // Lines look like "event: name" and "data: payload". A bare data
          // line means the event type is "message".
          let event = 'message';
          let data  = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }

          if (event === 'done') {
            handlers.onDone(buffer);
            controller.abort();
            return;
          }
          if (event === 'error') {
            let msg = 'Stream error';
            try { msg = JSON.parse(data).error ?? msg; } catch { /* ignore */ }
            handlers.onError({ status: 502, error: msg, code: 'AI_SERVICE_ERROR' });
            controller.abort();
            return;
          }
          // event === 'message': the chunk
          if (data) {
            try {
              const parsed = JSON.parse(data);
              const text   = typeof parsed.chunk === 'string' ? parsed.chunk : data;
              buffer += text;
              handlers.onChunk(text);
            } catch {
              buffer += data;
              handlers.onChunk(data);
            }
          }
        }
      }
      // Stream closed without an explicit done event. Fire it now.
      handlers.onDone(buffer);
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // caller cancelled, not an error
      const apiErr: ApiError = e?.status != null
        ? e
        : { status: 0, error: String(e?.message ?? e), offline: true };
      handlers.onError(apiErr);
    }
  })();

  return () => controller.abort();
}

/** Send a structured report + contractor feedback, get back a revised report. */
export function refineReport(
  report:   InspectionReport,
  feedback: string,
): Promise<InspectionReport> {
  return jsonRequest<InspectionReport>('/api/ai/refine-report', {
    method: 'POST',
    body:   JSON.stringify({ report, feedback }),
  });
}

/**
 * Run Claude vision against a previously-uploaded ticket photo.
 * Caller must be the assigned contractor on the photo's parent ticket.
 */
export function analyzePhoto(photoId: string): Promise<PhotoAnalysis> {
  return jsonRequest<PhotoAnalysis>('/api/ai/analyze-photo', {
    method: 'POST',
    body:   JSON.stringify({ photo_id: photoId }),
  });
}

/**
 * Stateless chat. Frontend keeps the conversation history and sends the
 * whole array each turn. Last message must be from the user.
 */
export function chat(messages: ChatMessage[]): Promise<ChatReply> {
  return jsonRequest<ChatReply>('/api/ai/chat', {
    method: 'POST',
    body:   JSON.stringify({ messages }),
  });
}

/** Persist a report to the local DB. */
export function saveReport(
  report:   InspectionReport,
  rawNotes: string | null = null,
): Promise<SavedReport> {
  return jsonRequest<SavedReport>('/api/ai/save-report', {
    method: 'POST',
    body:   JSON.stringify({
      title:               report.title,
      priority:            report.priority,
      category:            report.category,
      description:         report.description,
      recommended_actions: report.recommended_actions,
      raw_notes:           rawNotes,
    }),
  });
}

/** List saved reports for the logged-in contractor (newest first). */
export function listReports(): Promise<SavedReport[]> {
  return jsonRequest<SavedReport[]>('/api/ai/reports');
}
