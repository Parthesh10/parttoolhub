import { timestampToDate, dateToTimestamp, SAMPLE_EPOCH_SECONDS, SAMPLE_DATE_TIME, type TimestampBreakdown } from '../../lib/timestamp';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputLabel = $('input-label');
const inputStat = $('input-stat');
const output = $<HTMLTextAreaElement>('output');
const outputLabel = $('output-label');
const status = $('status');
const result = $('result');
const grid = $('grid');
const toast = $('toast');
const modeToDateBtn = $<HTMLButtonElement>('mode-to-date');
const modeToTimestampBtn = $<HTMLButtonElement>('mode-to-timestamp');
const unitField = $('unit-field');
const tzField = $('tz-field');
const unit = $<HTMLSelectElement>('opt-unit');
const tz = $<HTMLSelectElement>('opt-tz');

let mode: 'to-date' | 'to-timestamp' = 'to-date';

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

function setMode(next: 'to-date' | 'to-timestamp') {
  mode = next;
  modeToDateBtn.setAttribute('aria-pressed', String(next === 'to-date'));
  modeToTimestampBtn.setAttribute('aria-pressed', String(next === 'to-timestamp'));
  inputLabel.textContent = next === 'to-date' ? 'Unix timestamp' : 'Date and time';
  input.placeholder = next === 'to-date' ? '1736937000' : '2025-01-15T10:30:00';
  outputLabel.textContent = next === 'to-date' ? 'Date & time (UTC)' : 'Unix timestamp (seconds)';
  unitField.hidden = next !== 'to-date';
  tzField.hidden = next !== 'to-timestamp';
  track('tool_option', { option: 'mode', value: next }, 'opt:mode');
  render();
}

function gridRow(label: string, value: string): string {
  return `<div class="item"><span class="k">${label}</span><span class="v">${value}</span></div>`;
}

function showBreakdown(b: TimestampBreakdown) {
  result.hidden = false;
  status.hidden = true;
  output.value = mode === 'to-date' ? b.iso : String(b.epochSeconds);
  const rows = [
    gridRow('Unix seconds', String(b.epochSeconds)),
    gridRow('Unix milliseconds', String(b.epochMilliseconds)),
    gridRow('ISO 8601 (UTC)', b.iso),
    gridRow('UTC', b.utc),
    gridRow(`Local (${b.timeZone})`, b.local),
    gridRow('Relative', b.relative),
  ];
  grid.innerHTML = rows.join('');
}

function render() {
  const raw = input.value;
  inputStat.textContent = raw.trim() ? '' : (mode === 'to-date' ? 'Enter a Unix timestamp' : 'Enter a date and time');

  if (!raw.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }

  const r = mode === 'to-date' ? timestampToDate(raw, unit.value as 'auto' | 's' | 'ms') : dateToTimestamp(raw, tz.value as 'utc' | 'local');
  trackRun(
    'convert',
    r.ok,
    r.ok
      ? undefined
      : /plain integer/.test(r.error) ? 'format'
        : /too large to represent/.test(r.error) ? 'overflow'
          : /outside the range/.test(r.error) ? 'range'
            : /Could not parse/.test(r.error) ? 'syntax'
              : 'other',
  );

  if (r.ok) {
    showBreakdown(r.value);
  } else {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = r.error;
    result.hidden = true;
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
tz.addEventListener('input', render);
for (const c of [unit, tz]) c.addEventListener('change', () => trackOption(c));
modeToDateBtn.addEventListener('click', () => setMode('to-date'));
modeToTimestampBtn.addEventListener('click', () => setMode('to-timestamp'));
$('btn-copy').addEventListener('click', copyOutput);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = mode === 'to-date' ? SAMPLE_EPOCH_SECONDS : SAMPLE_DATE_TIME;
  render();
});
$('btn-now').addEventListener('click', () => {
  inputSource = 'sample'; // a generated value, not typed or pasted
  input.value = mode === 'to-date' ? String(Math.floor(Date.now() / 1000)) : new Date().toISOString().replace(/\.\d+Z$/, '');
  track('tool_option', { option: 'btn-now', value: '(text)' });
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

render();
