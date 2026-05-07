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

/** Tiny markdown -> HTML converter. Handles the subset Claude / Gemini
 *  actually emits: headings (#, ##, ###), bold, italics, inline code,
 *  fenced code blocks, ordered / unordered lists, and links. Anything
 *  not matched is treated as a plain paragraph and escaped. Used by the
 *  PDF export so saved chats and reports render formatting cleanly in
 *  the printed document. */
export function markdownToHtml(src: string): string {
  if (!src) return '';

  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  type ListKind = 'ul' | 'ol';
  const listStack: ListKind[] = [];
  let inFence = false;
  let fenceBuffer: string[] = [];

  const closeLists = () => {
    while (listStack.length) out.push(`</${listStack.pop()}>`);
  };

  const inline = (text: string): string => {
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(
      /\[([^\]]+)\]\(([^\s)]+)\)/g,
      (_, label, url) => `<a href="${url}">${label}</a>`,
    );
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=$|[\s.,!?)])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_(?!\s)(.+?)_(?=$|[\s.,!?)])/g, '$1<em>$2</em>');
    return s;
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inFence) {
        out.push(`<pre><code>${esc(fenceBuffer.join('\n'))}</code></pre>`);
        fenceBuffer = [];
        inFence = false;
      } else {
        closeLists();
        inFence = true;
      }
      continue;
    }
    if (inFence) { fenceBuffer.push(line); continue; }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeLists();
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`);
      continue;
    }

    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      if (listStack[listStack.length - 1] !== 'ul') {
        closeLists();
        listStack.push('ul');
        out.push('<ul>');
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      if (listStack[listStack.length - 1] !== 'ol') {
        closeLists();
        listStack.push('ol');
        out.push('<ol>');
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    if (!line.trim()) { closeLists(); continue; }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeLists();
  if (inFence && fenceBuffer.length) {
    out.push(`<pre><code>${esc(fenceBuffer.join('\n'))}</code></pre>`);
  }
  // Post-pass: convert pipe-table runs to <table>. Gemini and Claude both
  // love emitting tables for citation lookups (Permit Element / What it
  // Must Contain etc.), so the PDF needs to render them as proper
  // <table> rather than literal pipes inside paragraphs.
  return convertPipeTables(out.join('\n'));
}

/** Match a sequence of <p>|...|...</p> rows (with the standard
 *  | --- | --- | separator row immediately after the header) and
 *  rewrite them as a single <table>.thead/tbody. Other paragraphs
 *  pass through unchanged. */
function convertPipeTables(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  let i = 0;

  const stripPRow = (s: string): string[] | null => {
    const m = /^<p>\|(.+)\|<\/p>$/.exec(s.trim());
    if (!m) return null;
    return m[1].split('|').map(c => c.trim());
  };

  while (i < lines.length) {
    const headerCells = stripPRow(lines[i]);
    const sepCells   = i + 1 < lines.length ? stripPRow(lines[i + 1]) : null;
    const isSeparator = sepCells && sepCells.every(c => /^:?-{2,}:?$/.test(c.trim()));

    if (headerCells && isSeparator) {
      const head = `<tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr>`;
      const bodyRows: string[] = [];
      let j = i + 2;
      while (j < lines.length) {
        const cells = stripPRow(lines[j]);
        if (!cells) break;
        bodyRows.push(`<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`);
        j += 1;
      }
      out.push(`<table class="md-table"><thead>${head}</thead><tbody>${bodyRows.join('')}</tbody></table>`);
      i = j;
      continue;
    }

    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
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
  /* Reserve standard letter-paper margins (~0.6 in) so the printed PDF
     respects the printable area of any consumer printer or PDF viewer.
     expo-print honours @page on iOS / Android print rendering. The
     in-document .page padding stays as a small content cushion on top
     of the page margin so headers and footers don't kiss the edge. */
  @page {
    size: letter;
    margin: 0.6in 0.6in 0.7in 0.6in;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #0f172a;
    background: #ffffff;
  }
  .page {
    /* Inner cushion so the brand bar / footer sit a few pt away from
       the @page margin edge but the body still flows over multi-page
       reports without artificial gutters. */
    padding: 8px 4px 16px 4px;
  }
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
  /* When the body is markdown-rendered HTML, switch off pre-wrap (the
     converter already produces real <p> / <ul> / <li> elements) and
     give the inline elements brand styling. */
  .turn-md { white-space: normal; }
  .turn-md p { margin: 0 0 8px 0; }
  .turn-md p:last-child { margin-bottom: 0; }
  .turn-md strong { color: #0e182e; }
  .turn-md em { color: #1e293b; }
  .turn-md h1, .turn-md h2, .turn-md h3 {
    margin: 8px 0 4px 0;
    color: #0e182e;
    font-weight: 700;
  }
  .turn-md h1 { font-size: 16px; }
  .turn-md h2 { font-size: 14px; }
  .turn-md h3 { font-size: 13px; }
  .turn-md ul, .turn-md ol {
    margin: 4px 0 8px 0;
    padding-left: 20px;
  }
  .turn-md li { margin-bottom: 3px; }
  .turn-md code {
    background: #f1f5f9;
    color: #6b21a8;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: ui-monospace, 'Menlo', 'Consolas', monospace;
    font-size: 12px;
  }
  .turn-md pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 12px;
  }
  .turn-md pre code {
    background: transparent;
    color: #1e293b;
    padding: 0;
  }
  .turn-md a { color: #6b21a8; }
  .turn-md blockquote {
    border-left: 3px solid #c4b5fd;
    background: #faf5ff;
    margin: 6px 0;
    padding: 4px 10px;
    color: #475569;
  }
  /* Markdown tables (pipe syntax converted to real <table> by
     convertPipeTables). Use compact spacing so multi-column citations
     stay readable on letter paper. */
  .turn-md table.md-table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 12px;
  }
  .turn-md table.md-table th,
  .turn-md table.md-table td {
    border: 1px solid #cbd5e1;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  .turn-md table.md-table th {
    background: #f1f5f9;
    color: #0e182e;
    font-weight: 700;
  }
  .turn-md table.md-table tr:nth-child(even) td {
    background: #fafafa;
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
    // Render assistant turns as parsed markdown so bold, lists, and
    // headings survive into the PDF the way they do on screen. User
    // turns stay plain text — what the contractor typed is what shows.
    const body  = m.role === 'assistant'
      ? `<div class="turn-text turn-md">${markdownToHtml(m.content)}</div>`
      : `<div class="turn-text">${esc(m.content)}</div>`;
    return `
      <div class="${klass}">
        <div class="turn-role ${m.role === 'user' ? 'turn-role-user' : ''}">${role}${ts}</div>
        ${body}
      </div>`;
  }).join('');

  const summaryHtml = args.summary
    ? `<div class="section">
         <div class="section-title">Summary</div>
         <div class="section-body turn-md">${markdownToHtml(args.summary)}</div>
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
      <div class="section-body turn-md">${markdownToHtml(args.description)}</div>
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
  // 1pt = 1/72in. 0.6in = 43.2pt → round to 43 for cleaner output.
  // Width / height left at expo-print defaults (612x792 = US Letter).
  const { uri } = await Print.printToFileAsync({
    html,
    margins: { left: 43, right: 43, top: 43, bottom: 50 },
  });

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
