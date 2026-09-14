import { encodeBase64, decodeBase64 } from '../../lib/encoding';
import { receiveTransfer } from '../../lib/transfer';

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
  track('tool_option', { option: 'mode', value: next }, 'opt:mode');
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
    trackRun('encode', true);
  } else {
    const r = decodeBase64(raw);
    trackRun('decode', r.ok, r.ok ? undefined : (/alphabet/.test(r.error) ? 'alphabet' : /length/.test(r.error) ? 'length' : /UTF-8/.test(r.error) ? 'utf8' : 'other'));
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

modeEncodeBtn.addEventListener('click', () => setMode('encode'));
modeDecodeBtn.addEventListener('click', () => setMode('decode'));
$('btn-swap').addEventListener('click', () => {
  track('tool_option', { option: 'swap', value: 'swap' }, 'opt:swap');
  const prevOutput = output.value;
  setMode(mode === 'encode' ? 'decode' : 'encode');
  if (prevOutput) {
    input.value = prevOutput;
    render();
  }
});
// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms and large pastes can take longer than that to process
// synchronously. Option toggles still re-render immediately (one event, not a burst).
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
urlSafe.addEventListener('input', render);
noPadding.addEventListener('input', render);
for (const c of [urlSafe, noPadding]) c.addEventListener('change', () => trackOption(c));
$('btn-copy').addEventListener('click', copyOutput);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = mode === 'encode' ? 'Hello, world! 👋' : encodeBase64('Hello, world! 👋');
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

// Arriving from Base64 to Image's "Decode as text instead" button: the string is
// handed over in sessionStorage and this page opens in decode mode with it loaded.
const incoming = receiveTransfer();
if (incoming) {
  inputSource = 'transfer';
  input.value = incoming;
  setMode('decode');
} else {
  render();
}
