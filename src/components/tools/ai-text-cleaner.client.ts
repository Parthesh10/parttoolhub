import { cleanText, type DashMode } from '../../lib/text-clean';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const summary = $('summary');
const toast = $('toast');

const markdown = $<HTMLInputElement>('opt-markdown');
const bullets = $<HTMLInputElement>('opt-bullets');
const emdash = $<HTMLSelectElement>('opt-emdash');
const quotes = $<HTMLInputElement>('opt-quotes');
const ellipsis = $<HTMLInputElement>('opt-ellipsis');
const invisible = $<HTMLInputElement>('opt-invisible');
const citations = $<HTMLInputElement>('opt-citations');
const emoji = $<HTMLInputElement>('opt-emoji');
const whitespace = $<HTMLInputElement>('opt-whitespace');
const wrapBtn = $<HTMLButtonElement>('btn-wrap');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const inputGutter = $('input-gutter');
const outputGutter = $('output-gutter');

const SAMPLE =
  '## Summary\n\nThis is **really** important — maybe the *most* important thing — so let’s be clear: it works.\n\n' +
  '* Point one\n* Point two[1]\n\nSee the docs for more[2, 3]…';

const CHANGE_LABELS: Record<string, string> = {
  markdown: 'Markdown removed',
  citations: 'citations removed',
  straightenQuotes: 'quotes straightened',
  emDash: 'dashes replaced',
  ellipsis: 'ellipses replaced',
  invisible: 'hidden characters removed',
  emoji: 'emoji removed',
  whitespace: 'whitespace tidied',
};

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
// UX-006: byte size is the UTF-8 encoded size (what actually gets downloaded/copied), not
// .length (a UTF-16 code-unit count) — they differ for non-ASCII input.
function formatBytes(text: string) {
  return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

// --- UX-005: gutter line numbers + active-line highlight --------------------
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
input.addEventListener('scroll', () => { inputGutter.scrollTop = input.scrollTop; });
input.addEventListener('click', () => updateActiveLine(input, inputGutter));
input.addEventListener('keyup', () => updateActiveLine(input, inputGutter));
output.addEventListener('scroll', () => { outputGutter.scrollTop = output.scrollTop; });
output.addEventListener('click', () => updateActiveLine(output, outputGutter));
output.addEventListener('keyup', () => updateActiveLine(output, outputGutter));

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

function render() {
  const raw = input.value;
  inputStat.textContent = raw.length
    ? `${plural(raw.split('\n').length, 'line')} · ${plural(raw.length, 'character')} · ${formatBytes(raw)}`
    : plural(raw.length, 'character');
  updateGutterLines(input, inputGutter);
  bullets.disabled = !markdown.checked;

  const result = cleanText(raw, {
    markdown: markdown.checked,
    normalizeBullets: bullets.checked,
    emDash: emdash.value as DashMode,
    straightenQuotes: quotes.checked,
    ellipsis: ellipsis.checked,
    invisible: invisible.checked,
    citations: citations.checked,
    emoji: emoji.checked,
    whitespace: whitespace.checked,
  });

  output.value = result.output;
  updateGutterLines(output, outputGutter);
  outputStat.textContent = result.output.length
    ? `${plural(result.output.split('\n').length, 'line')} · ${plural(result.output.length, 'character')} · ${formatBytes(result.output)}`
    : plural(result.output.length, 'character');
  if (raw.trim()) trackRun('clean', true);

  const applied = Object.keys(result.changes);
  summary.textContent = raw.trim()
    ? applied.length
      ? `Changed: ${applied.map((k) => CHANGE_LABELS[k] ?? k).join(', ')}`
      : 'No changes needed'
    : '';
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
  const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cleaned.txt';
  a.click();
  URL.revokeObjectURL(url);
}

for (const c of [markdown, bullets, emdash, quotes, ellipsis, invisible, citations, emoji, whitespace]) {
  c.addEventListener('input', render);
  c.addEventListener('change', () => trackOption(c));
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
  input.value = SAMPLE;
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
