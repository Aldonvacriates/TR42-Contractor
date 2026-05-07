// pdfExport.ts
//
// Build branded PDF artefacts for saved AI artefacts and hand them to the
// system share sheet. Two surfaces:
//   - exportChatPdf(...)    saved Field Assistant conversations
//   - exportReportPdf(...)  AI inspection reports
//
// Both produce a styled HTML document, render it to a PDF via expo-print,
// and open expo-sharing so the contractor can email / Notes / Slack /
// drop into a ticket comment.
//
// The Field Force logo is embedded as base64 inline so the PDF is fully
// self-contained — recipients see the brand even without a network
// connection or hosted image URL.

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExportChatArgs {
  title:    string;
  summary?: string | null;
  messages: { role: 'user' | 'assistant'; content: string; timestamp?: string | null }[];
  /** Local URI (file://...) of an attached photo, optional. Embedded as
   *  base64 in the PDF when present so the recipient sees it inline. */
  photoUri?: string | null;
}

export interface ExportReportArgs {
  title:               string;
  priority:            string;       // 'low' | 'medium' | 'high'
  category:            string;
  description:         string;
  recommended_actions: string[];
  raw_notes?:          string | null;
  created_at?:         string;       // ISO string, optional
}

// ─── Logo loading ──────────────────────────────────────────────────────────

let _logoDataUriCache: string | null = null;

/** Load the Field Force logo as a base64 data URI. Cached after first load
 *  so subsequent exports don't re-read the file. Falls back gracefully to
 *  null if the asset can't be resolved (e.g. early in app boot). */
async function loadLogoDataUri(): Promise<string | null> {
  if (_logoDataUriCache !== null) return _logoDataUriCache;
  try {
    const asset = Asset.fromModule(require('../assets/images/FieldForceIconLarge.png'));
    await asset.downloadAsync();
    if (!asset.localUri) return null;
    const base64 = await FileSystem.readAsStringAsync(asset.localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    _logoDataUriCache = `data:image/png;base64,${base64}`;
    return _logoDataUriCache;
  } catch {
    return null;
  }
}

/** Same trick for an arbitrary local image URI (e.g. an attached chat
 *  photo). Returns null on failure so the PDF still renders without it. */
async function fileUriToDataUri(uri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // expo-image-picker emits .jpg by default and the inspection / ticket
    // photos pipeline uses image/jpeg too — assume jpeg unless we have a
    // strong signal otherwise.
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null;
  }
}

// ─── Shared HTML helpers ───────────────────────────────────────────────────

/** Minimal HTML escape for content that goes into innerText slots. */
function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Brand header used at the top of every export. Logo image is embedded
 *  as a data URI so the PDF stays self-contained. */
