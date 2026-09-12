import { pythonToJson } from '../../lib/python-dict';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const indent = $<HTMLSelectElement>('opt-indent');
const sortKeys = $<HTMLInputElement>('opt-sort');

const SAMPLE = "{'name': 'Ada Lovelace', 'born': 1815, 'active': True, 'tags': ('math', 'writer'), 'ref': None}";

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
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

  const indentValue = indent.value === 'tab' ? 'tab' : (Number(indent.value) as 0 | 2 | 4);
  const result = pythonToJson(raw, { indent: indentValue, sortKeys: sortKeys.checked });

  if (result.ok) {
    output.value = result.output;
    outputStat.textContent = plural(result.output.length, 'character');
    status.hidden = true;
  } else {
    output.value = '';
    outputStat.textContent = 'Could not convert';
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = result.error;
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
