import { diffText, diffWords, SAMPLE_A, SAMPLE_B, type LineGroup } from '../../lib/text-diff';
import { tokenize, detectLanguage, type Language } from '../../lib/syntax-highlight';
import type { DiffOp } from '../../lib/diff-core';

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

type Mode = 'line' | 'word';
let mode: Mode = 'line';
let lastLineGroups: LineGroup[] | null = null;
let lastWordOps: DiffOp<string>[] | null = null;

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

function lineRow(gutter: string, cls: string, html: string): string {
  return `<div class="dl-line ${cls}"><span class="dl-gutter">${gutter}</span><span class="dl-text">${html}</span></div>`;
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
  lastLineGroups = null;
  lastWordOps = null;

  if (!inputA.value.trim() && !inputB.value.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }

  const lang = effectiveLanguage();

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

    const rows: string[] = [];
    for (const g of r.value.groups) {
      if (g.type === 'equal') for (const line of g.lines) rows.push(lineRow(' ', 'dl-eq', renderTokensHtml(line, lang)));
      else if (g.type === 'delete') for (const line of g.lines) rows.push(lineRow('-', 'dl-del', renderTokensHtml(line, lang)));
      else if (g.type === 'insert') for (const line of g.lines) rows.push(lineRow('+', 'dl-ins', renderTokensHtml(line, lang)));
      else if (g.wordDiff) {
        rows.push(lineRow('-', 'dl-del', wordDiffSideHtml(g.wordDiff, 'old')));
        rows.push(lineRow('+', 'dl-ins', wordDiffSideHtml(g.wordDiff, 'new')));
      } else {
        for (const line of g.oldLines) rows.push(lineRow('-', 'dl-del', renderTokensHtml(line, lang)));
        for (const line of g.newLines) rows.push(lineRow('+', 'dl-ins', renderTokensHtml(line, lang)));
      }
    }
    diffView.innerHTML = rows.join('');
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
