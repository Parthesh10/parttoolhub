import { dedupeLines, type DedupeOptions } from '../../lib/dedupe-lines';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const toast = $('toast');

const ignoreCase = $<HTMLInputElement>('opt-ignorecase');
const trim = $<HTMLInputElement>('opt-trim');
const removeBlank = $<HTMLInputElement>('opt-blank');
const onlyDuplicates = $<HTMLInputElement>('opt-onlydup');
const keep = $<HTMLSelectElement>('opt-keep');
const sort = $<HTMLSelectElement>('opt-sort');

const SAMPLE = ['apple', 'banana', 'Apple', 'cherry', 'banana', 'date'].join('\n');

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function render() {
  const raw = input.value;
  const lines = raw.length ? raw.split(/\r\n|\r|\n/).length : 0;
  inputStat.textContent = plural(lines, 'line');

  const opts: Partial<DedupeOptions> = {
    ignoreCase: ignoreCase.checked,
    trim: trim.checked,
    removeBlank: removeBlank.checked,
    onlyDuplicates: onlyDuplicates.checked,
    keep: keep.value as DedupeOptions['keep'],
    sort: sort.value as DedupeOptions['sort'],
  };
  const result = dedupeLines(raw, opts);
  output.value = result.output;
  outputStat.textContent =
    result.removed > 0 ? `${plural(result.unique, 'line')} · ${result.removed} removed` : plural(result.unique, 'line');
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
  a.download = 'unique-lines.txt';
  a.click();
  URL.revokeObjectURL(url);
}

for (const c of [ignoreCase, trim, removeBlank, onlyDuplicates, keep, sort]) c.addEventListener('input', render);
input.addEventListener('input', render);
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
