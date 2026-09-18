import { base64ToImage, base64ToBytes, sniffOther, formatBytes, SAMPLE_PNG_DATA_URI, type DecodedImage } from '../../lib/base64-image';
import { sendToTool, receiveTransfer } from '../../lib/transfer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const preview = $<HTMLImageElement>('preview');
const previewBox = $('preview-box');
const previewEmpty = $('preview-empty');
const status = $('status');
const toast = $('toast');
const downloadBtn = $<HTMLButtonElement>('btn-download');
const copyBtn = $<HTMLButtonElement>('btn-copy');
const downloadFileBtn = $<HTMLButtonElement>('btn-download-file');
const handoffTextBtn = $<HTMLButtonElement>('btn-handoff-text');
const bgChips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-bg]')];
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

// --- UX-003: fullscreen / focus mode ---------------------------------------
function setFullscreen(on: boolean) {
  toolSection.classList.toggle('is-fullscreen', on);
  document.body.classList.toggle('no-scroll', on);
  fullscreenBtn.setAttribute('aria-pressed', String(on));
  fullscreenBtn.textContent = on ? '✕ Exit fullscreen' : '⛶ Fullscreen';
  track('tool_option', { option: 'fullscreen', value: String(on) });
}
fullscreenBtn.addEventListener('click', () => setFullscreen(!toolSection.classList.contains('is-fullscreen')));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && toolSection.classList.contains('is-fullscreen')) setFullscreen(false);
});

// --- UX-002: paste from clipboard -------------------------------------------
// No drag-and-drop here — the sibling tool (Image to Base64) already owns
// dropping an image file; this pane takes Base64/data-URI text, one blob.
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return showToast('Clipboard is empty');
    inputSource = 'pasted';
    input.value = text;
    render();
  } catch {
    showToast('Clipboard permission denied — use Ctrl+V instead');
  }
}

/** The last successful decode — what Download and Copy act on. */
let current: DecodedImage | null = null;
/** Non-image bytes from the last failed decode, offered as a plain file download. */
let otherFile: { bytes: Uint8Array; extension: string; mime: string } | null = null;

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
input.addEventListener('paste', () => { justPasted = true; });
input.addEventListener('input', () => { inputSource = justPasted ? 'pasted' : 'typed'; justPasted = false; });

