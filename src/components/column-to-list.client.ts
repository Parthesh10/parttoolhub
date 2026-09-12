import { columnToList, PRESETS, CUSTOM_DELIMITER, type ColumnToListOptions, type SortMode, type CaseMode } from '../lib/list-convert';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const toast = $('toast');

const delimiter = $<HTMLSelectElement>('opt-delimiter');
const delimiterCustom = $<HTMLInputElement>('opt-delimiter-custom');
const customField = $('custom-delim-field');
const itemPrefix = $<HTMLInputElement>('opt-item-prefix');
const itemSuffix = $<HTMLInputElement>('opt-item-suffix');
const listPrefix = $<HTMLInputElement>('opt-list-prefix');
const listSuffix = $<HTMLInputElement>('opt-list-suffix');
const trim = $<HTMLInputElement>('opt-trim');
const skipEmpty = $<HTMLInputElement>('opt-skip-empty');
const dedupe = $<HTMLInputElement>('opt-dedupe');
const dedupeCi = $<HTMLInputElement>('opt-dedupe-ci');
const reverse = $<HTMLInputElement>('opt-reverse');
const sort = $<HTMLSelectElement>('opt-sort');
const textCase = $<HTMLSelectElement>('opt-case');

const SAMPLE = ['Alice Johnson', 'Bob Smith', 'Charlie Nguyen', 'Diana Patel', 'Ethan Brooks'].join('\n');

function readOptions(): ColumnToListOptions {
  const delim = delimiter.value === CUSTOM_DELIMITER ? delimiterCustom.value : delimiter.value;
  return {
    delimiter: delim,
    itemPrefix: itemPrefix.value,
    itemSuffix: itemSuffix.value,
    listPrefix: listPrefix.value,
    listSuffix: listSuffix.value,
    trim: trim.checked,
    skipEmpty: skipEmpty.checked,
    dedupe: dedupe.checked,
    dedupeIgnoreCase: dedupeCi.checked,
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
  const lines = raw.length ? raw.split(/\r\n|\r|\n/).length : 0;
  inputStat.textContent = plural(lines, 'line');

  const result = columnToList(raw, readOptions());
  output.value = result.output;
  outputStat.textContent =
    result.dropped > 0
      ? `${plural(result.count, 'item')} · ${result.dropped} dropped`
      : plural(result.count, 'item');

  customField.hidden = delimiter.value !== CUSTOM_DELIMITER;
  dedupeCi.disabled = !dedupe.checked;
  highlightMatchingPreset();
}

/** Mark the preset chip whose settings equal the current wrapper/delimiter fields. */
function highlightMatchingPreset() {
  const o = readOptions();
  for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    const p = PRESETS.find((x) => x.id === chip.dataset.preset)!;
    const match =
      p.options.delimiter === o.delimiter &&
      (p.options.itemPrefix ?? '') === o.itemPrefix &&
      (p.options.itemSuffix ?? '') === o.itemSuffix &&
      (p.options.listPrefix ?? '') === o.listPrefix &&
      (p.options.listSuffix ?? '') === o.listSuffix;
    chip.setAttribute('aria-pressed', String(match));
  }
}

function applyPreset(id: string) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const o = p.options;
  const known = Array.from(delimiter.options).some((opt) => opt.value === o.delimiter);
  if (known) {
    delimiter.value = o.delimiter!;
  } else {
    delimiter.value = CUSTOM_DELIMITER;
    delimiterCustom.value = o.delimiter ?? '';
  }
  itemPrefix.value = o.itemPrefix ?? '';
  itemSuffix.value = o.itemSuffix ?? '';
  listPrefix.value = o.listPrefix ?? '';
  listSuffix.value = o.listSuffix ?? '';
  render();
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
  a.download = 'list.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// --- wiring -----------------------------------------------------------------

const controls = [
  delimiter, delimiterCustom, itemPrefix, itemSuffix, listPrefix, listSuffix,
  trim, skipEmpty, dedupe, dedupeCi, reverse, sort, textCase,
];
for (const c of controls) c.addEventListener('input', render);
input.addEventListener('input', render);

document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((chip) =>
  chip.addEventListener('click', () => applyPreset(chip.dataset.preset!)),
);

$('btn-copy').addEventListener('click', copyOutput);
$('btn-download').addEventListener('click', downloadOutput);
$('btn-clear').addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  input.value = SAMPLE;
  render();
});
$('btn-swap').addEventListener('click', () => {
  if (!output.value) return showToast('Nothing to move yet');
  input.value = output.value;
  render();
  showToast('Result moved to input');
});

// Ctrl/Cmd + Enter copies — handy when the cursor is still in the input box.
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    copyOutput();
  }
});

render();
