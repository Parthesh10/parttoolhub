import { htmlToMarkdown, SAMPLE_DOCS_HTML } from '../../lib/html-to-markdown';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** A contenteditable box, not a textarea: the browser puts the clipboard's HTML flavour in it. */
const input = $<HTMLDivElement>('input');
const output = $<HTMLTextAreaElement>('output');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const bullet = $<HTMLSelectElement>('opt-bullet');
const wrapBtn = $<HTMLButtonElement>('btn-wrap');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');
const outputGutter = $('output-gutter');

const inputLength = () => (input.textContent ?? '').length;

// --- UX-005: gutter line numbers + active-line highlight (output only — the
// input is a contenteditable box, not a textarea) ---------------------------
function updateActiveLine(el: HTMLTextAreaElement, gutter: HTMLElement) {
  const lineIndex = el.value.slice(0, el.selectionStart).split('\n').length; // 1-based
  gutter.querySelector('.active')?.classList.remove('active');
  gutter.children[lineIndex - 1]?.classList.add('active');
}
function updateGutterLines(el: HTMLTextAreaElement, gutter: HTMLElement) {
  const lines = el.value.split('\n').length;
  if (gutter.children.length !== lines) {
    let html = '';
    for (let i = 1; i <= lines; i++) html += `<span>${i}</span>`;
    gutter.innerHTML = html; // resets scrollTop to 0, so re-sync it below
  }
  gutter.scrollTop = el.scrollTop;
  updateActiveLine(el, gutter);
}
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

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the text a visitor pasted.
const fired = new Set<string>();
let inputSource: 'typed' | 'pasted' | 'sample' | 'transfer' = 'pasted';
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
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(inputLength()) }, 'use');
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

function setStatus(kind: 'error' | 'ok' | 'info' | null, text = '') {
  status.hidden = kind === null;
  status.className = `status-banner${kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : ''}`;
  status.textContent = text;
}

function render() {
  const html = input.innerHTML;
  const text = (input.textContent ?? '').trim();
  if (!text && !/<img/i.test(html)) {
    output.value = '';
    updateGutterLines(output, outputGutter);
    inputStat.textContent = 'Nothing pasted yet';
    outputStat.textContent = '';
    setStatus(null);
    return;
  }
  const r = htmlToMarkdown(html, { bullet: bullet.value as '-' | '*' });
  trackRun('convert', true);
  output.value = r.markdown;
  updateGutterLines(output, outputGutter);
  inputStat.textContent = plural(inputLength(), 'character');
  const s = r.stats;
  const parts = [plural(s.words, 'word')];
  if (s.headings) parts.push(plural(s.headings, 'heading'));
  if (s.lists) parts.push(plural(s.lists, 'list'));
  if (s.tables) parts.push(plural(s.tables, 'table'));
  if (s.links) parts.push(plural(s.links, 'link'));
  if (s.images) parts.push(plural(s.images, 'image'));
  outputStat.textContent = parts.join(' · ');
  // The box holds only text when the paste carried no HTML flavour (copied from a plain box or a
  // terminal) — the most common reason "nothing converted".
  const noFormatting = !s.headings && !s.lists && !s.tables && !s.links && !s.images && !/<(b|strong|i|em|code|span[^>]*style)/i.test(html);
  if (noFormatting) setStatus('info', 'This paste carried no formatting, so the output is the text as it was. Copy from the document itself (not from a plain-text field) for headings, bold and lists to come through.');
  else if (r.notes.length) setStatus('ok', r.notes.join(' '));
  else setStatus(null);
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
    showToast('Markdown copied');
  } catch {
    output.select();
    document.execCommand('copy');
    showToast('Copied');
  }
}

function downloadOutput() {
  if (!output.value) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([output.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'document.md';
  a.click();
  URL.revokeObjectURL(url);
}

// A paste lands in the box through the browser's own sanitised insertion (event handlers and
// scripts stripped, inline styles kept); the conversion reads the result on the next tick.
// Typing is debounced like every other tool so a keystroke never waits on the converter.
let renderTimer: number | undefined;
function scheduleRender(delay = 120) {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, delay);
}
input.addEventListener('input', () => scheduleRender());
input.addEventListener('paste', () => scheduleRender(0));
bullet.addEventListener('input', render);
bullet.addEventListener('change', () => trackOption(bullet));
wrapBtn.addEventListener('click', () => {
  const next = wrapBtn.getAttribute('aria-pressed') !== 'true';
  wrapBtn.setAttribute('aria-pressed', String(next));
  output.classList.toggle('no-wrap', next);
  trackOption(wrapBtn, next ? 'no-wrap' : 'wrap');
});
$('btn-copy').addEventListener('click', () => void copyOutput());
$('btn-download').addEventListener('click', downloadOutput);
$('btn-clear').addEventListener('click', () => {
  track('reset_tool');
  input.replaceChildren();
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  inputSource = 'sample';
  // Our own fixture of what Google Docs puts on the clipboard — no scripts, no handlers.
  input.innerHTML = SAMPLE_DOCS_HTML;
  render();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    window.clearTimeout(renderTimer);
    render();
    void copyOutput();
  }
});

render();
