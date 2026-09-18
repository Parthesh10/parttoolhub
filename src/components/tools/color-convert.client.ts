import { parseColor, rgbToHex, formatRgb, formatHsl, contrastRatio, SAMPLE_COLOR, type Rgba } from '../../lib/color-convert';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const status = $('status');
const grid = $('grid');
const note = $('note');
const swatch = $('swatch');
const toast = $('toast');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

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
// No drag-and-drop here — this input is a single color value, not a file's
// worth of text, so a drop zone would be an affordance this tool doesn't need.
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return showToast('Clipboard is empty');
    inputSource = 'pasted';
    input.value = text;
    render();
  } catch {
    showToast('Clipboard permission denied — use Ctrl+V instead');
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

function wcagLabel(ratio: number): { text: string; cls: 'pass' | 'fail' } {
  if (ratio >= 7) return { text: `${ratio} (AAA)`, cls: 'pass' };
  if (ratio >= 4.5) return { text: `${ratio} (AA)`, cls: 'pass' };
  return { text: `${ratio} (fails AA)`, cls: 'fail' };
}

function render() {
  const raw = input.value;
  inputStat.textContent = raw.trim() ? '' : 'Paste a color';
  swatch.hidden = true;

  if (!raw.trim()) {
    status.hidden = true;
    grid.hidden = true;
    note.hidden = true;
    return;
  }

  const result = parseColor(raw);
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
  const color = result.value;
  swatch.hidden = false;
  // The checkerboard behind semi-transparent colors comes from the CSS
  // class's background-image; background-color paints beneath it, so only
  // setting the color here is enough to show alpha correctly.
  swatch.style.backgroundColor = formatRgb(color);

  const onBlack = contrastRatio(color, BLACK);
  const onWhite = contrastRatio(color, WHITE);
  const recommended = onWhite >= onBlack ? 'White' : 'Black';

  type Row = { label: string; value: string; copyKey?: string; cls?: string };
  const rows: Row[] = [
    { label: 'HEX', value: rgbToHex(color), copyKey: 'hex' },
    { label: 'RGB', value: formatRgb(color), copyKey: 'rgb' },
    { label: 'HSL', value: formatHsl(color), copyKey: 'hsl' },
    { label: 'Contrast on black text', value: wcagLabel(onBlack).text, cls: wcagLabel(onBlack).cls },
    { label: 'Contrast on white text', value: wcagLabel(onWhite).text, cls: wcagLabel(onWhite).cls },
    { label: 'Best text color', value: recommended },
  ];

  grid.innerHTML = rows
    .map((r) => {
      const safe = escapeHtml(r.value);
      const copy = r.copyKey ? ` data-copy="${r.copyKey}" data-value="${safe}"` : '';
      const cls = `cc-row${r.copyKey ? '' : ' no-copy'}`;
      const vCls = r.cls ? ` ${r.cls}` : '';
      return `<button type="button" class="${cls}"${copy}${r.copyKey ? '' : ' disabled'}>
        <span class="k">${r.label}</span><span class="v${vCls}">${safe}</span>
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
pasteBtn.addEventListener('click', pasteFromClipboard);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_COLOR;
  render();
});

render();
