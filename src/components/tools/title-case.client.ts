import { convertCase, type CaseMode, type TitleStyle } from '../../lib/title-case';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const toast = $('toast');
const mode = $<HTMLSelectElement>('opt-mode');
const style = $<HTMLSelectElement>('opt-style');
const styleField = $('style-field');
const preserve = $<HTMLInputElement>('opt-preserve');

const SAMPLE = 'the lord of the rings: the fellowship of the ring';

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');
  styleField.hidden = mode.value !== 'title';

  const result = convertCase(raw, mode.value as CaseMode, {
    style: style.value as TitleStyle,
    preserveIntentionalCase: preserve.checked,
  });
  output.value = result;
  outputStat.textContent = plural(result.length, 'character');
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

for (const c of [mode, style, preserve]) c.addEventListener('input', render);
input.addEventListener('input', render);
$('btn-copy').addEventListener('click', copyOutput);
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
