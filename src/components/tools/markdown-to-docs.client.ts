import { parseMarkdown, renderHtml, renderText, summarize, SAMPLE_MARKDOWN } from '../../lib/markdown';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const preview = $('preview');
const previewEmpty = $('preview-empty');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const copyBtn = $<HTMLButtonElement>('btn-copy');
const copyHtmlBtn = document.querySelector<HTMLButtonElement>('[data-copy="html"]')!;
const downloadBtn = $<HTMLButtonElement>('btn-download');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const inputGutter = $('input-gutter');

/** The rendered fragment and its plain-text twin — what the clipboard receives. */
let currentHtml = '';
let currentText = '';

// --- UX-005: gutter line numbers + active-line highlight (input only — the
// output here is a rendered preview, not a textarea) ------------------------
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

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function setStatus(kind: 'error' | 'ok' | null, text = '') {
  status.hidden = kind === null;
  status.className = `status-banner${kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : ''}`;
  status.textContent = text;
}

function setEnabled(on: boolean) {
  copyBtn.disabled = !on;
  copyHtmlBtn.disabled = !on;
  downloadBtn.disabled = !on;
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');
  updateGutterLines(input, inputGutter);

  if (!raw.trim()) {
    currentHtml = '';
    currentText = '';
    preview.replaceChildren(previewEmpty);
    previewEmpty.hidden = false;
    outputStat.textContent = '';
    setEnabled(false);
    setStatus(null);
    return;
  }

  const blocks = parseMarkdown(raw);
  currentHtml = renderHtml(blocks);
  currentText = renderText(blocks);
  const s = summarize(blocks);
  trackRun('convert', true);

  // The fragment is built by our renderer from escaped text — the input's own HTML never
  // reaches the DOM as markup, and javascript:/data: URLs are dropped before this point.
  preview.innerHTML = currentHtml;
  const parts = [plural(s.words, 'word')];
  if (s.headings) parts.push(plural(s.headings, 'heading'));
  if (s.lists) parts.push(plural(s.lists, 'list'));
  if (s.tables) parts.push(plural(s.tables, 'table'));
  if (s.codeBlocks) parts.push(plural(s.codeBlocks, 'code block'));
  if (s.links) parts.push(plural(s.links, 'link'));
  outputStat.textContent = parts.join(' · ');
  setEnabled(true);
  setStatus(null);
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2400);
}

/**
 * Put the formatted result on the clipboard as HTML *and* plain text, so Google
 * Docs, Word, Gmail, Outlook, Teams and Notion paste it formatted while a plain
 * text box still gets readable text. Older browsers without ClipboardItem get the
 * same result by copying a selection of the rendered preview.
 */
async function copyRich(): Promise<boolean> {
  if (!currentHtml) {
    showToast('Nothing to copy yet');
    return false;
  }
  track('copy_result', { target: 'rich' });
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([currentHtml], { type: 'text/html' }),
      'text/plain': new Blob([currentText], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    setStatus('ok', 'Copied as formatted text. In Google Docs (or Word, Gmail, Teams) press Ctrl+V / ⌘V to paste with the formatting.');
    showToast('Copied. Paste into Google Docs');
    return true;
  } catch {
    const range = document.createRange();
    range.selectNodeContents(preview);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    if (ok) {
      setStatus('ok', 'Copied as formatted text. In Google Docs (or Word, Gmail, Teams) press Ctrl+V / ⌘V to paste with the formatting.');
      showToast('Copied. Paste into Google Docs');
    } else {
      setStatus('error', 'Your browser blocked clipboard access. Select the preview with the mouse and press Ctrl+C / ⌘C instead; the formatting comes with it.');
    }
    return ok;
  }
}

/**
 * "Copy & open Google Doc": docs.new cannot be pre-filled (it takes no content
 * and another site's tab cannot be written to), so the next best thing is one
 * click that copies the formatted result *then* opens the blank doc, leaving
 * only Ctrl+V. The copy runs first because Chrome refuses a clipboard write once
 * focus has moved to the new tab; the tab still opens within the click's
 * user-activation window, so pop-up blockers let it through. With nothing to
 * copy (or no JS) the element stays a plain link to a blank doc.
 */
const DOCS_NEW_URL = 'https://docs.new';
async function copyAndOpenDocs(e: MouseEvent) {
  track('tool_option', { option: 'link-docs', value: 'open' }, 'opt:link-docs');
  if (!currentHtml) return;
  e.preventDefault();
  const copied = await copyRich();
  const tab = window.open(DOCS_NEW_URL, '_blank');
  if (tab) tab.opener = null;
  else setStatus('error', 'Your browser blocked the new tab. Open docs.new yourself and press Ctrl+V / ⌘V there.');
  if (tab && copied) setStatus('ok', 'Copied. A new Google Doc is opening in another tab; press Ctrl+V / ⌘V there to paste with the formatting.');
}

async function copyHtml() {
  if (!currentHtml) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'html' });
  try {
    await navigator.clipboard.writeText(currentHtml);
    showToast('HTML copied');
  } catch {
    showToast('Copy failed: your browser blocked clipboard access');
  }
}

function downloadHtml() {
  if (!currentHtml) return showToast('Nothing to download yet');
  track('download_result', { target: 'html' });
  const doc = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Converted from Markdown</title>\n</head>\n<body>\n${currentHtml}\n</body>\n</html>\n`;
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'document.html';
  a.click();
  URL.revokeObjectURL(url);
}

// Typing is debounced so a keystroke never waits on the engine — the site's
// INP budget is < 200 ms and large pastes can take longer than that to process
// synchronously.
let renderTimer: number | undefined;
function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}
input.addEventListener('input', scheduleRender);
pasteBtn.addEventListener('click', pasteFromClipboard);
copyBtn.addEventListener('click', () => void copyRich());
copyHtmlBtn.addEventListener('click', () => void copyHtml());
downloadBtn.addEventListener('click', downloadHtml);
$('link-docs').addEventListener('click', (e) => void copyAndOpenDocs(e));
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  input.value = SAMPLE_MARKDOWN;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    window.clearTimeout(renderTimer); // flush a pending debounced render first
    render();
    void copyRich();
  }
});

render();