function brandHeader(logoDataUri: string | null, subtitle: string): string {
  const logo = logoDataUri
    ? `<img src="${logoDataUri}" alt="Field Force" class="brand-logo" />`
    : '<div class="brand-logo brand-logo-fallback"></div>';
  return `
    <header class="brand-header">
      <div class="brand-header-left">
        ${logo}
        <div class="brand-text">
          <div class="brand-name">Field Force</div>
          <div class="brand-subtitle">${esc(subtitle)}</div>
        </div>
      </div>
      <div class="brand-stamp">${esc(new Date().toLocaleString())}</div>
    </header>
  `;
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #0f172a;
    background: #ffffff;
  }
  .page { padding: 36px 40px 48px 40px; }
  .brand-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 2px solid #0e182e;
    padding-bottom: 14px;
    margin-bottom: 24px;
  }
  .brand-header-left { display: flex; align-items: center; gap: 14px; }
  .brand-logo {
    width: 44px; height: 44px;
    border-radius: 8px;
    object-fit: contain;
  }
  .brand-logo-fallback {
    background: #0e182e;
  }
  .brand-name {
    font-size: 18px;
    font-weight: 700;
    color: #0e182e;
    letter-spacing: 0.3px;
  }
  .brand-subtitle {
    font-size: 11px;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-top: 2px;
  }
  .brand-stamp {
    font-size: 10px;
    color: #64748b;
  }
  h1.doc-title {
    font-size: 22px;
    font-weight: 700;
    margin: 0 0 8px 0;
    color: #0e182e;
    line-height: 1.3;
  }
  .doc-meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid #cbd5e1;
    color: #475569;
    background: #f1f5f9;
  }
  .pill-priority-high   { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
  .pill-priority-medium { color: #b45309; background: #fffbeb; border-color: #fcd34d; }
  .pill-priority-low    { color: #047857; background: #ecfdf5; border-color: #a7f3d0; }
  .section {
    margin-top: 18px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 6px;
  }
  .section-body {
    font-size: 13px;
    line-height: 1.55;
    color: #1e293b;
    white-space: pre-wrap;
  }
  ol.recs {
    margin: 0;
    padding-left: 18px;
  }
  ol.recs li {
    margin-bottom: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: #1e293b;
  }
  .turn {
    margin-bottom: 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }
  .turn-user      { background: #f8fafc; border-color: #cbd5e1; }
  .turn-assistant { background: #faf5ff; border-color: #d8b4fe; }
  .turn-role {
    font-size: 10px;
    font-weight: 700;
    color: #6b21a8;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .turn-role-user { color: #1e40af; }
  .turn-text {
    font-size: 13px;
    line-height: 1.55;
    color: #1e293b;
    white-space: pre-wrap;
  }
  .photo-card {
    margin-top: 18px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
  }
  .photo-card img {
    width: 100%;
    max-height: 360px;
    object-fit: contain;
    border-radius: 4px;
    display: block;
  }
  .photo-caption {
    margin-top: 6px;
    font-size: 10px;
    color: #64748b;
    text-align: center;
  }
  footer.brand-footer {
    margin-top: 32px;
    border-top: 1px solid #e2e8f0;
    padding-top: 12px;
    font-size: 10px;
    color: #94a3b8;
    text-align: center;
  }
`;

function htmlShell(bodyContent: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><style>${BASE_CSS}</style></head>
<body><div class="page">${bodyContent}</div></body></html>`;
}

// ─── Chat conversation export ──────────────────────────────────────────────

export async function exportChatPdf(args: ExportChatArgs): Promise<void> {
  const logo  = await loadLogoDataUri();
  const photo = args.photoUri ? await fileUriToDataUri(args.photoUri) : null;

  const turnsHtml = args.messages.map(m => {
    const klass = m.role === 'user' ? 'turn turn-user' : 'turn turn-assistant';
    const role  = m.role === 'user' ? 'Contractor' : 'Field Assistant';
    const ts    = m.timestamp ? ` &middot; ${esc(m.timestamp)}` : '';
    return `
      <div class="${klass}">
        <div class="turn-role ${m.role === 'user' ? 'turn-role-user' : ''}">${role}${ts}</div>
        <div class="turn-text">${esc(m.content)}</div>
      </div>`;
  }).join('');

  const summaryHtml = args.summary
    ? `<div class="section">
         <div class="section-title">Summary</div>
         <div class="section-body">${esc(args.summary)}</div>
       </div>`
    : '';

  const photoHtml = photo
    ? `<div class="photo-card">
         <img src="${photo}" alt="Attached photo" />
         <div class="photo-caption">Attached job-site photo</div>
       </div>`
    : '';

  const html = htmlShell(`
    ${brandHeader(logo, 'Field Assistant Conversation')}
    <h1 class="doc-title">${esc(args.title)}</h1>
    ${summaryHtml}
    <div class="section">
      <div class="section-title">Transcript &middot; ${args.messages.length} message${args.messages.length === 1 ? '' : 's'}</div>
      ${turnsHtml}
    </div>
    ${photoHtml}
    <footer class="brand-footer">
      Generated by Field Force AI &middot; ${new Date().toLocaleDateString()}
    </footer>
  `);

  await renderAndShare(html, args.title);
}

// ─── Inspection report export ──────────────────────────────────────────────

export async function exportReportPdf(args: ExportReportArgs): Promise<void> {
  const logo = await loadLogoDataUri();

  const priority = (args.priority || 'low').toLowerCase();
  const priorityClass = `pill pill-priority-${priority}`;
  const priorityLabel = priority.toUpperCase();

  const recsHtml = args.recommended_actions && args.recommended_actions.length > 0
    ? `<ol class="recs">${args.recommended_actions.map(a => `<li>${esc(a)}</li>`).join('')}</ol>`
    : '<div class="section-body" style="color:#94a3b8;">No actions recommended.</div>';

  const rawNotesHtml = args.raw_notes
    ? `<div class="section">
         <div class="section-title">Original notes</div>
         <div class="section-body" style="color:#475569; font-style: italic;">${esc(args.raw_notes)}</div>
       </div>`
    : '';

  const stampHtml = args.created_at
    ? `<div class="brand-stamp" style="margin-top:-12px; margin-bottom:18px;">
         Saved ${esc(new Date(args.created_at).toLocaleString())}
       </div>`
    : '';

  const html = htmlShell(`
    ${brandHeader(logo, 'AI Inspection Report')}
    <h1 class="doc-title">${esc(args.title)}</h1>
    <div class="doc-meta">
      <span class="${priorityClass}">${priorityLabel} PRIORITY</span>
      <span class="pill">${esc(args.category || 'General')}</span>
    </div>
    ${stampHtml}
    <div class="section">
      <div class="section-title">Description</div>
      <div class="section-body">${esc(args.description)}</div>
    </div>
    <div class="section">
      <div class="section-title">Recommended actions</div>
      ${recsHtml}
    </div>
    ${rawNotesHtml}
    <footer class="brand-footer">
      Generated by Field Force AI &middot; ${new Date().toLocaleDateString()}
    </footer>
  `);

  await renderAndShare(html, args.title);
}

// ─── Render + share helper ─────────────────────────────────────────────────

async function renderAndShare(html: string, displayTitle: string): Promise<void> {
  // expo-print returns a temporary file in cache. The system share sheet
  // can read it before the OS reaps the cache, which is plenty.
  const { uri } = await Print.printToFileAsync({ html });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    // Web / unsupported platform — leave the file in place; surface the
    // path so the caller can decide what to do. In practice this only
    // hits on RN Web which we don't ship for the contractor app.
    throw new Error('Sharing is not available on this platform');
  }
  await Sharing.shareAsync(uri, {
    mimeType:    'application/pdf',
    dialogTitle: displayTitle,
    UTI:         'com.adobe.pdf', // iOS only; ignored on Android
  });
}
