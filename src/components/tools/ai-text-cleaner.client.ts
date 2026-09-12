import { cleanText, type DashMode } from '../../lib/text-clean';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const summary = $('summary');
const toast = $('toast');

const markdown = $<HTMLInputElement>('opt-markdown');
const bullets = $<HTMLInputElement>('opt-bullets');
const emdash = $<HTMLSelectElement>('opt-emdash');
const quotes = $<HTMLInputElement>('opt-quotes');
const ellipsis = $<HTMLInputElement>('opt-ellipsis');
const invisible = $<HTMLInputElement>('opt-invisible');
const citations = $<HTMLInputElement>('opt-citations');
const emoji = $<HTMLInputElement>('opt-emoji');
const whitespace = $<HTMLInputElement>('opt-whitespace');

const SAMPLE =
  '## Summary\n\nThis is **really** important — maybe the *most* important thing — so let’s be clear: it works.\n\n' +
  '* Point one\n* Point two[1]\n\nSee the docs for more[2, 3]…';

const CHANGE_LABELS: Record<string, string> = {
  markdown: 'Markdown removed',
  citations: 'citations removed',
  straightenQuotes: 'quotes straightened',
  emDash: 'dashes replaced',
  ellipsis: 'ellipses replaced',
  invisible: 'hidden characters removed',
  emoji: 'emoji removed',
  whitespace: 'whitespace tidied',
};

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');
  bullets.disabled = !markdown.checked;

  const result = cleanText(raw, {
    markdown: markdown.checked,
    normalizeBullets: bullets.checked,
    emDash: emdash.value as DashMode,
    straightenQuotes: quotes.checked,
    ellipsis: ellipsis.checked,
    invisible: invisible.checked,
    citations: citations.checked,
    emoji: emoji.checked,
    whitespace: whitespace.checked,
  });

  output.value = result.output;
  outputStat.textContent = plural(result.output.length, 'character');

  const applied = Object.keys(result.changes);
  summary.textContent = raw.trim()
    ? applied.length
      ? `Changed: ${applied.map((k) => CHANGE_LABELS[k] ?? k).join(', ')}`
      : 'No changes needed'
    : '';
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
  a.download = 'cleaned.txt';
  a.click();
  URL.revokeObjectURL(url);
}

for (const c of [markdown, bullets, emdash, quotes, ellipsis, invisible, citations, emoji, whitespace]) {
  c.addEventListener('input', render);
}
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
