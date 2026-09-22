import { diffJson, SAMPLE_OLD, SAMPLE_NEW, type JsonChange } from '../../lib/json-diff';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const inputOld = $<HTMLTextAreaElement>('input-old');
const inputNew = $<HTMLTextAreaElement>('input-new');
const statOld = $('stat-old');
const statNew = $('stat-new');
const status = $('status');
const result = $('result');
const stats = $('stats');
const changesEl = $('changes');
const prettyOld = $('pretty-old');
const prettyNew = $('pretty-new');
const prettyPanes = $('pretty-panes');
const togglePrettyBtn = $<HTMLButtonElement>('btn-toggle-pretty');
const toast = $('toast');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

let lastChanges: JsonChange[] | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A short, single-line preview of a value for the change list; full value is in the title tooltip. */
function formatValue(v: unknown): string {
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
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
function trackRun(ok: boolean, errorType = 'unknown') {
  track('tool_use', { action: 'diff', success: ok, input_source: inputSource, input_size: sizeBucket(inputOld.value.length + inputNew.value.length) }, 'use');
  if (ok) track('tool_result', { action: 'diff' }, 'result');
  else track('tool_error', { action: 'diff', error_type: errorType }, 'error');
}
function trackOption(el: HTMLButtonElement) {
  track('tool_option', { option: el.id || 'unknown', value: '(text)' }, `opt:${el.id}`);
}
for (const field of [inputOld, inputNew]) {
  field.addEventListener('paste', () => { justPasted = true; });
  field.addEventListener('input', () => { inputSource = justPasted ? 'pasted' : 'typed'; justPasted = false; });
}

function updateCharStat() {
  statOld.textContent = inputOld.value ? `${inputOld.value.length.toLocaleString()} characters` : '';
  statNew.textContent = inputNew.value ? `${inputNew.value.length.toLocaleString()} characters` : '';
}

function changeRow(c: JsonChange): string {
  if (c.type === 'added') return `<div class="jd-row jd-added"><span class="jd-badge">+ added</span><span class="jd-path">${escapeHtml(c.path)}</span><span class="jd-val" title="${escapeHtml(JSON.stringify(c.value) ?? 'undefined')}">${escapeHtml(formatValue(c.value))}</span></div>`;
  if (c.type === 'removed') return `<div class="jd-row jd-removed"><span class="jd-badge">- removed</span><span class="jd-path">${escapeHtml(c.path)}</span><span class="jd-val" title="${escapeHtml(JSON.stringify(c.value) ?? 'undefined')}">${escapeHtml(formatValue(c.value))}</span></div>`;
  return `<div class="jd-row jd-changed"><span class="jd-badge">~ changed</span><span class="jd-path">${escapeHtml(c.path)}</span><span class="jd-val-old">${escapeHtml(formatValue(c.oldValue))}</span><span class="jd-arrow">→</span><span class="jd-val-new">${escapeHtml(formatValue(c.newValue))}</span></div>`;
}

function render() {
  updateCharStat();
  lastChanges = null;

  if (!inputOld.value.trim() && !inputNew.value.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }

  const r = diffJson(inputOld.value, inputNew.value);
  trackRun(
    r.ok,
    r.ok
      ? undefined
      : /Paste the/.test(r.error) ? 'empty'
        : /too deeply/.test(r.error) ? 'range'
          : 'syntax',
  );

  if (!r.ok) {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = `${r.side === 'old' ? 'Original' : 'Changed'} JSON: ${r.error}${r.line ? ` (line ${r.line}, column ${r.column})` : ''}`;
    result.hidden = true;
    return;
  }

  status.hidden = true;
  result.hidden = false;
  lastChanges = r.value.changes;
  prettyOld.textContent = r.value.oldPretty;
  prettyNew.textContent = r.value.newPretty;

  if (r.value.stats.identical) {
    stats.textContent = 'No differences: the two JSON documents are structurally identical.';
    changesEl.innerHTML = '';
    return;
  }
  stats.textContent = `${r.value.stats.added} added, ${r.value.stats.removed} removed, ${r.value.stats.changed} changed`;
  changesEl.innerHTML = r.value.changes.map(changeRow).join('');
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyResult() {
  if (!lastChanges) return showToast('Nothing to copy yet');
  if (lastChanges.length === 0) {
    track('copy_result', { target: 'output' });
    await navigator.clipboard.writeText('No differences.');
    return showToast('Copied to clipboard');
  }
  const lines = lastChanges.map((c) =>
    c.type === 'added' ? `+ added   ${c.path}: ${formatValue(c.value)}`
      : c.type === 'removed' ? `- removed ${c.path}: ${formatValue(c.value)}`
        : `~ changed ${c.path}: ${formatValue(c.oldValue)} -> ${formatValue(c.newValue)}`,
  );
  track('copy_result', { target: 'output' });
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast('Copied to clipboard');
  } catch {
    showToast('Copy failed: your browser blocked clipboard access');
  }
}

async function pasteInto(field: HTMLTextAreaElement) {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return showToast('Clipboard is empty');
    inputSource = 'pasted';
    field.value = text;
    render();
  } catch {
    showToast('Clipboard permission denied; use Ctrl+V instead');
  }
}

let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
inputOld.addEventListener('input', scheduleRender);
inputNew.addEventListener('input', scheduleRender);
$('btn-paste-old').addEventListener('click', () => pasteInto(inputOld));
$('btn-paste-new').addEventListener('click', () => pasteInto(inputNew));
$('btn-swap').addEventListener('click', () => {
  trackOption($<HTMLButtonElement>('btn-swap'));
  const a = inputOld.value;
  inputOld.value = inputNew.value;
  inputNew.value = a;
  render();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  inputOld.value = SAMPLE_OLD;
  inputNew.value = SAMPLE_NEW;
  render();
});
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  inputOld.value = '';
  inputNew.value = '';
  render();
  inputOld.focus();
});
$('btn-copy').addEventListener('click', () => void copyResult());
togglePrettyBtn.addEventListener('click', () => {
  const next = prettyPanes.hidden;
  prettyPanes.hidden = !next;
  togglePrettyBtn.setAttribute('aria-pressed', String(next));
  togglePrettyBtn.setAttribute('aria-expanded', String(next));
  togglePrettyBtn.textContent = next ? 'Hide full pretty-printed JSON' : 'Show full pretty-printed JSON (both sides)';
  trackOption(togglePrettyBtn);
});

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void copyResult();
  }
}
inputOld.addEventListener('keydown', onKeydown);
inputNew.addEventListener('keydown', onKeydown);

render();
