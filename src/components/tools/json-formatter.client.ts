import { formatJson, minifyJson, parseJson, type Indent } from '../../lib/json-format';
import { renderJsonTree } from '../../lib/json-tree';
import { sendToTool } from '../../lib/transfer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const indent = $<HTMLSelectElement>('opt-indent');
const sortKeys = $<HTMLInputElement>('opt-sort');
const modeFormatBtn = $<HTMLButtonElement>('mode-format');
const modeMinifyBtn = $<HTMLButtonElement>('mode-minify');
const wrapBtn = $<HTMLButtonElement>('btn-wrap');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const inputGutter = $('input-gutter');
const outputGutter = $('output-gutter');
const outputCodeWrap = $('output-code-wrap');
const outputTree = $('output-tree');
const handoffActions = $('handoff-actions');
const handoffCsvBtn = $<HTMLButtonElement>('btn-handoff-csv');
const viewTextBtn = $<HTMLButtonElement>('view-text');
const viewTreeBtn = $<HTMLButtonElement>('view-tree');

let mode: 'format' | 'minify' = 'format';
let viewMode: 'text' | 'tree' = 'text';

// --- JSON-002: tree view -----------------------------------------------------
function setViewMode(next: 'text' | 'tree') {
  viewMode = next;
  viewTextBtn.setAttribute('aria-pressed', String(next === 'text'));
  viewTreeBtn.setAttribute('aria-pressed', String(next === 'tree'));
  outputCodeWrap.hidden = next === 'tree';
  outputTree.classList.toggle('is-visible', next === 'tree');
  track('tool_option', { option: 'view', value: next }, 'opt:view');
}
viewTextBtn.addEventListener('click', () => setViewMode('text'));
viewTreeBtn.addEventListener('click', () => setViewMode('tree'));

// --- JSON-003: JSONPath copy-on-click for tree leaves -----------------------
async function copyLeafPath(leaf: HTMLElement) {
  const path = leaf.dataset.path;
  if (!path) return;
  track('copy_result', { target: 'jsonpath' });
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    // Nothing to fall back to for a non-visible element (unlike the output textarea's
    // select()+execCommand fallback) — the toast below still confirms either way.
  }
  showToast(`Copied ${path}`);
  leaf.classList.add('jt-copied');
  window.setTimeout(() => leaf.classList.remove('jt-copied'), 400);
}
outputTree.addEventListener('click', (e) => {
  const leaf = (e.target as HTMLElement).closest<HTMLElement>('.jt-leaf');
  if (leaf) copyLeafPath(leaf);
});
outputTree.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const leaf = (e.target as HTMLElement).closest<HTMLElement>('.jt-leaf');
  if (!leaf) return;
  e.preventDefault(); // stop Space from scrolling the tree pane
  copyLeafPath(leaf);
});

// --- UX-005: gutter line numbers + active-line highlight --------------------
// Shared by both panes (bug report 2026-09-18: the input's gutter was correctly showing "1" for
// the single-line minified sample, but the formatted, genuinely multi-line Result pane had no
// gutter at all — every control here is parametrized so both get the same behaviour for free).
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

const SAMPLE = '{"name":"Ada Lovelace","born":1815,"active":true,"tags":["mathematician","writer"],"address":{"city":"London","country":"UK"}}';
// UX-007: below this, clearing is cheap to redo by pasting again — not worth interrupting for.
const CLEAR_CONFIRM_THRESHOLD = 500;

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
// UX-006: live micro-stats bar. Byte size is the UTF-8 encoded size (what actually gets
// downloaded/copied), not .length (a UTF-16 code-unit count) — they differ for non-ASCII input.
function formatBytes(text: string) {
  return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

function setMode(next: 'format' | 'minify') {
  mode = next;
  modeFormatBtn.setAttribute('aria-pressed', String(next === 'format'));
  modeMinifyBtn.setAttribute('aria-pressed', String(next === 'minify'));
  indent.disabled = next === 'minify';
  track('tool_option', { option: 'mode', value: next }, 'opt:mode');
  render();
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
    outputTree.innerHTML = '';
    outputStat.textContent = '';
    status.hidden = true;
    setErrorLocation();
    handoffActions.hidden = true;
    return;
  }

  const opts = { indent: (indent.value === 'tab' ? 'tab' : Number(indent.value)) as Indent, sortKeys: sortKeys.checked };
  const result = mode === 'format' ? formatJson(raw, opts) : minifyJson(raw, { sortKeys: sortKeys.checked });

  trackRun(mode, result.ok, 'syntax');
  if (result.ok) {
    output.value = result.output;
    updateGutterLines(output, outputGutter);
    outputStat.textContent = `Valid ${result.kind} · ${plural(result.output.split('\n').length, 'line')} · ${plural(result.output.length, 'character')} · ${formatBytes(result.output)}`;
    status.hidden = true;
    setErrorLocation();
    // Tree view renders the actual parsed value, not the re-serialised text — re-parsing here
    // (rather than threading the value out of formatJson/minifyJson) keeps json-format.ts's
    // public return shape unchanged for its other callers.
    const parsed = parseJson(raw);
    outputTree.innerHTML = parsed.ok ? renderJsonTree(parsed.value) : '';
    // UX-009: only offer the handoff when JSON to CSV could actually do something with it —
    // it requires a top-level array (an object or scalar errors immediately on arrival).
    handoffActions.hidden = result.kind !== 'array';
  } else {
    output.value = '';
    updateGutterLines(output, outputGutter);
    outputTree.innerHTML = '';
    outputStat.textContent = 'Invalid JSON';
    status.hidden = false;
    status.className = 'status-banner is-error';
    const loc = result.line ? ` (line ${result.line}${result.column ? `, column ${result.column}` : ''})` : '';
    status.textContent = `${result.error}${loc}`;
    setErrorLocation(result.line, result.column);
    handoffActions.hidden = true;
  }
}

