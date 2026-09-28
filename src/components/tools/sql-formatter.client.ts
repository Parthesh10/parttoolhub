import { formatSql, minifySql, SAMPLE_SQL, type Dialect, type FormatOptions, type SqlIssue } from '../../lib/sql-format';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const statusTitle = $('status-title');
const statusList = $('status-list');
const toast = $('toast');
const dialect = $<HTMLSelectElement>('opt-dialect');
const keywordCase = $<HTMLSelectElement>('opt-case');
const indent = $<HTMLSelectElement>('opt-indent');
const commas = $<HTMLSelectElement>('opt-commas');
const modeFormatBtn = $<HTMLButtonElement>('mode-format');
const modeMinifyBtn = $<HTMLButtonElement>('mode-minify');
const wrapBtn = $<HTMLButtonElement>('btn-wrap');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const inputGutter = $('input-gutter');

let mode: 'format' | 'minify' = 'format';

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
// UX-006: byte size is the UTF-8 encoded size (what actually gets downloaded/copied), not
// .length (a UTF-16 code-unit count) — they differ for non-ASCII input.
function formatBytes(text: string) {
  return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

// --- UX-005: gutter line numbers + active-line highlight -------------------
function updateActiveLine() {
  const lineIndex = input.value.slice(0, input.selectionStart).split('\n').length; // 1-based
  inputGutter.querySelector('.active')?.classList.remove('active');
  inputGutter.children[lineIndex - 1]?.classList.add('active');
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
function updateGutterLines() {
  const lines = input.value.split('\n').length;
  if (inputGutter.children.length !== lines) {
    let html = '';
    for (let i = 1; i <= lines; i++) html += `<span>${i}</span>`;
    inputGutter.innerHTML = html; // resets scrollTop to 0, so re-sync it below
  }
  sizeGutterRows(input, inputGutter);
  inputGutter.scrollTop = input.scrollTop;
  updateActiveLine();
}
input.addEventListener('scroll', () => { inputGutter.scrollTop = input.scrollTop; });
input.addEventListener('click', updateActiveLine);
input.addEventListener('keyup', updateActiveLine);

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

// --- SITE-001: draggable resize handle between the two panes, desktop only -
// Inserted by JS rather than static markup so a tool that hasn't adopted this yet
// needs no Astro change (see the .is-resizable comment in global.css). Below the
// 760px breakpoint the panes stack into one column, where a horizontal split has
// no meaning, so the handle is simply never created.
const panesEl = toolSection.querySelector<HTMLElement>('.panes');
if (panesEl && window.matchMedia('(min-width: 761px)').matches) {
  const paneEls = panesEl.querySelectorAll<HTMLElement>(':scope > .pane');
  if (paneEls.length === 2) {
    panesEl.classList.add('is-resizable');
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Resize the two panes');
    handle.tabIndex = 0;
    paneEls[0].after(handle);

    const MIN_PCT = 20;
    const MAX_PCT = 80;
    function applySplit(pct: number) {
      panesEl!.style.gridTemplateColumns = `${pct}% 7px 1fr`;
    }
    function pctFromEvent(clientX: number): number {
      const rect = panesEl!.getBoundingClientRect();
      return Math.min(MAX_PCT, Math.max(MIN_PCT, ((clientX - rect.left) / rect.width) * 100));
    }
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      handle.classList.add('is-dragging');
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applySplit(pctFromEvent(e.clientX));
    });
    function stopDragging() {
      dragging = false;
      handle.classList.remove('is-dragging');
    }
    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);
    handle.addEventListener('keydown', (e) => {
      const current = panesEl!.style.gridTemplateColumns;
      const currentPct = current ? parseFloat(current) : 50;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        applySplit(Math.max(MIN_PCT, currentPct - 5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        applySplit(Math.min(MAX_PCT, currentPct + 5));
      } else if (e.key === 'Home') {
        e.preventDefault();
        applySplit(50);
      }
    });
    handle.addEventListener('dblclick', () => applySplit(50));
  }
}

