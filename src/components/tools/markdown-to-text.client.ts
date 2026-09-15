import { parseMarkdown, renderText, summarize, TEXT_MODES, SAMPLE_MARKDOWN, type TextMode, type LinkStyle } from '../../lib/markdown';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLTextAreaElement>('output');
const outputLabel = $('output-label');
const inputStat = $('input-stat');
const outputStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const modeHint = $('mode-hint');
const links = $<HTMLSelectElement>('opt-links');
const modeChips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-mode]')];

let mode: TextMode = 'plain';

const MODE_LABEL: Record<TextMode, string> = { plain: 'Plain text', slack: 'Slack', whatsapp: 'WhatsApp', 'google-chat': 'Google Chat' };
const MODE_HINT: Record<TextMode, string> = {
  plain: 'Formatting removed; bullets, numbering, quotes and tables kept as text.',
  slack: 'Slack markup: *bold*, _italic_, ~strike~, `code`, ``` blocks and > quotes. Slack has no list syntax, so bullets are • characters.',
  whatsapp: 'WhatsApp markup: *bold*, _italic_, ~strike~, `code`, ``` blocks, "- " bullets, "1. " numbers and > quotes.',
  'google-chat': 'Google Chat markup: *bold*, _italic_, ~strike~, `code`, ``` blocks, "- " bullets and > quotes.',
};

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

function setMode(next: TextMode) {
  mode = next;
  for (const chip of modeChips) chip.setAttribute('aria-pressed', String(chip.dataset.mode === next));
  outputLabel.textContent = MODE_LABEL[next];
  modeHint.textContent = MODE_HINT[next];
  track('tool_option', { option: 'mode', value: next }, `opt:mode:${next}`);
  render();
}

function render() {
  const raw = input.value;
  inputStat.textContent = plural(raw.length, 'character');

  if (!raw.trim()) {
    output.value = '';
    outputStat.textContent = '';
    status.hidden = true;
    return;
  }

  const blocks = parseMarkdown(raw);
  const style = { ...TEXT_MODES[mode], links: links.value as LinkStyle };
  const text = renderText(blocks, style);
  const s = summarize(blocks);
  trackRun(`convert:${mode}`, true);

  output.value = text;
  const parts = [plural(s.words, 'word')];
  if (s.headings) parts.push(plural(s.headings, 'heading'));
  if (s.lists) parts.push(plural(s.lists, 'list'));
  if (s.tables) parts.push(plural(s.tables, 'table'));
  if (s.codeBlocks) parts.push(plural(s.codeBlocks, 'code block'));
  if (s.links) parts.push(plural(s.links, 'link'));
  outputStat.textContent = parts.join(' · ');

  // Nothing structural and nothing removed: tell them so rather than leaving an identical box.
  const unchanged = text.trim() === raw.trim();
  status.hidden = !unchanged;
  if (unchanged) {
    status.className = 'status-banner';
    status.textContent = 'No Markdown found: the text is already plain, so the output is the same as the input.';
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

function downloadOutput() {
  if (!output.value) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = mode === 'plain' ? 'text.txt' : `${mode}.txt`;
  a.click();
  URL.revokeObjectURL(url);
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
for (const chip of modeChips) chip.addEventListener('click', () => setMode((chip.dataset.mode ?? 'plain') as TextMode));
links.addEventListener('input', render);
links.addEventListener('change', () => trackOption(links));
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
  input.value = SAMPLE_MARKDOWN;
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
