import { parseDimension, computeAspectRatio, scaleToWidth, scaleToHeight, SAMPLE_WIDTH, SAMPLE_HEIGHT, type RatioInfo } from '../../lib/aspect-ratio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const widthInput = $<HTMLInputElement>('input-width');
const heightInput = $<HTMLInputElement>('input-height');
const status = $('status');
const result = $('result');
const headline = $('headline');
const match = $('match');
const grid = $('grid');
const scaleWidthInput = $<HTMLInputElement>('input-scale-width');
const scaleHeightInput = $<HTMLInputElement>('input-scale-height');
const resGrid = $('res-grid');
const toast = $('toast');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

let current: RatioInfo | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Trim to at most 2 decimal places without padding whole numbers with ".00". */
function formatNumber(n: number): string {
  return Number(n.toFixed(2)).toString();
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
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(widthInput.value.length + heightInput.value.length) }, 'use');
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
for (const field of [widthInput, heightInput]) {
  field.addEventListener('paste', () => { justPasted = true; });
  field.addEventListener('input', () => { inputSource = justPasted ? 'pasted' : 'typed'; justPasted = false; });
}

function gridRow(label: string, value: string): string {
  return `<div class="item"><span class="k">${label}</span><span class="v">${escapeHtml(value)}</span></div>`;
}

function render() {
  const wRaw = widthInput.value;
  const hRaw = heightInput.value;

  if (!wRaw.trim() || !hRaw.trim()) {
    status.hidden = true;
    result.hidden = true;
    current = null;
    return;
  }

  const w = parseDimension(wRaw, 'width');
  const h = parseDimension(hRaw, 'height');
  const parsed = !w.ok ? w : !h.ok ? h : null;
  const r = parsed ? { ok: false as const, error: parsed.error } : computeAspectRatio((w as { ok: true; value: number }).value, (h as { ok: true; value: number }).value, wRaw.trim(), hRaw.trim());

  trackRun(
    'ratio',
    r.ok,
    r.ok
      ? undefined
      : /Enter a/.test(r.error) && /greater than 0/.test(r.error) ? 'range'
        : /not a valid/.test(r.error) ? 'syntax'
          : /finite/.test(r.error) ? 'range'
            : 'other',
  );

  if (!r.ok) {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = r.error;
    result.hidden = true;
    current = null;
    return;
  }

  status.hidden = true;
  result.hidden = false;
  current = r.value;
  const v = r.value;

  headline.textContent = `${v.ratioW}:${v.ratioH}`;
  match.textContent = v.knownName ? `Matches ${v.knownName}.` : 'No common name for this exact ratio.';
  grid.innerHTML = [
    gridRow('Decimal ratio', `${formatNumber(v.decimal)} : 1`),
    gridRow('CSS padding-hack %', `${formatNumber(v.percentage)}%`),
    gridRow('Orientation', v.orientation[0].toUpperCase() + v.orientation.slice(1)),
  ].join('');

  resGrid.innerHTML = v.standardResolutions
    .map((res) => {
      const text = `${res.width} × ${res.height}`;
      return `<button type="button" class="cc-row" data-copy="res" data-value="${escapeHtml(text)}">${escapeHtml(text)}</button>`;
    })
    .join('');

  refreshScaleForNewRatio();
}

/**
 * Recompute the *other* scale field from whichever one was just edited, so typing in height after
 * width already has a value updates width→height, not the reverse (a plain "whichever has a value
 * wins" check would always prefer width and silently ignore edits to height once both are filled).
 */
function updateScaleFrom(edited: 'width' | 'height') {
  if (!current) return;
  if (edited === 'width') {
    const targetW = Number(scaleWidthInput.value.trim());
    scaleHeightInput.value = scaleWidthInput.value.trim() && Number.isFinite(targetW) && targetW > 0
      ? formatNumber(scaleToWidth(targetW, current.ratioW, current.ratioH))
      : '';
  } else {
    const targetH = Number(scaleHeightInput.value.trim());
    scaleWidthInput.value = scaleHeightInput.value.trim() && Number.isFinite(targetH) && targetH > 0
      ? formatNumber(scaleToHeight(targetH, current.ratioW, current.ratioH))
      : '';
  }
}

/** After the base ratio changes, refresh the scale section from whichever field already has a value. */
function refreshScaleForNewRatio() {
  if (scaleWidthInput.value.trim()) updateScaleFrom('width');
  else if (scaleHeightInput.value.trim()) updateScaleFrom('height');
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyText(text: string, label: string) {
  track('copy_result', { target: label });
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    showToast('Copy failed: your browser blocked clipboard access');
  }
}

$('btn-copy').addEventListener('click', () => {
  if (!current) return void showToast('Nothing to copy yet');
  const lines = [
    headline.textContent ?? '',
    match.textContent ?? '',
    ...[...grid.querySelectorAll('.item')].map((el) => `${el.querySelector('.k')?.textContent}: ${el.querySelector('.v')?.textContent}`),
  ];
  void copyText(lines.join('\n'), 'output');
});

resGrid.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cc-row[data-copy]');
  if (btn) void copyText(btn.dataset.value ?? '', 'resolution');
});

$('btn-swap').addEventListener('click', () => {
  trackOption($<HTMLButtonElement>('btn-swap'));
  const a = widthInput.value;
  widthInput.value = heightInput.value;
  heightInput.value = a;
  scaleWidthInput.value = '';
  scaleHeightInput.value = '';
  render();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  widthInput.value = SAMPLE_WIDTH;
  heightInput.value = SAMPLE_HEIGHT;
  scaleWidthInput.value = '';
  scaleHeightInput.value = '';
  render();
});
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  widthInput.value = '';
  heightInput.value = '';
  scaleWidthInput.value = '';
  scaleHeightInput.value = '';
  render();
  widthInput.focus();
});

widthInput.addEventListener('input', render);
heightInput.addEventListener('input', render);
scaleWidthInput.addEventListener('input', () => updateScaleFrom('width'));
scaleHeightInput.addEventListener('input', () => updateScaleFrom('height'));
scaleWidthInput.addEventListener('change', () => trackOption(scaleWidthInput));
scaleHeightInput.addEventListener('change', () => trackOption(scaleHeightInput));

// UX-013: Ctrl+Enter / Cmd+Enter to copy, matching every other tool's shortcut.
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    $('btn-copy').click();
  }
}
widthInput.addEventListener('keydown', onKeydown);
heightInput.addEventListener('keydown', onKeydown);

render();
