import { htmlToMarkdown, SAMPLE_HTML } from '../../lib/html-to-markdown';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const bullet = $<HTMLSelectElement>('opt-bullet');
const wrapBtn = $<HTMLButtonElement>('btn-wrap');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const inputGutter = $('input-gutter');
const outputGutter = $('output-gutter');

// --- UX-005: gutter line numbers + active-line highlight --------------------
function updateActiveLine(el: HTMLTextAreaElement, gutter: HTMLElement) {
  const lineIndex = el.value.slice(0, el.selectionStart).split('\n').length; // 1-based
  gutter.querySelector('.active')?.classList.remove('active');
  gutter.children[lineIndex - 1]?.classList.add('active');
}
function updateGutterLines(el: HTMLTextAreaElement, gutter: HTMLElement) {
  const lines = el.value.split('\n').length;
  if (gutter.children.length !== lines) {
    let html = '';
    for (let i = 1; i <= lines; i++) html += `<span>${i}</span>`;
    gutter.innerHTML = html; // resets scrollTop to 0, so re-sync it below
  }
  gutter.scrollTop = el.scrollTop;
  updateActiveLine(el, gutter);
}
input.addEventListener('scroll', () => { inputGutter.scrollTop = input.scrollTop; });
input.addEventListener('click', () => updateActiveLine(input, inputGutter));
input.addEventListener('keyup', () => updateActiveLine(input, inputGutter));
output.addEventListener('scroll', () => { outputGutter.scrollTop = output.scrollTop; });
output.addEventListener('click', () => updateActiveLine(output, outputGutter));
output.addEventListener('keyup', () => updateActiveLine(output, outputGutter));

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

// --- UX-002: paste from clipboard + drag-and-drop file upload -------------
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
input.addEventListener('dragover', (e) => {
  e.preventDefault();
  input.classList.add('drag-over');
});
input.addEventListener('dragleave', () => input.classList.remove('drag-over'));
input.addEventListener('drop', async (e) => {
  e.preventDefault();
  input.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const fileText = await file.text();
  inputSource = 'file';
  input.value = fileText;
  render();
});

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the text a visitor typed.
const fired = new Set<string>();
let inputSource: 'typed' | 'pasted' | 'sample' | 'transfer' | 'file' = 'typed';
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

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
// UX-006: byte size is the UTF-8 encoded size (what actually gets downloaded/copied), not
// .length (a UTF-16 code-unit count) — they differ for non-ASCII input.
function formatBytes(text: string) {
  return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

function setStatus(kind: 'error' | 'ok' | 'info' | null, text = '') {
  status.hidden = kind === null;
  status.className = `status-banner${kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : ''}`;
  status.textContent = text;
}

function render() {
  const raw = input.value;
  inputStat.textContent = raw.length
    ? `${plural(raw.split('\n').length, 'line')} · ${plural(raw.length, 'character')} · ${formatBytes(raw)}`
    : plural(raw.length, 'character');
  updateGutterLines(input, inputGutter);
  if (!raw.trim()) {
    output.value = '';
    updateGutterLines(output, outputGutter);
    outputStat.textContent = '';
    setStatus(null);
    return;
  }
  const r = htmlToMarkdown(raw, { bullet: bullet.value as '-' | '*' });
  trackRun('convert', true);
  output.value = r.markdown;
  updateGutterLines(output, outputGutter);
  const s = r.stats;
  const parts = [plural(s.words, 'word')];
  if (s.headings) parts.push(plural(s.headings, 'heading'));
  if (s.lists) parts.push(plural(s.lists, 'list'));
  if (s.tables) parts.push(plural(s.tables, 'table'));
  if (s.codeBlocks) parts.push(plural(s.codeBlocks, 'code block'));
  if (s.links) parts.push(plural(s.links, 'link'));
  if (s.images) parts.push(plural(s.images, 'image'));
  outputStat.textContent = parts.join(' · ');
  if (r.plain) setStatus('info', 'No HTML tags found: the input is treated as one paragraph of text, with Markdown-significant characters escaped.');
  else if (r.notes.length) setStatus('ok', r.notes.join(' '));
  else setStatus(null);
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyOutput() {
  if (!output.value) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'output' });
  try {
    await navigator.clipboard.writeText(output.value);
    showToast('Markdown copied');
  } catch {
    output.select();
    document.execCommand('copy');
    showToast('Copied');
  }
}

function downloadOutput() {
  if (!output.value) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([output.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.md';
  a.click();
  URL.revokeObjectURL(url);
}

// Typing is debounced so a keystroke never waits on the converter — the site's
// INP budget is < 200 ms and a large paste takes longer than that to process
// synchronously. Option changes re-render immediately (one event, not a burst).
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
bullet.addEventListener('input', render);
bullet.addEventListener('change', () => trackOption(bullet));
wrapBtn.addEventListener('click', () => {
  const next = wrapBtn.getAttribute('aria-pressed') !== 'true';
  wrapBtn.setAttribute('aria-pressed', String(next));
  output.classList.toggle('no-wrap', next);
  trackOption(wrapBtn, next ? 'no-wrap' : 'wrap');
});
pasteBtn.addEventListener('click', pasteFromClipboard);
$('btn-copy').addEventListener('click', () => void copyOutput());
$('btn-download').addEventListener('click', downloadOutput);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_HTML;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    window.clearTimeout(renderTimer);
    render();
    void copyOutput();
  }
});

render();
