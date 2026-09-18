import { convertSize, formatSize, unitLabel, UNITS, type SizeBase, type SizeUnit } from '../../lib/data-size';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const status = $('status');
const grid = $('grid');
const note = $('note');
const toast = $('toast');
const unit = $<HTMLSelectElement>('opt-unit');
const baseDecimalBtn = $<HTMLButtonElement>('base-decimal');
const baseBinaryBtn = $<HTMLButtonElement>('base-binary');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

let base: SizeBase = 'decimal';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- UX-003: fullscreen / focus mode ---------------------------------------
function setFullscreen(on: boolean) {
  toolSection.classList.toggle('is-fullscreen', on);
  document.body.classList.toggle('no-scroll', on);
  fullscreenBtn.setAttribute('aria-pressed', String(on));
  fullscreenBtn.textContent = on ? '✕ Exit fullscreen' : '⛶ Fullscreen';
  track('tool_option', { option: 'fullscreen', value: String(on) });
}
fullscreenBtn.addEventListener('click', () => setFullscreen(!toolSection.classList.contains('is-fullscreen')));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && toolSection.classList.contains('is-fullscreen')) setFullscreen(false);
});

// --- UX-002: paste from clipboard -------------------------------------------
// No drag-and-drop here — this input is a single size value, not a file's
// worth of text, so a drop zone would be an affordance this tool doesn't need.
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return showToast('Clipboard is empty');
    inputSource = 'pasted';
    input.value = text;
    render();
  } catch {
    showToast('Clipboard permission denied; use Ctrl+V instead');
  }
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

function setBase(next: SizeBase) {
  base = next;
  baseDecimalBtn.setAttribute('aria-pressed', String(next === 'decimal'));
  baseBinaryBtn.setAttribute('aria-pressed', String(next === 'binary'));
  track('tool_option', { option: 'base', value: next }, 'opt:base');
  render();
}

function render() {
  const raw = input.value;
  inputStat.textContent = raw.trim() ? '' : 'Enter a size';

  if (!raw.trim()) {
    status.hidden = true;
    grid.hidden = true;
    note.hidden = true;
    return;
  }

  const amount = Number(raw.trim());
  const fromUnit = unit.value as SizeUnit;
  const result = convertSize(amount, fromUnit, base);
  trackRun(
    'convert',
    result.ok,
    result.ok
      ? undefined
      : /Enter a number/.test(result.error) ? 'syntax'
        : /zero or more/.test(result.error) ? 'negative'
          : /too large/.test(result.error) ? 'overflow'
            : 'other',
  );

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

  const rows: { key: string; label: string; value: string }[] = UNITS.map((u) => {
    const label = unitLabel(u, base);
    const value = formatSize(result.value.values[u]);
    return { key: u, label, value: `${value} ${label}` };
  });
  rows.push({ key: 'bit', label: 'Bits', value: `${formatSize(result.value.bits)} bit` });

  grid.innerHTML = rows
    .map((r) => {
      const safe = escapeHtml(r.value);
      const current = r.key === fromUnit ? ' is-current' : '';
      return `<button type="button" class="cc-row${current}" data-copy="${r.key}" data-value="${safe}">
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
    showToast('Could not copy; select the text manually');
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
unit.addEventListener('input', render);
unit.addEventListener('change', () => trackOption(unit));
baseDecimalBtn.addEventListener('click', () => setBase('decimal'));
baseBinaryBtn.addEventListener('click', () => setBase('binary'));
pasteBtn.addEventListener('click', pasteFromClipboard);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = '1500';
  render();
});

render();
