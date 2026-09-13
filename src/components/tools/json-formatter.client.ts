import { formatJson, minifyJson, type Indent } from '../../lib/json-format';

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

let mode: 'format' | 'minify' = 'format';

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

const SAMPLE = '{"name":"Ada Lovelace","born":1815,"active":true,"tags":["mathematician","writer"],"address":{"city":"London","country":"UK"}}';

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
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
  inputStat.textContent = plural(raw.length, 'character');

  if (!raw.trim()) {
    output.value = '';
    outputStat.textContent = '';
    status.hidden = true;
    return;
  }

  const opts = { indent: (indent.value === 'tab' ? 'tab' : Number(indent.value)) as Indent, sortKeys: sortKeys.checked };
  const result = mode === 'format' ? formatJson(raw, opts) : minifyJson(raw, { sortKeys: sortKeys.checked });

  trackRun(mode, result.ok, 'syntax');
  if (result.ok) {
    output.value = result.output;
    outputStat.textContent = `Valid ${result.kind} · ${plural(result.output.length, 'character')}`;
    status.hidden = true;
  } else {
    output.value = '';
    outputStat.textContent = 'Invalid JSON';
    status.hidden = false;
    status.className = 'status-banner is-error';
    const loc = result.line ? ` (line ${result.line}${result.column ? `, column ${result.column}` : ''})` : '';
    status.textContent = `${result.error}${loc}`;
  }
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
$('btn-copy').addEventListener('click', copyOutput);
$('btn-download').addEventListener('click', downloadOutput);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
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
