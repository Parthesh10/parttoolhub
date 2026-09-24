import { diffText, diffWords, SAMPLE_A, SAMPLE_B, type LineGroup } from '../../lib/text-diff';
import { tokenize, detectLanguage, type Language } from '../../lib/syntax-highlight';
import type { DiffOp } from '../../lib/diff-core';
import { buildRows, countChanges, foldRows, type DiffRow, type FoldRow } from '../../lib/diff-rows';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const inputA = $<HTMLTextAreaElement>('input-a');
const inputB = $<HTMLTextAreaElement>('input-b');
const statA = $('stat-a');
const statB = $('stat-b');
const status = $('status');
const result = $('result');
const stats = $('stats');
const diffView = $('diff-view');
const toast = $('toast');
const langSelect = $<HTMLSelectElement>('opt-lang');
const modeLineBtn = $<HTMLButtonElement>('mode-line');
const modeWordBtn = $<HTMLButtonElement>('mode-word');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const gutterA = $('gutter-a');
const gutterB = $('gutter-b');
const diffNav = $('diff-nav');
const navPos = $('nav-pos');
const showAll = $<HTMLInputElement>('opt-show-all');
const viewSplitBtn = $<HTMLButtonElement>('view-split');
const viewUnifiedBtn = $<HTMLButtonElement>('view-unified');

type Mode = 'line' | 'word';
let mode: Mode = 'line';
let lastLineGroups: LineGroup[] | null = null;
let lastWordOps: DiffOp<string>[] | null = null;
let lastRows: DiffRow[] | null = null;
let changeCount = 0;
let currentChange = -1;
const expandedFolds = new Set<number>();

// Side by side by default where there is room; a phone always gets unified (the Layout
// fieldset is hidden there). The choice is remembered per browser.
const narrow = window.matchMedia('(max-width: 760px)');
let view: 'split' | 'unified' = 'split';
try {
  const saved = localStorage.getItem('pth:diff-view');
  if (saved === 'split' || saved === 'unified') view = saved;
} catch {
  // Storage blocked (private mode, site data off): the default is fine.
}
const effectiveView = () => (narrow.matches ? 'unified' : view);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function effectiveLanguage(): Language {
  const v = langSelect.value;
  if (v !== 'auto') return v as Language;
  return detectLanguage(inputA.value || inputB.value);
}

function renderTokensHtml(text: string, lang: Language): string {
  if (lang === 'plain') return escapeHtml(text);
  return tokenize(text, lang)
    .map((t) => (t.type === 'plain' ? escapeHtml(t.text) : `<span class="sx-${t.type}">${escapeHtml(t.text)}</span>`))
    .join('');
}

