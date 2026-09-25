import { diffJson, SAMPLE_OLD, SAMPLE_NEW, type JsonChange } from '../../lib/json-diff';
import { diffText } from '../../lib/text-diff';
import { buildRows, foldRows, type DiffRow, type FoldRow } from '../../lib/diff-rows';
import { highlightJsonHtml } from '../../lib/json-highlight';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const inputOld = $<HTMLTextAreaElement>('input-old');
const inputNew = $<HTMLTextAreaElement>('input-new');
const statOld = $('stat-old');
const statNew = $('stat-new');
const status = $('status');
const result = $('result');
const stats = $('stats');
const changesEl = $('changes');
const gutterOld = $('gutter-old');
const gutterNew = $('gutter-new');
const filtersEl = $('filters');
const sideView = $('side-view');
const viewListBtn = $<HTMLButtonElement>('view-list');
const viewSideBtn = $<HTMLButtonElement>('view-side');
const toast = $('toast');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

let lastChanges: JsonChange[] | null = null;
let lastPretty: { old: string; new: string } | null = null;
let filter: 'all' | JsonChange['type'] = 'all';
let view: 'list' | 'side' = 'list';
const expandedFolds = new Set<number>();
const narrow = window.matchMedia('(max-width: 760px)');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A short, single-line preview of a value for the change list; full value is in the title tooltip. */
function formatValue(v: unknown): string {
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
}

