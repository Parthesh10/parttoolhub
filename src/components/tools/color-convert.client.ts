import { parseColor, rgbToHex, formatRgb, formatHsl, contrastRatio, tintScale, SAMPLE_COLOR, type Rgba } from '../../lib/color-convert';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const status = $('status');
const grid = $('grid');
const result = $('result');
const preview = $('preview');
const tints = $('tints');
const picker = $<HTMLInputElement>('picker');
const badgeBlack = $('badge-black');
const badgeWhite = $('badge-white');
const toast = $('toast');
const pasteBtn = $<HTMLButtonElement>('btn-paste');

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

function wcagLabel(ratio: number): { text: string; cls: 'pass' | 'fail' } {
  if (ratio >= 7) return { text: `${ratio} (AAA)`, cls: 'pass' };
  if (ratio >= 4.5) return { text: `${ratio} (AA)`, cls: 'pass' };
  return { text: `${ratio} (fails AA)`, cls: 'fail' };
}

function render() {
  const raw = input.value;
  inputStat.textContent = raw.trim() ? '' : 'Paste a color, or pick one';

  if (!raw.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }

  const parsed = parseColor(raw);
  trackRun('convert', parsed.ok, parsed.ok ? undefined : 'syntax');

  if (!parsed.ok) {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = parsed.error;
    result.hidden = true;
    return;
  }

  status.hidden = true;
  result.hidden = false;
  const color = parsed.value;
  // The preview's ::before layer paints the colour over a checkerboard, so alpha shows as alpha.
  preview.style.setProperty('--cv-color', formatRgb(color));
  // The picker only understands opaque #rrggbb; alpha is dropped there but kept everywhere else.
  picker.value = rgbToHex({ ...color, a: 1 }).slice(0, 7).toLowerCase();

  const onBlack = contrastRatio(color, BLACK);
  const onWhite = contrastRatio(color, WHITE);
  const best = onWhite >= onBlack ? 'white' : 'black';
  // Contrast needs an opaque colour. For a translucent one the ratio is computed as if it were solid
  // (the real result depends on whatever sits behind it), and the badge says so.
  const asSolid = color.a < 1 ? ' (as solid)' : '';
  badgeBlack.textContent = `${wcagLabel(onBlack).text}${asSolid}${best === 'black' ? ' · best' : ''}`;
  badgeWhite.textContent = `${wcagLabel(onWhite).text}${asSolid}${best === 'white' ? ' · best' : ''}`;

  tints.innerHTML = tintScale(color)
    .map((t) => {
      const hex = rgbToHex(t.color);
      return `<button type="button" class="cv-tint${t.isBase ? ' is-base' : ''}" data-copy="tint" data-value="${escapeHtml(hex)}" aria-label="Copy ${escapeHtml(hex)}, lightness ${t.l}%"><span class="sw" style="background:${formatRgb(t.color)}"></span>${escapeHtml(hex)}</button>`;
    })
    .join('');

  type Row = { label: string; value: string; copyKey?: string; cls?: string };
  const rows: Row[] = [
    { label: 'HEX', value: rgbToHex(color), copyKey: 'hex' },
    { label: 'RGB', value: formatRgb(color), copyKey: 'rgb' },
    { label: 'HSL', value: formatHsl(color), copyKey: 'hsl' },
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
    showToast('Could not copy; select the text manually');
  }
}
result.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (btn) copyRow(btn);
});
// The native picker writes a #rrggbb into the input and converts it like a typed colour.
picker.addEventListener('input', () => {
  inputSource = 'typed';
  input.value = picker.value;
  scheduleRender();
});
picker.addEventListener('change', () => trackOption(picker, 'picker'));

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
