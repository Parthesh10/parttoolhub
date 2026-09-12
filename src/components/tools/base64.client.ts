import { encodeBase64, decodeBase64 } from '../../lib/encoding';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputLabel = $('input-label');
const outputLabel = $('output-label');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const modeEncodeBtn = $<HTMLButtonElement>('mode-encode');
const modeDecodeBtn = $<HTMLButtonElement>('mode-decode');
const encodeOptions = $('encode-options');
const urlSafe = $<HTMLInputElement>('opt-urlsafe');
const noPadding = $<HTMLInputElement>('opt-nopad');

let mode: 'encode' | 'decode' = 'encode';

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function setMode(next: 'encode' | 'decode') {
  mode = next;
  modeEncodeBtn.setAttribute('aria-pressed', String(next === 'encode'));
  modeDecodeBtn.setAttribute('aria-pressed', String(next === 'decode'));
  inputLabel.textContent = next === 'encode' ? 'Plain text' : 'Base64';
  outputLabel.textContent = next === 'encode' ? 'Base64' : 'Plain text';
  encodeOptions.hidden = next === 'decode';
  render();
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');

  if (!raw) {
    output.value = '';
    outputStat.textContent = '';
    status.hidden = true;
    return;
  }

  if (mode === 'encode') {
    const out = encodeBase64(raw, { urlSafe: urlSafe.checked, noPadding: noPadding.checked });
    output.value = out;
    outputStat.textContent = plural(out.length, 'character');
    status.hidden = true;
  } else {
    const r = decodeBase64(raw);
    if (r.ok) {
      output.value = r.output;
      outputStat.textContent = plural(r.output.length, 'character');
      status.hidden = true;
    } else {
      output.value = '';
      outputStat.textContent = '';
      status.hidden = false;
      status.className = 'status-banner is-error';
      status.textContent = r.error;
    }
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

modeEncodeBtn.addEventListener('click', () => setMode('encode'));
modeDecodeBtn.addEventListener('click', () => setMode('decode'));
$('btn-swap').addEventListener('click', () => {
  const prevOutput = output.value;
  setMode(mode === 'encode' ? 'decode' : 'encode');
  if (prevOutput) {
    input.value = prevOutput;
    render();
  }
});
input.addEventListener('input', render);
urlSafe.addEventListener('input', render);
noPadding.addEventListener('input', render);
$('btn-copy').addEventListener('click', copyOutput);
$('btn-clear').addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  input.value = mode === 'encode' ? 'Hello, world! 👋' : encodeBase64('Hello, world! 👋');
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    copyOutput();
  }
});

render();