/** Reconstructs one side ('old' or 'new') of a single-line word diff, highlighting only that side's changes. */
function wordDiffSideHtml(ops: DiffOp<string>[], side: 'old' | 'new'): string {
  return ops
    .filter((op) => (side === 'old' ? op.type !== 'insert' : op.type !== 'delete'))
    .map((op) => {
      if (op.type === 'equal') return escapeHtml(op.value);
      const cls = side === 'old' ? 'dw-del' : 'dw-ins';
      return `<span class="${cls}">${escapeHtml(op.value)}</span>`;
    })
    .join('');
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
for (const [field, gutter] of [[inputA, gutterA], [inputB, gutterB]] as const) {
  field.addEventListener('scroll', () => { gutter.scrollTop = field.scrollTop; });
  field.addEventListener('click', () => updateActiveLine(field, gutter));
  field.addEventListener('keyup', () => updateActiveLine(field, gutter));
}

// --- Redesign round 1: side-by-side / unified rows, folding, change navigator -----
function sideHtml(r: DiffRow, side: 'old' | 'new', lang: Language): string {
  const text = side === 'old' ? r.oldText : r.newText;
  if (text === undefined) return '';
  if (r.kind === 'replace' && r.wordDiff) return wordDiffSideHtml(r.wordDiff, side);
  return renderTokensHtml(text, lang);
}
function cellClass(r: DiffRow, side: 'old' | 'new'): string {
  if (r.kind === 'equal') return '';
  const text = side === 'old' ? r.oldText : r.newText;
  if (text === undefined) return 'c-empty';
  return side === 'old' ? 'c-del' : 'c-ins';
}
const changeAttr = (c: number | undefined) => (c === undefined ? '' : ` data-change="${c}"`);
function splitRowsHtml(rows: DiffRow[], lang: Language): string {
  return rows
    .map(
      (r) =>
        `<div class="ds-row"${changeAttr(r.change)}><span class="dn">${r.oldNo ?? ''}</span>` +
        `<span class="dc ${cellClass(r, 'old')}">${sideHtml(r, 'old', lang)}</span>` +
        `<span class="dn">${r.newNo ?? ''}</span><span class="dc ${cellClass(r, 'new')}">${sideHtml(r, 'new', lang)}</span></div>`,
    )
    .join('');
}
function unifiedRow(oldNo: number | undefined, newNo: number | undefined, sign: string, cls: string, html: string, change?: number) {
  return `<div class="du-row ${cls}"${changeAttr(change)}><span class="dn">${oldNo ?? ''}</span><span class="dn">${newNo ?? ''}</span><span class="du-sign">${sign}</span><span class="dc">${html}</span></div>`;
}
/** Unified view prints each change block as all its removed lines, then all its added lines. */
function unifiedRowsHtml(rows: DiffRow[], lang: Language): string {
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === 'equal') {
      out.push(unifiedRow(r.oldNo, r.newNo, ' ', '', sideHtml(r, 'old', lang)));
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].change === r.change) j++;
    const block = rows.slice(i, j);
    for (const b of block) if (b.oldText !== undefined) out.push(unifiedRow(b.oldNo, undefined, '-', 'c-del', sideHtml(b, 'old', lang), b.change));
    for (const b of block) if (b.newText !== undefined) out.push(unifiedRow(undefined, b.newNo, '+', 'c-ins', sideHtml(b, 'new', lang), b.change));
    i = j;
  }
  return out.join('');
}
function renderLineView() {
  if (!lastRows) return;
  const lang = effectiveLanguage();
  const rowsHtml = effectiveView() === 'split' ? splitRowsHtml : unifiedRowsHtml;
  const display = showAll.checked ? lastRows : foldRows(lastRows);
  const parts: string[] = [];
  let segment: DiffRow[] = [];
  display.forEach((item, idx) => {
    if (item.kind !== 'fold') {
      segment.push(item);
      return;
    }
    const fold = item as FoldRow;
    if (expandedFolds.has(idx)) {
      segment.push(...fold.rows);
      return;
    }
    parts.push(rowsHtml(segment, lang));
    segment = [];
    const n = fold.rows.length;
    parts.push(`<button type="button" class="ds-fold" data-fold="${idx}">⋯ ${n.toLocaleString()} unchanged line${n === 1 ? '' : 's'}: show</button>`);
  });
  parts.push(rowsHtml(segment, lang));
  const keepScroll = diffView.scrollTop;
  diffView.innerHTML = parts.join('');
  diffView.scrollTop = keepScroll;
  if (currentChange >= 0) markChange();
}
function markChange() {
  diffView.querySelectorAll('.is-current-change').forEach((el) => el.classList.remove('is-current-change'));
  const els = diffView.querySelectorAll<HTMLElement>(`[data-change="${currentChange}"]`);
  els.forEach((el) => el.classList.add('is-current-change'));
  return els[0];
}
function goToChange(step: 1 | -1) {
  if (!changeCount) return;
  currentChange = currentChange < 0 ? (step === 1 ? 0 : changeCount - 1) : (currentChange + step + changeCount) % changeCount;
  const first = markChange();
  if (first) diffView.scrollTop = first.offsetTop - 24;
  navPos.textContent = `${currentChange + 1} of ${changeCount}`;
  track('tool_option', { option: 'navigate', value: step === 1 ? 'next' : 'previous' }, 'opt:navigate');
}
function resetNav() {
  currentChange = -1;
  navPos.textContent = `${changeCount} change${changeCount === 1 ? '' : 's'}`;
}
function setView(next: 'split' | 'unified') {
  view = next;
  viewSplitBtn.setAttribute('aria-pressed', String(next === 'split'));
  viewUnifiedBtn.setAttribute('aria-pressed', String(next === 'unified'));
  try {
    localStorage.setItem('pth:diff-view', next);
  } catch {
    // Not remembered; still applied for this visit.
  }
  renderLineView();
}
// Applied once at load without tracking: this runs above the analytics block, whose `fired`
// set is not initialised yet (a track() call here would throw and stop the whole script).
setView(view);
for (const [btn, v] of [[viewSplitBtn, 'split'], [viewUnifiedBtn, 'unified']] as const) {
  btn.addEventListener('click', () => {
    setView(v);
    track('tool_option', { option: 'layout', value: v }, 'opt:layout');
  });
}
narrow.addEventListener('change', () => renderLineView());
showAll.addEventListener('change', () => {
  trackOption(showAll);
  renderLineView();
});
$('btn-prev').addEventListener('click', () => goToChange(-1));
$('btn-next').addEventListener('click', () => goToChange(1));
diffView.addEventListener('click', (e) => {
  const fold = (e.target as HTMLElement).closest<HTMLElement>('.ds-fold');
  if (!fold) return;
  expandedFolds.add(Number(fold.dataset.fold));
  renderLineView();
});

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
function trackRun(action: string, ok: boolean, errorType = 'unknown') {
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(inputA.value.length + inputB.value.length) }, 'use');
  if (ok) track('tool_result', { action }, 'result');
  else track('tool_error', { action, error_type: errorType }, 'error');
}
function trackOption(el: HTMLInputElement | HTMLSelectElement | HTMLButtonElement, value?: string) {
  let v = value;
  if (v === undefined) {
    if (el instanceof HTMLSelectElement) v = el.options[el.selectedIndex]?.text ?? '';
    else if (el instanceof HTMLInputElement && el.type === 'checkbox') v = String(el.checked);
    else v = '(text)';
  }
  track('tool_option', { option: el.id || el.dataset.preset || 'unknown', value: v }, `opt:${el.id || el.dataset.preset}`);
}
for (const field of [inputA, inputB]) {
  field.addEventListener('paste', () => { justPasted = true; });
  field.addEventListener('input', () => { inputSource = justPasted ? 'pasted' : 'typed'; justPasted = false; });
}

