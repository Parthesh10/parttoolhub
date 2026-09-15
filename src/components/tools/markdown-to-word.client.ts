import { parseMarkdown, renderHtml, summarize, SAMPLE_MARKDOWN } from '../../lib/markdown';
import { markdownToDocx } from '../../lib/markdown-to-docx';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const preview = $('preview');
const previewEmpty = $('preview-empty');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const downloadBtn = $<HTMLButtonElement>('btn-download');

let currentMarkdown = '';

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the text a visitor typed.
const fired = new Set<string>();
let inputSource: 'typed' | 'pasted' | 'sample' | 'transfer' = 'typed';
let justPasted = false;
function track(name: string, params: Record<string, string | number | boolean> = {}, once?: string) {
  if (once) {
    if (fired.has(once)) return;
    fired.add(once);
  }
  const b = document.body.dataset;
  window.pth?.track(name, { tool_slug: b.toolSlug ?? '', tool_category: b.toolCategory ?? '', ...params });
}
const sizeBucket = (n: number) => (n < 100 ? 'xs' : n < 1_000 ? 's' : n < 10_000 ? 'm' : n < 100_000 ? 'l' : 'xl');
/** First run on non-empty input → tool_use; first success → tool_result; first failure → tool_error. */
function trackRun(action: string, ok: boolean, errorType = 'unknown') {
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(input.value.length) }, 'use');
  if (ok) track('tool_result', { action }, 'result');
  else track('tool_error', { action, error_type: errorType }, 'error');
}
/** Which controls people touch. Free-text inputs report no value; selects report the visible label.
 *  This tool has no option controls (just Load sample / Clear / Download), but every tool keeps this
 *  helper so the shape of the analytics block stays identical and copy-pasteable across tools. */
function trackOption(el: HTMLInputElement | HTMLSelectElement | HTMLButtonElement, value?: string) {
  let v = value;
  if (v === undefined) {
    if (el instanceof HTMLSelectElement) v = el.options[el.selectedIndex]?.text ?? '';
    else if (el instanceof HTMLInputElement && el.type === 'checkbox') v = String(el.checked);
    else v = '(text)';
  }
  track('tool_option', { option: el.id || el.dataset.preset || 'unknown', value: v }, `opt:${el.id || el.dataset.preset}`);
}
input.addEventListener('paste', () => { justPasted = true; });
input.addEventListener('input', () => { inputSource = justPasted ? 'pasted' : 'typed'; justPasted = false; });

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function setStatus(kind: 'error' | 'ok' | null, text = '') {
  status.hidden = kind === null;
  status.className = `status-banner${kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : ''}`;
  status.textContent = text;
}

function render() {
  const raw = input.value;
  currentMarkdown = raw;
  inputStat.textContent = plural(raw.length, 'character');

  if (!raw.trim()) {
    preview.replaceChildren(previewEmpty);
    previewEmpty.hidden = false;
    outputStat.textContent = '';
    downloadBtn.disabled = true;
    setStatus(null);
    return;
  }

  const blocks = parseMarkdown(raw);
  const html = renderHtml(blocks);
  const s = summarize(blocks);
  trackRun('convert', true);

  // Preview only — the actual .docx is built fresh from the Markdown source on download,
  // not from this HTML, so the file matches the real OOXML engine, not the preview renderer.
  preview.innerHTML = html;
  const parts = [plural(s.words, 'word')];
  if (s.headings) parts.push(plural(s.headings, 'heading'));
  if (s.lists) parts.push(plural(s.lists, 'list'));
  if (s.tables) parts.push(plural(s.tables, 'table'));
  if (s.codeBlocks) parts.push(plural(s.codeBlocks, 'code block'));
  if (s.links) parts.push(plural(s.links, 'link'));
  outputStat.textContent = parts.join(' · ');
  downloadBtn.disabled = false;
  setStatus(null);
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2400);
}

function downloadDocx() {
  if (!currentMarkdown.trim()) return showToast('Nothing to download yet');
  track('download_result', { target: 'docx' });
  try {
    const bytes = markdownToDocx(currentMarkdown, { title: 'Converted from Markdown' });
    // TS's DOM lib types BlobPart as requiring an ArrayBuffer-backed view (never SharedArrayBuffer);
    // the bytes here always come from a plain `new Uint8Array(n)` in zip-writer.ts, so this is a type
    // assertion over a real runtime guarantee, not an unsafe cast.
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.docx';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('ok', 'Downloaded document.docx — open it directly in Word, LibreOffice or upload it to Google Docs.');
  } catch {
    setStatus('error', 'Could not build the .docx file. If this keeps happening, simplify the Markdown (very deeply nested lists are the most likely cause) and try again.');
  }
}

// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms and large pastes can take longer than that to process
// synchronously.
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
downloadBtn.addEventListener('click', downloadDocx);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_MARKDOWN;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    window.clearTimeout(renderTimer); // flush a pending debounced render first
    render();
    downloadDocx();
  }
});

render();