// --- UX-002: paste from clipboard + drag-and-drop file upload -------------
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
input.addEventListener('dragover', (e) => {
  e.preventDefault();
  input.classList.add('drag-over');
});
input.addEventListener('dragleave', () => input.classList.remove('drag-over'));
input.addEventListener('drop', async (e) => {
  e.preventDefault();
  input.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const fileText = await file.text();
  inputSource = 'file';
  input.value = fileText;
  render();
});

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the text a visitor typed.
const fired = new Set<string>();
let inputSource: 'typed' | 'pasted' | 'sample' | 'transfer' | 'file' = 'typed';
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

/** The engine's issue codes, grouped into the error categories analytics reports. */
function errorCategory(issues: SqlIssue[]): string {
  const code = issues[0]?.code;
  if (code === 'unterminated') return 'unterminated';
  if (code === 'unmatched_close' || code === 'unclosed_open') return 'brackets';
  return 'comma';
}

function currentOptions(): Partial<FormatOptions> {
  return {
    dialect: dialect.value as Dialect,
    keywordCase: keywordCase.value as FormatOptions['keywordCase'],
    indent: indent.value === 'tab' ? 'tab' : (Number(indent.value) as 2 | 4),
    commas: commas.value as FormatOptions['commas'],
  };
}

function showIssues(issues: SqlIssue[]) {
  if (!issues.length) {
    status.hidden = true;
    return;
  }
  status.hidden = false;
  status.className = 'status-banner sql-issues is-error';
  statusTitle.textContent = `${plural(issues.length, 'problem')} found. The query is still formatted; fix these before running it.`;
  statusList.replaceChildren(
    ...issues.map((i) => {
      const li = document.createElement('li');
      li.textContent = `Line ${i.line}, column ${i.column}: ${i.message}`;
      return li;
    }),
  );
}

function render() {
  const raw = input.value;
  updateGutterLines();
  inputStat.textContent = raw.length
    ? `${plural(raw.split('\n').length, 'line')} · ${plural(raw.length, 'character')} · ${formatBytes(raw)}`
    : plural(raw.length, 'character');

  if (!raw.trim()) {
    output.value = '';
    outputStat.textContent = '';
    status.hidden = true;
    return;
  }

  const result = mode === 'format' ? formatSql(raw, currentOptions()) : minifySql(raw, currentOptions());
  trackRun(mode, result.issues.length === 0, errorCategory(result.issues));
  output.value = result.output;
  outputStat.textContent =
    mode === 'format'
      ? `${plural(result.statements, 'statement')} · ${plural(result.output.split('\n').length, 'line')} · ${formatBytes(result.output)}`
      : `${plural(result.statements, 'statement')} · ${plural(result.output.length, 'character')} · ${formatBytes(result.output)}`;
  showIssues(result.issues);
}

function setMode(next: 'format' | 'minify') {
  mode = next;
  modeFormatBtn.setAttribute('aria-pressed', String(next === 'format'));
  modeMinifyBtn.setAttribute('aria-pressed', String(next === 'minify'));
  // Indent and comma placement only exist in a formatted layout.
  indent.disabled = next === 'minify';
  commas.disabled = next === 'minify';
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

function downloadOutput() {
  if (!output.value) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([output.value + '\n'], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'query.sql';
  a.click();
  URL.revokeObjectURL(url);
}

// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms. The engine takes about 7 ms per 10 KB, so above
// 50,000 characters the wait grows to 400 ms: a big paste then formats once
// when typing pauses instead of after every key. Option changes re-render
// immediately (one event, not a burst).
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, input.value.length > 50_000 ? 400 : 120);
}
input.addEventListener('input', scheduleRender);
for (const c of [dialect, keywordCase, indent, commas]) c.addEventListener('change', () => { render(); trackOption(c); });
modeFormatBtn.addEventListener('click', () => setMode('format'));
modeMinifyBtn.addEventListener('click', () => setMode('minify'));
wrapBtn.addEventListener('click', () => {
  const next = wrapBtn.getAttribute('aria-pressed') !== 'true';
  wrapBtn.setAttribute('aria-pressed', String(next));
  output.classList.toggle('no-wrap', next);
  trackOption(wrapBtn, next ? 'no-wrap' : 'wrap');
});
pasteBtn.addEventListener('click', pasteFromClipboard);
$('btn-copy').addEventListener('click', copyOutput);
$('btn-download').addEventListener('click', downloadOutput);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_SQL;
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
