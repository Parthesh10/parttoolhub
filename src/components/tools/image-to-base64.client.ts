import { imageToBase64, formatBytes, SAMPLE_PNG_BASE64, type EncodedImage } from '../../lib/base64-image';
import { sendToTool } from '../../lib/transfer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('file');
const dropzone = $('dropzone');
const dropHint = $('drop-hint');
const thumb = $<HTMLImageElement>('thumb');
const inputStat = $('input-stat');
const status = $('status');
const toast = $('toast');
const outDataUri = $<HTMLTextAreaElement>('out-datauri');
const outBase64 = $<HTMLTextAreaElement>('out-base64');
const outHtml = $<HTMLTextAreaElement>('out-html');
const outCss = $<HTMLTextAreaElement>('out-css');
const handoffBtn = $<HTMLButtonElement>('btn-handoff-decode');

/** Files above this are refused: four copies of a 13 MB+ string in the DOM is what freezes a tab. */
const MAX_BYTES = 10 * 1024 * 1024;

/** The last successful encode — what the copy buttons and the handoff act on. */
let current: EncodedImage | null = null;

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the file or anything in it. This
// tool takes a file rather than typed text, so input_source is 'file' for the
// picker and drag-and-drop, 'pasted' for a clipboard image, 'sample' for the
// built-in one; input_size buckets the file's byte count.
const fired = new Set<string>();
let inputSource: 'file' | 'pasted' | 'sample' = 'file';
let inputBytes = 0;
function track(name: string, params: Record<string, string | number | boolean> = {}, once?: string) {
  if (once) {
    if (fired.has(once)) return;
    fired.add(once);
  }
  const b = document.body.dataset;
  window.pth?.track(name, { tool_slug: b.toolSlug ?? '', tool_category: b.toolCategory ?? '', ...params });
}
const sizeBucket = (n: number) => (n < 100 ? 'xs' : n < 1_000 ? 's' : n < 10_000 ? 'm' : n < 100_000 ? 'l' : 'xl');
/** First run on a file → tool_use; first success → tool_result; first failure → tool_error. */
function trackRun(action: string, ok: boolean, errorType = 'unknown') {
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(inputBytes) }, 'use');
  if (ok) track('tool_result', { action }, 'result');
  else track('tool_error', { action, error_type: errorType }, 'error');
}
/** Which controls people touch. Free-text inputs report no value; selects report the visible label. */
function trackOption(el: HTMLInputElement | HTMLSelectElement | HTMLButtonElement, value?: string) {
  let v = value;
  if (v === undefined) {
    if (el instanceof HTMLSelectElement) v = el.options[el.selectedIndex]?.text ?? '';
    else if (el instanceof HTMLInputElement && el.type === 'checkbox') v = String(el.checked);
    else v = '(text)';
  }
  track('tool_option', { option: el.id || el.dataset.preset || 'unknown', value: v }, `opt:${el.id || el.dataset.preset}`);
}

/** Fixed categories for tool_error — derived from the message, never the message itself. */
function errorCategory(msg: string): string {
  if (/empty/.test(msg)) return 'empty';
  if (/over 10 MB/.test(msg)) return 'too_large';
  if (/PDF|ZIP|gzip/.test(msg)) return 'other_file';
  if (/not a PNG/.test(msg)) return 'not_image';
  return 'other';
}

function setStatus(kind: 'error' | 'ok' | null, text = '') {
  status.hidden = kind === null;
  status.className = `status-banner${kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : ''}`;
  status.textContent = text;
}

function clearOutputs() {
  current = null;
  for (const t of [outDataUri, outBase64, outHtml, outCss]) t.value = '';
  thumb.removeAttribute('src');
  thumb.hidden = true;
  dropHint.hidden = false;
  handoffBtn.disabled = true;
}