/** Fixed categories for tool_error — derived from the message, never the message itself. */
function errorCategory(msg: string): string {
  if (/alphabet/.test(msg)) return 'alphabet';
  if (/length/.test(msg)) return 'length';
  if (/plain text/.test(msg)) return 'text';
  if (/PDF|ZIP|gzip/.test(msg)) return 'other_file';
  if (/not a PNG/.test(msg)) return 'not_image';
  if (/data: URI/.test(msg)) return 'data_uri';
  return 'other';
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function setStatus(kind: 'error' | 'ok' | null, text = '') {
  status.hidden = kind === null;
  status.className = `status-banner${kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : ''}`;
  status.textContent = text;
}

function clearPreview() {
  current = null;
  otherFile = null;
  preview.removeAttribute('src');
  preview.hidden = true;
  previewEmpty.hidden = false;
  outputStat.textContent = '';
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  downloadFileBtn.hidden = true;
  handoffTextBtn.hidden = true;
}

/** "PNG · 32 × 32 px · 157 B" — dimensions from the header, or from the browser once it has rendered. */
function describe(img: DecodedImage) {
  const { info } = img;
  const w = info.width ?? (preview.naturalWidth || undefined);
  const h = info.height ?? (preview.naturalHeight || undefined);
  const size = w && h ? ` · ${w} × ${h} px` : '';
  return `${info.format.toUpperCase()}${size} · ${formatBytes(img.bytes.length)}`;
}

/** One sentence on what had to be cleaned up before decoding, so the visitor learns why the last tool failed. */
function cleanupNote(img: DecodedImage): string {
  const c = img.cleanup;
  const done: string[] = [];
  if (c.prefix) done.push('removed the data: prefix');
  if (c.quotes) done.push('removed quotes and JSON escapes');
  if (c.whitespace) done.push('ignored line breaks and spaces');
  if (c.percent) done.push('decoded percent-escapes');
  if (c.urlSafe) done.push('translated the URL-safe alphabet');
  if (c.padding) done.push('restored the missing = padding');
  const notes: string[] = [];
  if (done.length) notes.push(`Cleaned up before decoding: ${done.join(', ')}.`);
  if (img.mismatch) notes.push(`The prefix said ${img.mismatch.claimed} but the bytes are ${img.mismatch.actual}; the download uses the real type.`);
  if (img.info.truncated) notes.push(`The data stops before the ${img.info.format.toUpperCase()} end-of-file marker, so the string was probably cut short. The browser may show only the top of the image.`);
  return notes.join(' ');
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');

  if (!raw.trim()) {
    clearPreview();
    setStatus(null);
    return;
  }

  const r = base64ToImage(raw);
  if (r.ok) {
    current = r.value;
    otherFile = null;
    trackRun('decode', true);
    preview.hidden = false;
    previewEmpty.hidden = true;
    preview.src = r.value.dataUri;
    outputStat.textContent = describe(r.value);
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
    downloadFileBtn.hidden = true;
    handoffTextBtn.hidden = true;
    const note = cleanupNote(r.value);
    setStatus(note ? (r.value.info.truncated || r.value.mismatch ? 'error' : 'ok') : null, note);
    return;
  }

  const kind = errorCategory(r.error);
  trackRun('decode', false, kind);
  clearPreview();
  setStatus('error', r.error);
  // The Base64 itself was fine but the bytes are not an image: still let them save it,
  // or, for text, hand the string to the tool that can show it.
  if (kind === 'text') {
    handoffTextBtn.hidden = false;
  } else if (kind === 'other_file' || kind === 'not_image') {
    const bytes = base64ToBytes(raw);
    if (bytes.ok) {
      const other = sniffOther(bytes.value.bytes);
      otherFile = { bytes: bytes.value.bytes, extension: other?.extension ?? 'bin', mime: other?.mime ?? 'application/octet-stream' };
      downloadFileBtn.textContent = `Download as .${otherFile.extension} anyway`;
      downloadFileBtn.hidden = false;
    }
  }
}

// A header can be intact while the rest is garbage; only the browser's decoder knows.
preview.addEventListener('error', () => {
  if (!current) return;
  track('tool_error', { action: 'decode', error_type: 'render' }, 'error');
  setStatus('error', `The bytes start like a ${current.info.format.toUpperCase()} but your browser could not render them — the data is probably corrupted or cut short. You can still download the file to inspect it.`);
});
preview.addEventListener('load', () => {
  if (current) outputStat.textContent = describe(current);
});

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

function saveBlob(bytes: Uint8Array, mime: string, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadImage() {
  if (!current) return showToast('Nothing to download yet');
  track('download_result', { target: 'image' });
  saveBlob(current.bytes, current.info.mime, `image.${current.info.extension}`);
}

function downloadFile() {
  if (!otherFile) return showToast('Nothing to download yet');
  track('download_result', { target: 'file' });
  saveBlob(otherFile.bytes, otherFile.mime, `decoded.${otherFile.extension}`);
}

async function copyDataUri() {
  if (!current) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'data_uri' });
  try {
    await navigator.clipboard.writeText(current.dataUri);
    showToast('Data URI copied');
  } catch {
    showToast('Copy failed — your browser blocked clipboard access');
  }
}

function setBackground(bg: string) {
  previewBox.className = `preview-box bg-${bg}`;
  for (const chip of bgChips) chip.setAttribute('aria-pressed', String(chip.dataset.bg === bg));
}

// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms and a multi-megabyte paste takes longer than that to
// decode synchronously. Chips re-render nothing, so they act immediately.
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
for (const chip of bgChips) {
  chip.addEventListener('click', () => {
    setBackground(chip.dataset.bg ?? 'checker');
    track('tool_option', { option: 'preview-bg', value: chip.dataset.bg ?? 'checker' }, `opt:bg:${chip.dataset.bg}`);
  });
}
downloadBtn.addEventListener('click', downloadImage);
downloadFileBtn.addEventListener('click', downloadFile);
copyBtn.addEventListener('click', copyDataUri);
pasteBtn.addEventListener('click', pasteFromClipboard);
handoffTextBtn.addEventListener('click', () => {
  track('navigation_click', { link_placement: 'handoff', link_to: '/tools/base64-encode-decode' });
  sendToTool(input.value, '/tools/base64-encode-decode');
});
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_PNG_DATA_URI;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    window.clearTimeout(renderTimer); // flush a pending debounced render first
    render();
    downloadImage();
  }
});

// Arriving from Image to Base64's "check it" button: the data URI is handed over in sessionStorage.
const incoming = receiveTransfer();
if (incoming) {
  inputSource = 'transfer';
  input.value = incoming;
}
render();
