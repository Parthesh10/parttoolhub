import { listToColumn, detectDelimiter, type ListToColumnOptions, type SortMode, type CaseMode } from '../lib/list-convert';
import { sendToTool, receiveTransfer } from '../lib/transfer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const detected = $('detected');
const toast = $('toast');

const delimiter = $<HTMLSelectElement>('opt-delimiter');
const delimiterCustom = $<HTMLInputElement>('opt-delimiter-custom');
const customField = $('custom-delim-field');
const trim = $<HTMLInputElement>('opt-trim');
const skipEmpty = $<HTMLInputElement>('opt-skip-empty');
const unquote = $<HTMLInputElement>('opt-unquote');
const dedupe = $<HTMLInputElement>('opt-dedupe');
const reverse = $<HTMLInputElement>('opt-reverse');
const sort = $<HTMLSelectElement>('opt-sort');
const textCase = $<HTMLSelectElement>('opt-case');

const SAMPLE = 'red, orange, yellow, green, blue, indigo, violet';

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

const DELIM_NAMES: Record<string, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '|': 'pipe',
  '\t': 'tab',
  '\n': 'new line',
  ' ': 'whitespace',
};

function readOptions(): ListToColumnOptions {
  const d = delimiter.value === '__custom__' ? delimiterCustom.value || 'auto' : delimiter.value;
  return {
    delimiter: d,
    trim: trim.checked,
    skipEmpty: skipEmpty.checked,
    unquote: unquote.checked,
    dedupe: dedupe.checked,
    reverse: reverse.checked,
    sort: sort.value as SortMode,
    textCase: textCase.value as CaseMode,
  };
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');

  const opts = readOptions();
  const result = listToColumn(raw, opts);
  if (raw.trim()) trackRun('split', true);
  output.value = result.output;
  outputStat.textContent =
    result.dropped > 0 ? `${plural(result.count, 'item')} · ${result.dropped} dropped` : plural(result.count, 'item');

  customField.hidden = delimiter.value !== '__custom__';
  if (opts.delimiter === 'auto' && raw.trim()) {
    const d = detectDelimiter(raw.trim());
    detected.textContent = `Detected: ${DELIM_NAMES[d] ?? JSON.stringify(d)}`;
  } else {
    detected.textContent = '';
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
  const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'column.txt';
  a.click();
  URL.revokeObjectURL(url);
}

for (const c of [delimiter, delimiterCustom, trim, skipEmpty, unquote, dedupe, reverse, sort, textCase]) {
  c.addEventListener('input', render);
  c.addEventListener('change', () => trackOption(c));
}
// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms and large pastes can take longer than that to process
// synchronously. Option toggles still re-render immediately (one event, not a burst).
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
$('btn-copy').addEventListener('click', copyOutput);
$('btn-download').addEventListener('click', downloadOutput);
$('btn-to-list').addEventListener('click', () => {
  if (!output.value) return showToast('Nothing to join yet');
  track('navigation_click', { link_placement: 'handoff', link_to: '/tools/column-to-comma-separated-list' });
  sendToTool(output.value, '/tools/column-to-comma-separated-list');
});
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

// Text handed over from the column-to-list tool, if any.
const incoming = receiveTransfer();
if (incoming) {
  input.value = incoming;
  inputSource = 'transfer';
}

render();