function updateCharStat() {
  statA.textContent = inputA.value ? `${inputA.value.length.toLocaleString()} characters` : '';
  statB.textContent = inputB.value ? `${inputB.value.length.toLocaleString()} characters` : '';
}

function render() {
  updateCharStat();
  updateGutterLines(inputA, gutterA);
  updateGutterLines(inputB, gutterB);
  lastLineGroups = null;
  lastWordOps = null;
  lastRows = null;
  diffNav.hidden = true;
  viewSplitBtn.disabled = viewUnifiedBtn.disabled = mode === 'word';

  if (!inputA.value.trim() && !inputB.value.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }

  if (mode === 'line') {
    const r = diffText(inputA.value, inputB.value);
    trackRun('line-diff', r.ok, r.ok ? undefined : 'range');
    if (!r.ok) {
      status.hidden = false;
      status.className = 'status-banner is-error';
      status.textContent = r.error;
      result.hidden = true;
      return;
    }
    status.hidden = true;
    result.hidden = false;
    lastLineGroups = r.value.groups;

    if (r.value.stats.identical) {
      stats.textContent = 'No differences found.';
      diffView.innerHTML = '';
      return;
    }
    stats.textContent = `+${r.value.stats.linesAdded} line${r.value.stats.linesAdded === 1 ? '' : 's'} added, -${r.value.stats.linesRemoved} line${r.value.stats.linesRemoved === 1 ? '' : 's'} removed`;

    lastRows = buildRows(r.value.groups);
    changeCount = countChanges(lastRows);
    expandedFolds.clear();
    resetNav();
    diffNav.hidden = false;
    renderLineView();
  } else {
    const r = diffWords(inputA.value, inputB.value);
    trackRun('word-diff', r.ok, r.ok ? undefined : 'range');
    if (!r.ok) {
      status.hidden = false;
      status.className = 'status-banner is-error';
      status.textContent = r.error;
      result.hidden = true;
      return;
    }
    status.hidden = true;
    result.hidden = false;
    lastWordOps = r.value;

    const addedWords = r.value.filter((o) => o.type === 'insert' && o.value.trim()).length;
    const removedWords = r.value.filter((o) => o.type === 'delete' && o.value.trim()).length;
    if (addedWords === 0 && removedWords === 0) {
      stats.textContent = 'No differences found.';
      diffView.innerHTML = '';
      return;
    }
    stats.textContent = `+${addedWords} word${addedWords === 1 ? '' : 's'} added, -${removedWords} word${removedWords === 1 ? '' : 's'} removed`;
    diffView.innerHTML = r.value
      .map((op) => {
        if (op.type === 'equal') return escapeHtml(op.value);
        return `<span class="${op.type === 'delete' ? 'dw-del' : 'dw-ins'}">${escapeHtml(op.value)}</span>`;
      })
      .join('');
  }
}

