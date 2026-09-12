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

const SAMPLE = '{"name":"Ada Lovelace","born":1815,"active":true,"tags":["mathematician","writer"],"address":{"city":"London","country":"UK"}}';

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function setMode(next: 'format' | 'minify') {
  mode = next;
  modeFormatBtn.setAttribute('aria-pressed', String(next === 'format'));
  modeMinifyBtn.setAttribute('aria-pressed', String(next === 'minify'));
  indent.disabled = next === 'minify';
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
input.addEventListener('input', render);
indent.addEventListener('input', render);
sortKeys.addEventListener('input', render);
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
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    copyOutput();
  }
});

render();
