import { parseNumber, toDigits, toPrefixed, twosComplement, SAMPLE_INPUT, type Base, type BitWidth } from '../../lib/base-convert';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const status = $('status');
const grid = $('grid');
const note = $('note');
const toast = $('toast');
const fromBase = $<HTMLSelectElement>('opt-from');
const twos = $<HTMLInputElement>('opt-twos');
const widthRow = $('width-row');
const width = $<HTMLSelectElement>('opt-width');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

function render() {
  const raw = input.value;
  inputStat.textContent = raw.trim() ? '' : 'Enter a number';
  widthRow.hidden = !twos.checked;

  if (!raw.trim()) {
    status.hidden = true;
    grid.hidden = true;
    note.hidden = true;
    return;
  }

  const fromValue = fromBase.value === 'auto' ? 'auto' : (Number(fromBase.value) as Base);
  const result = parseNumber(raw, fromValue);
  trackRun('convert', result.ok, result.ok ? undefined : 'syntax');

  if (!result.ok) {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = result.error;
    grid.hidden = true;
    note.hidden = true;
    return;
  }

  status.hidden = true;
  grid.hidden = false;
  note.hidden = false;
  const { value } = result.value;

  type Row = { label: string; value: string; copyKey?: string };
  const rows: Row[] = [
    { label: 'Binary', value: toPrefixed(value, 2), copyKey: 'binary' },
    { label: 'Octal', value: toPrefixed(value, 8), copyKey: 'octal' },
    { label: 'Decimal', value: toDigits(value, 10), copyKey: 'decimal' },
    { label: 'Hexadecimal', value: toPrefixed(value, 16), copyKey: 'hex' },
  ];

  if (twos.checked && value < 0n) {
    const w = Number(width.value) as BitWidth;
    const tc = twosComplement(value, w);
    if (tc.ok) {
      rows[0] = { label: `Binary (${w}-bit two's complement)`, value: '0b' + tc.bits.toString(2).padStart(w, '0'), copyKey: 'binary' };
      rows[3] = { label: `Hex (${w}-bit two's complement)`, value: '0x' + tc.bits.toString(16).padStart(w / 4, '0'), copyKey: 'hex' };
    } else {
      rows.push({ label: 'Two’s complement', value: tc.error });
    }
  }

  grid.innerHTML = rows
    .map((r) => {
      const safe = escapeHtml(r.value);
      const copy = r.copyKey ? ` data-copy="${r.copyKey}" data-value="${safe}"` : ' disabled';
      const cls = `cc-row${r.copyKey ? '' : ' no-copy'}`;
      return `<button type="button" class="${cls}"${copy}>
        <span class="k">${escapeHtml(r.label)}</span><span class="v">${safe}</span>
      </button>`;
    })
    .join('');
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyRow(btn: HTMLButtonElement) {
  const value = btn.dataset.value ?? '';
  const key = btn.dataset.copy ?? 'unknown';
  if (!value) return;
  track('copy_result', { target: key });
  try {
    await navigator.clipboard.writeText(value);
    showToast('Copied to clipboard');
  } catch {
    showToast('Could not copy — select the text manually');
  }
}
grid.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cc-row[data-copy]');
  if (btn) copyRow(btn);
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
for (const c of [fromBase, twos, width]) c.addEventListener('input', render);
for (const c of [fromBase, twos, width]) c.addEventListener('change', () => trackOption(c));
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_INPUT;
  render();
});

render();
