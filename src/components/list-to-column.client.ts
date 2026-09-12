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
}
input.addEventListener('input', render);
$('btn-copy').addEventListener('click', copyOutput);
$('btn-download').addEventListener('click', downloadOutput);
$('btn-to-list').addEventListener('click', () => {
  if (!output.value) return showToast('Nothing to join yet');
  sendToTool(output.value, '/column-to-comma-separated-list');
});
$('btn-clear').addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  input.value = SAMPLE;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    copyOutput();
  }
});

// Text handed over from the column-to-list tool, if any.
const incoming = receiveTransfer();
if (incoming) input.value = incoming;

render();
