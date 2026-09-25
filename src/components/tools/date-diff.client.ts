import { dateDiff, formatCalendarDiff, type ZoneInterpretation, timelineTicks } from '../../lib/date-diff';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const startInput = $<HTMLInputElement>('input-start');
const endInput = $<HTMLInputElement>('input-end');
const tz = $<HTMLSelectElement>('opt-tz');
const status = $('status');
const result = $('result');
const headline = $('headline');
const grid = $('grid');
const ticksEl = $('ticks');
const tlStart = $('tl-start');
const tlEnd = $('tl-end');
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
  const stats: [string, string, string][] = [
    ['days', v.totalDays.toLocaleString(), plural(v.totalDays, 'day')],
    ['weeks', v.totalWeeks.toLocaleString(), plural(v.totalWeeks, 'week')],
    ['weekdays', v.weekdays.toLocaleString(), `${plural(v.weekdays, 'weekday')} (Mon-Fri)`],
    ['hours', v.totalHours.toLocaleString(), `${v.totalHours.toLocaleString()} hours`],
    ['minutes', v.totalMinutes.toLocaleString(), `${v.totalMinutes.toLocaleString()} minutes`],
    ['seconds', v.totalSeconds.toLocaleString(), `${v.totalSeconds.toLocaleString()} seconds`],
  ];
  grid.innerHTML = stats
    .map(([key, num, text]) => {
      const word = text.slice(num.length).trim();
      return `<button type="button" class="dd-stat" data-copy="${key}" data-value="${escapeAttr(text)}" title="Copy"><b>${num}</b><span class="k">${escapeAttr(word)}</span></button>`;
    })
    .join('');
  drawTimeline(Date.parse(v.startISO), Date.parse(v.endISO));
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shortDate = (ms: number) => {
  const d = new Date(ms);
  const utc = tz.value === 'utc';
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const m = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utc ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
/** Ticks are placed by their share of the span; "today" is marked only when it falls inside it. */
function drawTimeline(aMs: number, bMs: number) {
  const start = Math.min(aMs, bMs);
  const end = Math.max(aMs, bMs);
  const pct = (ms: number) => ((ms - start) / (end - start)) * 100;
  const ticks = timelineTicks(start, end, tz.value as ZoneInterpretation);
  const now = Date.now();
  const todayPct = now > start && now < end ? pct(now) : null;
  // Labels closer than ~7% would overlap; keep the first of any crowded pair, and let the
  // "today" marker win over any calendar tick next to it.
  let lastPct = -100;
  const html = ticks
    .filter((t) => {
      if (todayPct !== null && Math.abs(pct(t.ms) - todayPct) < 7) return false;
      const ok = pct(t.ms) - lastPct >= 7;
      if (ok) lastPct = pct(t.ms);
      return ok;
    })
    .map((t) => `<div class="dd-tick" style="left:${pct(t.ms).toFixed(2)}%"><span>${escapeAttr(t.label)}</span></div>`);
  if (todayPct !== null) html.push(`<div class="dd-tick dd-today" style="left:${todayPct.toFixed(2)}%"><span>today</span></div>`);
  ticksEl.innerHTML = html.join('');
  tlStart.textContent = shortDate(start);
  tlEnd.textContent = shortDate(end);
}

// --- Redesign round 2: quick ranges ---------------------------------------------
// Dates are written as plain YYYY-MM-DD in the visitor's own calendar (their "today"), then
// interpreted like typed dates under the Interpret-as setting.
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((chip) =>
  chip.addEventListener('click', () => {
    const today = new Date();
    const y = today.getFullYear();
    const plusDays = (n: number) => new Date(y, today.getMonth(), today.getDate() + n);
    const ranges: Record<string, [string, string]> = {
      'to-year-end': [ymd(today), `${y}-12-31`],
      'from-year-start': [`${y}-01-01`, ymd(today)],
      'plus-30': [ymd(today), ymd(plusDays(30))],
      'plus-90': [ymd(today), ymd(plusDays(90))],
    };
    const r = ranges[chip.dataset.range ?? ''];
    if (!r) return;
    [startInput.value, endInput.value] = r;
    inputSource = 'sample';
    track('tool_option', { option: 'quick_range', value: chip.dataset.range ?? '' });
    render();
  }),
);
grid.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!btn) return;
  track('copy_result', { target: btn.dataset.copy ?? 'stat' });
  navigator.clipboard.writeText(btn.dataset.value ?? '').then(
    () => showToast('Copied to clipboard'),
    () => showToast('Could not copy; select the text manually'),
  );
});

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