function setMode(next: Mode) {
  mode = next;
  modeLineBtn.setAttribute('aria-pressed', String(next === 'line'));
  modeWordBtn.setAttribute('aria-pressed', String(next === 'word'));
  track('tool_option', { option: 'mode', value: next }, 'opt:mode');
  render();
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

function buildCopyText(): string {
  if (mode === 'line' && lastLineGroups) {
    const lines: string[] = [];
    for (const g of lastLineGroups) {
      if (g.type === 'equal') for (const l of g.lines) lines.push('  ' + l);
      else if (g.type === 'delete') for (const l of g.lines) lines.push('- ' + l);
      else if (g.type === 'insert') for (const l of g.lines) lines.push('+ ' + l);
      else {
        for (const l of g.oldLines) lines.push('- ' + l);
        for (const l of g.newLines) lines.push('+ ' + l);
      }
    }
    return lines.join('\n');
  }
  if (mode === 'word' && lastWordOps) {
    return lastWordOps.map((op) => (op.type === 'equal' ? op.value : op.type === 'delete' ? `[-${op.value}-]` : `[+${op.value}+]`)).join('');
  }
  return '';
}

async function copyResult() {
  const text = buildCopyText();
  if (!text) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'output' });
  try {
    await navigator.clipboard.writeText(text);
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
inputA.addEventListener('input', scheduleRender);
inputB.addEventListener('input', scheduleRender);
langSelect.addEventListener('change', () => {
  trackOption(langSelect);
  render();
});
modeLineBtn.addEventListener('click', () => setMode('line'));
modeWordBtn.addEventListener('click', () => setMode('word'));
$('btn-paste-a').addEventListener('click', () => pasteInto(inputA));
$('btn-paste-b').addEventListener('click', () => pasteInto(inputB));
$('btn-swap').addEventListener('click', () => {
  trackOption($<HTMLButtonElement>('btn-swap'));
  const a = inputA.value;
  inputA.value = inputB.value;
  inputB.value = a;
  render();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  inputA.value = SAMPLE_A;
  inputB.value = SAMPLE_B;
  render();
});
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  inputA.value = '';
  inputB.value = '';
  render();
  inputA.focus();
});
$('btn-copy').addEventListener('click', () => void copyResult());

// UX-013: Ctrl+Enter / Cmd+Enter to copy, matching every other tool's shortcut.
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void copyResult();
  }
}
inputA.addEventListener('keydown', onKeydown);
inputB.addEventListener('keydown', onKeydown);

render();