/** "PNG · 32 × 32 px · 157 B → 212 characters (+35%)" */
function describe(e: EncodedImage) {
  const { info } = e;
  const size = info.width && info.height ? ` · ${info.width} × ${info.height} px` : '';
  const growth = Math.round(((e.base64Length - e.bytes) / e.bytes) * 100);
  return `${info.format.toUpperCase()}${size} · ${formatBytes(e.bytes)} → ${e.base64Length.toLocaleString()} characters (+${growth}%)`;
}

function encode(bytes: Uint8Array) {
  inputBytes = bytes.length;
  if (bytes.length > MAX_BYTES) {
    clearOutputs();
    inputStat.textContent = formatBytes(bytes.length);
    trackRun('encode', false, 'too_large');
    setStatus('error', `This file is ${formatBytes(bytes.length)}, over the 10 MB limit. A data URI that size is not usable in a page, and four copies of it would freeze this tab. Compress or resize the image first.`);
    return;
  }
  const r = imageToBase64(bytes);
  if (!r.ok) {
    clearOutputs();
    inputStat.textContent = formatBytes(bytes.length);
    const kind = errorCategory(r.error);
    trackRun('encode', false, kind);
    setStatus('error', r.error);
    return;
  }
  current = r.value;
  trackRun('encode', true);
  outDataUri.value = r.value.dataUri;
  outBase64.value = r.value.base64;
  outHtml.value = r.value.html;
  outCss.value = r.value.css;
  inputStat.textContent = describe(r.value);
  thumb.src = r.value.dataUri;
  thumb.hidden = false;
  dropHint.hidden = true;
  handoffBtn.disabled = false;
  setStatus(null);
}

async function loadFile(file: File | null | undefined, source: 'file' | 'pasted') {
  if (!file) return;
  inputSource = source;
  const bytes = new Uint8Array(await file.arrayBuffer());
  encode(bytes);
}

// The browser cannot show every format it can encode (AVIF on an older browser, ICO in some);
// the Base64 is still correct, so say so rather than leaving a broken-image icon.
thumb.addEventListener('error', () => {
  if (!current) return;
  thumb.hidden = true;
  dropHint.hidden = false;
  setStatus('ok', `Your browser could not preview this ${current.info.format.toUpperCase()}, but the Base64 below is the file's bytes, unchanged — it will work wherever the format is supported.`);
});

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

const OUTPUTS: Record<string, HTMLTextAreaElement> = { data_uri: outDataUri, base64: outBase64, html: outHtml, css: outCss };
async function copyOutput(which: string) {
  const box = OUTPUTS[which];
  if (!box?.value) return showToast('Load an image first');
  track('copy_result', { target: which });
  try {
    await navigator.clipboard.writeText(box.value);
    showToast('Copied to clipboard');
  } catch {
    box.select();
    document.execCommand('copy');
    showToast('Copied');
  }
}

// --- Wiring -----------------------------------------------------------------
const openPicker = () => fileInput.click();
$('btn-choose').addEventListener('click', openPicker);
dropzone.addEventListener('click', openPicker);
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openPicker();
  }
});
fileInput.addEventListener('change', () => {
  void loadFile(fileInput.files?.[0], 'file');
  fileInput.value = ''; // so choosing the same file again still fires change
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('is-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('is-over');
  void loadFile(e.dataTransfer?.files?.[0], 'file');
});
// A screenshot or a copied image on the clipboard: Ctrl+V anywhere on the page.
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  void loadFile(item.getAsFile(), 'pasted');
});
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  btn.addEventListener('click', () => void copyOutput(btn.dataset.copy ?? ''));
}
handoffBtn.addEventListener('click', () => {
  if (!current) return;
  track('navigation_click', { link_placement: 'handoff', link_to: '/tools/base64-to-image' });
  sendToTool(current.dataUri, '/tools/base64-to-image');
});
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  clearOutputs();
  inputStat.textContent = 'No file yet';
  setStatus(null);
  dropzone.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  encode(Uint8Array.from(atob(SAMPLE_PNG_BASE64), (c) => c.charCodeAt(0)));
});