// --- UX-005 + B7: input line numbers (same block as every other gutter tool) -----
function updateActiveLine(el: HTMLTextAreaElement, gutter: HTMLElement) {
  const lineIndex = el.value.slice(0, el.selectionStart).split('\n').length; // 1-based
  gutter.querySelector('.active')?.classList.remove('active');
  gutter.children[lineIndex - 1]?.classList.add('active');
}
// --- B7: gutter rows follow soft-wrapped lines -----------------------------
// Each number's row is made as tall as its line actually renders, so after a
// long line soft-wraps, the numbers below it stay level with their own lines
// instead of drifting one row per wrap. Heights come from an off-screen mirror
// of the textarea (same content width, font and wrapping). No-wrap mode and
// very large inputs keep plain one-row numbers. Duplicated per tool on purpose
// (no shared JS across tools, CLAUDE.md), like the rest of the gutter code.
const gutterWatched = new WeakSet<HTMLTextAreaElement>();
let gutterMirror: HTMLDivElement | undefined;
function sizeGutterRows(el: HTMLTextAreaElement, gutter: HTMLElement) {
  if (!gutterWatched.has(el)) {
    gutterWatched.add(el);
    const again = () => sizeGutterRows(el, gutter);
    new ResizeObserver(again).observe(el);
    new MutationObserver(again).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  const rows = gutter.children as HTMLCollectionOf<HTMLElement>;
  const cs = getComputedStyle(el);
  const lines = el.value.split('\n');
  if (cs.whiteSpace === 'pre' || el.clientWidth === 0 || lines.length > 5000 || el.value.length > 300_000) {
    for (let i = 0; i < rows.length; i++) rows[i].style.height = '';
    return;
  }
  if (!gutterMirror) {
    gutterMirror = document.createElement('div');
    gutterMirror.setAttribute('aria-hidden', 'true');
    gutterMirror.style.cssText =
      'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;';
    document.body.appendChild(gutterMirror);
  }
  const m = gutterMirror;
  m.style.width = `${el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`;
  m.style.font = cs.font;
  m.style.lineHeight = cs.lineHeight;
  m.style.letterSpacing = cs.letterSpacing;
  m.style.tabSize = cs.tabSize;
  m.replaceChildren(
    ...lines.map((line) => {
      const d = document.createElement('div');
      d.textContent = line || '\u200b';
      return d;
    }),
  );
  const measured = m.children as HTMLCollectionOf<HTMLElement>;
  for (let i = 0; i < rows.length; i++) {
    rows[i].style.height = measured[i] ? `${measured[i].getBoundingClientRect().height}px` : '';
  }
  m.replaceChildren();
}
function updateGutterLines(el: HTMLTextAreaElement, gutter: HTMLElement) {
  const lines = el.value.split('\n').length;
  if (gutter.children.length !== lines) {
    let html = '';
    for (let i = 1; i <= lines; i++) html += `<span>${i}</span>`;
    gutter.innerHTML = html; // resets scrollTop to 0, so re-sync it below
  }
  sizeGutterRows(el, gutter);
  gutter.scrollTop = el.scrollTop;
  updateActiveLine(el, gutter);
}
for (const [field, gutter] of [[inputOld, gutterOld], [inputNew, gutterNew]] as const) {
  field.addEventListener('scroll', () => { gutter.scrollTop = field.scrollTop; });
  field.addEventListener('click', () => updateActiveLine(field, gutter));
  field.addEventListener('keyup', () => updateActiveLine(field, gutter));
}

// --- UI round 4: JSON colours on both inputs ---------------------------------
// The JSON Formatter's output layer (see .hl-layer in global.css): a coloured <pre> under the
// textarea, whose own text goes transparent. On an editable box the layer must repaint in the same
// task as the keystroke, never on the debounced diff below, or a typed character is invisible
// until the next paint. Recolouring the whole document per keystroke measured 23 ms at 10k
// characters and 311 ms at 99k, so the layer holds one <div> per line and a keystroke recolours
// only the lines that changed (JSON tokens never span a line, so per-line colouring is identical).
// Past MAX_LIVE_HIGHLIGHT characters the box stays plain. Adapted from json-highlight-layer.ts,
// not imported (no shared JS across tools).
const MAX_LIVE_HIGHLIGHT = 100_000;
function attachInputHighlight(field: HTMLTextAreaElement) {
  const wrap = field.parentElement as HTMLElement;
  const layer = document.createElement('pre');
  layer.className = 'hl-layer';
  layer.setAttribute('aria-hidden', 'true');
  // First child, so the line-number gutter (a later sibling) still paints above it.
  wrap.insertBefore(layer, wrap.firstChild);
  wrap.classList.add('hl-input');
  const tpl = document.createElement('template');
  let painted: string | null = null;
  let lines: string[] = [];
  const sync = () => {
    layer.scrollTop = field.scrollTop;
    layer.scrollLeft = field.scrollLeft;
  };
  // An empty line still takes one line of height, like the textarea's own empty line.
  const lineHtml = (line: string) => `<div>${line ? highlightJsonHtml(line) : '<br>'}</div>`;
  const paint = () => {
    const text = field.value;
    if (text !== painted) {
      painted = text;
      const on = text.length > 0 && text.length <= MAX_LIVE_HIGHLIGHT;
      wrap.classList.toggle('has-hl', on);
      const next = on ? text.split('\n') : [];
      // Lines shared at the start and at the end are kept; only the span between is replaced.
      let start = 0;
      while (start < lines.length && start < next.length && lines[start] === next[start]) start++;
      let endOld = lines.length;
      let endNew = next.length;
      while (endOld > start && endNew > start && lines[endOld - 1] === next[endNew - 1]) {
        endOld--;
        endNew--;
      }
      if (endOld > start) {
        const range = document.createRange();
        range.setStartBefore(layer.children[start]);
        range.setEndAfter(layer.children[endOld - 1]);
        range.deleteContents();
      }
      if (endNew > start) {
        tpl.innerHTML = next.slice(start, endNew).map(lineHtml).join('');
        layer.insertBefore(tpl.content, layer.children[start] ?? null);
      }
      lines = next;
    }
    sync();
  };
  field.addEventListener('scroll', sync);
  field.addEventListener('input', paint);
  return paint;
}
const paintOld = attachInputHighlight(inputOld);
const paintNew = attachInputHighlight(inputNew);

// --- Redesign round 1: filter chips, and a side-by-side view of both formatted documents ---
function renderChanges() {
  if (!lastChanges) return;
  const shown = filter === 'all' ? lastChanges : lastChanges.filter((c) => c.type === filter);
  changesEl.innerHTML = shown.map(changeRow).join('');
}
function setFilter(next: typeof filter) {
  filter = next;
  filtersEl.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === next)));
  renderChanges();
}
filtersEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]');
  if (!btn) return;
  setFilter(btn.dataset.filter as typeof filter);
  track('tool_option', { option: 'filter', value: filter }, 'opt:filter');
});