// --- SITE-002: click the error banner to jump the cursor to that line/column ------
function setErrorLocation(line?: number, column?: number) {
  if (line) {
    status.dataset.errLine = String(line);
    status.dataset.errCol = String(column ?? 1);
    status.classList.add('is-clickable');
    status.setAttribute('role', 'button');
    status.setAttribute('tabindex', '0');
    status.title = 'Click to jump to this line';
  } else {
    delete status.dataset.errLine;
    delete status.dataset.errCol;
    status.classList.remove('is-clickable');
    status.removeAttribute('role');
    status.removeAttribute('tabindex');
    status.removeAttribute('title');
  }
}
function lineColToOffset(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + (column - 1);
}
function jumpToError() {
  const line = Number(status.dataset.errLine);
  if (!line) return;
  const column = Number(status.dataset.errCol) || 1;
  const offset = lineColToOffset(input.value, line, column);
  input.focus();
  input.setSelectionRange(offset, offset);
  updateActiveLine(input, inputGutter);
}
status.addEventListener('click', jumpToError);
status.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && status.classList.contains('is-clickable')) {
    e.preventDefault();
    jumpToError();
  }
});

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
    showToast('Copied to clipboard');
  } catch {
    output.select();
    document.execCommand('copy');
    showToast('Copied');
  }
}

function downloadOutput() {
  if (!output.value) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([output.value], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  a.click();
  URL.revokeObjectURL(url);
}

modeFormatBtn.addEventListener('click', () => setMode('format'));
modeMinifyBtn.addEventListener('click', () => setMode('minify'));
wrapBtn.addEventListener('click', () => {
  const next = wrapBtn.getAttribute('aria-pressed') !== 'true';
  wrapBtn.setAttribute('aria-pressed', String(next));
  output.classList.toggle('no-wrap', next);
  trackOption(wrapBtn, next ? 'no-wrap' : 'wrap');
});
// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms and large pastes can take longer than that to process
// synchronously. Option toggles still re-render immediately (one event, not a burst).
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
indent.addEventListener('input', render);
sortKeys.addEventListener('input', render);
for (const c of [indent, sortKeys]) c.addEventListener('change', () => trackOption(c));
pasteBtn.addEventListener('click', pasteFromClipboard);
handoffCsvBtn.addEventListener('click', () => {
  track('navigation_click', { link_placement: 'handoff', link_to: '/tools/json-to-csv-converter' });
  sendToTool(output.value, '/tools/json-to-csv-converter');
});
$('btn-copy').addEventListener('click', copyOutput);
$('btn-download').addEventListener('click', downloadOutput);
$('btn-clear').addEventListener('click', () => {
  if (input.value.length >= CLEAR_CONFIRM_THRESHOLD && !window.confirm('Clear the pasted input? This can\'t be undone.')) return;
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-reset-options').addEventListener('click', () => {
  // Not gated behind a confirm — unlike Clear, nothing here can lose pasted work.
  track('reset_tool');
  indent.value = '2';
  sortKeys.checked = false;
  if (wrapBtn.getAttribute('aria-pressed') === 'true') {
    wrapBtn.setAttribute('aria-pressed', 'false');
    output.classList.remove('no-wrap');
  }
  setViewMode('text');
  setMode('format');
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    window.clearTimeout(renderTimer); // flush a pending debounced render first
    render();
    copyOutput();
  }
});

render();
