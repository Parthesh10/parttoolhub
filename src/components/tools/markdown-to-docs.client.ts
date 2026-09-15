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

/** The rendered fragment and its plain-text twin — what the clipboard receives. */
let currentHtml = '';
let currentText = '';

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
async function copyRich() {
  if (!currentHtml) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'rich' });
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([currentHtml], { type: 'text/html' }),
      'text/plain': new Blob([currentText], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    setStatus('ok', 'Copied as formatted text. In Google Docs (or Word, Gmail, Teams) press Ctrl+V / ⌘V to paste with the formatting.');
    showToast('Copied — paste into Google Docs');
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
      showToast('Copied — paste into Google Docs');
    } else {
      setStatus('error', 'Your browser blocked clipboard access. Select the preview with the mouse and press Ctrl+C / ⌘C instead — the formatting comes with it.');
    }
  }
}

async function copyHtml() {
  if (!currentHtml) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'html' });
  try {
    await navigator.clipboard.writeText(currentHtml);
    showToast('HTML copied');
  } catch {
    showToast('Copy failed — your browser blocked clipboard access');
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
copyBtn.addEventListener('click', () => void copyRich());
copyHtmlBtn.addEventListener('click', () => void copyHtml());
downloadBtn.addEventListener('click', downloadHtml);
$('link-docs').addEventListener('click', () => track('tool_option', { option: 'link-docs', value: 'open' }, 'opt:link-docs'));
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