/** Same row model as the Text Diff Checker, run over the two pretty-printed documents. */
function renderSide() {
  if (!lastPretty) return;
  const r = diffText(lastPretty.old, lastPretty.new);
  if (!r.ok) {
    sideView.textContent = r.error;
    return;
  }
  const cell = (row: DiffRow, side: 'old' | 'new') => {
    const text = side === 'old' ? row.oldText : row.newText;
    const cls = row.kind === 'equal' ? '' : text === undefined ? 'c-empty' : side === 'old' ? 'c-del' : 'c-ins';
    return `<span class="dc ${cls}">${text === undefined ? '' : highlightJsonHtml(text)}</span>`;
  };
  const rowsHtml = (rows: DiffRow[]) =>
    rows.map((row) => `<div class="ds-row"><span class="dn">${row.oldNo ?? ''}</span>${cell(row, 'old')}<span class="dn">${row.newNo ?? ''}</span>${cell(row, 'new')}</div>`).join('');
  const parts: string[] = [];
  let segment: DiffRow[] = [];
  foldRows(buildRows(r.value.groups)).forEach((item, idx) => {
    if (item.kind !== 'fold') return void segment.push(item);
    const fold = item as FoldRow;
    if (expandedFolds.has(idx)) return void segment.push(...fold.rows);
    parts.push(rowsHtml(segment));
    segment = [];
    parts.push(`<button type="button" class="ds-fold" data-fold="${idx}">⋯ ${fold.rows.length.toLocaleString()} unchanged lines: show</button>`);
  });
  parts.push(rowsHtml(segment));
  sideView.innerHTML = parts.join('');
}
sideView.addEventListener('click', (e) => {
  const fold = (e.target as HTMLElement).closest<HTMLElement>('.ds-fold');
  if (!fold) return;
  expandedFolds.add(Number(fold.dataset.fold));
  renderSide();
});

function applyView() {
  const side = view === 'side' && !narrow.matches;
  viewListBtn.setAttribute('aria-pressed', String(!side));
  viewSideBtn.setAttribute('aria-pressed', String(side));
  sideView.hidden = !side || !lastPretty;
  changesEl.hidden = side;
  filtersEl.hidden = side || !lastChanges?.length;
  if (side) renderSide();
}
for (const [btn, v] of [[viewListBtn, 'list'], [viewSideBtn, 'side']] as const) {
  btn.addEventListener('click', () => {
    view = v;
    applyView();
    track('tool_option', { option: 'view', value: v }, 'opt:view');
  });
}
narrow.addEventListener('change', applyView);

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
  if (c.type === 'added') return `<div class="jd-row jd-added"><span class="jd-badge">+ added</span><span class="jd-path">${escapeHtml(c.path)}</span><span class="jd-val" title="${escapeHtml(JSON.stringify(c.value) ?? 'undefined')}">${highlightJsonHtml(formatValue(c.value))}</span></div>`;
  if (c.type === 'removed') return `<div class="jd-row jd-removed"><span class="jd-badge">- removed</span><span class="jd-path">${escapeHtml(c.path)}</span><span class="jd-val" title="${escapeHtml(JSON.stringify(c.value) ?? 'undefined')}">${highlightJsonHtml(formatValue(c.value))}</span></div>`;
  return `<div class="jd-row jd-changed"><span class="jd-badge">~ changed</span><span class="jd-path">${escapeHtml(c.path)}</span><span class="jd-val-old">${highlightJsonHtml(formatValue(c.oldValue))}</span><span class="jd-arrow">→</span><span class="jd-val-new">${highlightJsonHtml(formatValue(c.newValue))}</span></div>`;
}

function render() {
  // Paste, Swap, sample and Clear set the value in code, which fires no input event.
  paintOld();
  paintNew();
  updateCharStat();
  updateGutterLines(inputOld, gutterOld);
  updateGutterLines(inputNew, gutterNew);
  for (const g of [gutterOld, gutterNew]) g.querySelector('.err')?.classList.remove('err');
  lastChanges = null;
  lastPretty = null;
  expandedFolds.clear();

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
    // The failing line is also marked in that side's gutter, as in the JSON Formatter.
    if (r.line) (r.side === 'old' ? gutterOld : gutterNew).children[r.line - 1]?.classList.add('err');
    result.hidden = true;
    return;
  }

  status.hidden = true;
  result.hidden = false;
  lastChanges = r.value.changes;
  lastPretty = { old: r.value.oldPretty, new: r.value.newPretty };

  if (r.value.stats.identical) {
    stats.textContent = 'No differences: the two JSON documents are structurally identical.';
    changesEl.innerHTML = '';
    applyView();
    return;
  }
  const { added, removed, changed } = r.value.stats;
  stats.textContent = `${added} added, ${removed} removed, ${changed} changed`;
  const counts: Record<string, number> = { all: added + removed + changed, added, removed, changed };
  filtersEl.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => {
    (b.querySelector('span') as HTMLElement).textContent = String(counts[b.dataset.filter!]);
  });
  // A filter that no longer matches anything falls back to showing everything.
  if (filter !== 'all' && !counts[filter]) setFilter('all');
  else renderChanges();
  applyView();
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

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void copyResult();
  }
}
inputOld.addEventListener('keydown', onKeydown);
inputNew.addEventListener('keydown', onKeydown);

render();
