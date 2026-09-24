import { dateDiff, formatCalendarDiff, type ZoneInterpretation } from '../../lib/date-diff';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const startInput = $<HTMLInputElement>('input-start');
const endInput = $<HTMLInputElement>('input-end');
const tz = $<HTMLSelectElement>('opt-tz');
const status = $('status');
const result = $('result');
const headline = $('headline');
const grid = $('grid');
const toast = $('toast');

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// No paste/drag-drop here — there are two separate date fields, so a single
// "Paste" button would be ambiguous about which one it targets.

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the text a visitor typed. This
// tool has two free-text inputs rather than one; input_size buckets their
// combined length, and inputSource tracks whichever field was last touched.
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
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(startInput.value.length + endInput.value.length) }, 'use');
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
for (const field of [startInput, endInput]) {
  field.addEventListener('paste', () => { justPasted = true; });
  field.addEventListener('input', () => { inputSource = justPasted ? 'pasted' : 'typed'; justPasted = false; });
}

function gridRow(label: string, value: string): string {
  return `<div class="item"><span class="k">${label}</span><span class="v">${value}</span></div>`;
}

function render() {
  const startRaw = startInput.value;
  const endRaw = endInput.value;

  if (!startRaw.trim() || !endRaw.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }

  const r = dateDiff(startRaw, endRaw, tz.value as ZoneInterpretation);
  trackRun(
    'diff',
    r.ok,
    r.ok
      ? undefined
      : /Enter both/.test(r.error) ? 'empty'
        : /Could not parse/.test(r.error) ? 'syntax'
          : /too large|outside the range/.test(r.error) ? 'range'
            : 'other',
  );

  if (!r.ok) {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = r.error;
    result.hidden = true;
    return;
  }

  status.hidden = true;
  result.hidden = false;
  const v = r.value;
  const directionNote = v.endBeforeStart ? ' (end is before start, showing the gap between them)' : '';
  headline.textContent = formatCalendarDiff(v.calendar) + directionNote;
  grid.innerHTML = [
    gridRow('Total days', plural(v.totalDays, 'day')),
    gridRow('Total weeks', plural(v.totalWeeks, 'week')),
    gridRow('Total hours', v.totalHours.toLocaleString()),
    gridRow('Total minutes', v.totalMinutes.toLocaleString()),
    gridRow('Total seconds', v.totalSeconds.toLocaleString()),
    gridRow('Weekdays (Mon-Fri)', plural(v.weekdays, 'day')),
  ].join('');
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyResult() {
  if (!headline.textContent) return showToast('Nothing to copy yet');
  const lines = [headline.textContent, ...[...grid.querySelectorAll('.item')].map((el) => `${el.querySelector('.k')?.textContent}: ${el.querySelector('.v')?.textContent}`)];
  const text = lines.join('\n');
  track('copy_result', { target: 'output' });
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    showToast('Copy failed: your browser blocked clipboard access');
  }
}

$('btn-swap').addEventListener('click', () => {
  track('tool_option', { option: 'swap', value: '(text)' }, 'opt:swap');
  const a = startInput.value;
  startInput.value = endInput.value;
  endInput.value = a;
  render();
});
$('btn-now').addEventListener('click', () => {
  inputSource = 'sample';
  endInput.value = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  render();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  startInput.value = '2025-01-15';
  endInput.value = '2025-06-01T14:30:00';
  render();
});
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  startInput.value = '';
  endInput.value = '';
  render();
  startInput.focus();
});
$('btn-copy').addEventListener('click', () => void copyResult());
tz.addEventListener('change', () => {
  trackOption(tz);
  render();
});
startInput.addEventListener('input', render);
endInput.addEventListener('input', render);

// UX-013: Ctrl+Enter / Cmd+Enter to copy, matching every other tool's shortcut —
// bound to both date fields since either could be the one focused.
function onDateKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    render();
    void copyResult();
  }
}
startInput.addEventListener('keydown', onDateKeydown);
endInput.addEventListener('keydown', onDateKeydown);

render();
