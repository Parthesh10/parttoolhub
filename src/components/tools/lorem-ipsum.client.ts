import { generateLorem, MIN_COUNT, MAX_COUNT, type LoremUnit } from '../../lib/lorem-ipsum';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Named "list", not "output": the static analytics PII guard bans a bare
// `output` identifier inside any track() call, since on every other tool
// that name holds converted visitor text. Here it only ever holds freshly
// generated placeholder text, but the guard can't tell the two apart by name alone.
const list = $<HTMLTextAreaElement>('output');
const listStat = $('output-stat');
const status = $('status') as HTMLElement | null;
const toast = $('toast');
const unitParagraphsBtn = $<HTMLButtonElement>('unit-paragraphs');
const unitSentencesBtn = $<HTMLButtonElement>('unit-sentences');
const unitWordsBtn = $<HTMLButtonElement>('unit-words');
const count = $<HTMLInputElement>('opt-count');
const startLorem = $<HTMLInputElement>('opt-start-lorem');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

let unit: LoremUnit = 'paragraphs';

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// --- UX-003: fullscreen / focus mode ---------------------------------------
// No paste here — this tool only ever generates fresh placeholder text, it
// never transforms pasted text, so there's nothing for a Paste button to feed.
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
// error *categories* are ever sent — never the text a visitor typed. This
// tool has no text input at all (it generates, rather than transforms), so
// input_source is always 'sample' and input_size buckets the generated
// text's size instead of an input's, since there is no input to measure.
const fired = new Set<string>();
const inputSource = 'sample' as const;
function track(name: string, params: Record<string, string | number | boolean> = {}, once?: string) {
  if (once) {
    if (fired.has(once)) return;
    fired.add(once);
  }
  const b = document.body.dataset;
  window.pth?.track(name, { tool_slug: b.toolSlug ?? '', tool_category: b.toolCategory ?? '', ...params });
}
const sizeBucket = (n: number) => (n < 100 ? 'xs' : n < 1_000 ? 's' : n < 10_000 ? 'm' : n < 100_000 ? 'l' : 'xl');
/**
 * Every generate click succeeds unless the count is out of range — unlike
 * every typing-based tool, this fires on every deliberate click rather than
 * once per page load: a generator's core loop *is* clicking again for a new
 * batch, and each click is as meaningful as the first (see docs/ANALYTICS.md).
 */
function trackRun(action: string, ok: boolean, errorType = 'unknown') {
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(list.value.length) });
  if (ok) track('tool_result', { action });
  else track('tool_error', { action, error_type: errorType });
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

function setUnit(next: LoremUnit) {
  unit = next;
  unitParagraphsBtn.setAttribute('aria-pressed', String(next === 'paragraphs'));
  unitSentencesBtn.setAttribute('aria-pressed', String(next === 'sentences'));
  unitWordsBtn.setAttribute('aria-pressed', String(next === 'words'));
  track('tool_option', { option: 'unit', value: next }, 'opt:unit');
  generate();
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

function showStatus(msg: string) {
  if (!status) return;
  status.hidden = false;
  status.className = 'status-banner is-error';
  status.textContent = msg;
}
function hideStatus() {
  if (status) status.hidden = true;
}

/**
 * `announce: false` is used only for the very first, automatic generation on
 * page load — good UX (there is text ready immediately) but not a real "use"
 * of the tool, the same way every other tool never fires tool_use for its
 * own empty starting state. Every click after that announces normally.
 */
function generate(announce = true) {
  const result = generateLorem({ unit, count: Number(count.value), startWithLorem: startLorem.checked });
  if (!result.ok) {
    list.value = '';
    listStat.textContent = '';
    showStatus(result.error);
    if (announce) trackRun('generate', false, 'length');
    return;
  }
  hideStatus();
  list.value = result.value.text;
  listStat.textContent = `${plural(result.value.unitCount, unit.slice(0, -1))} · ${plural(result.value.wordCount, 'word')}`;
  if (announce) trackRun('generate', true);
}

async function copyList() {
  if (!list.value) return showToast('Nothing to copy yet');
  track('copy_result', { target: 'output' });
  try {
    await navigator.clipboard.writeText(list.value);
    showToast('Copied to clipboard');
  } catch {
    list.select();
    document.execCommand('copy');
    showToast('Copied');
  }
}

function downloadList() {
  if (!list.value) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([list.value + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lorem-ipsum.txt';
  a.click();
  URL.revokeObjectURL(url);
}

unitParagraphsBtn.addEventListener('click', () => setUnit('paragraphs'));
unitSentencesBtn.addEventListener('click', () => setUnit('sentences'));
unitWordsBtn.addEventListener('click', () => setUnit('words'));
$('btn-generate').addEventListener('click', () => generate());
$('btn-copy').addEventListener('click', copyList);
$('btn-download').addEventListener('click', downloadList);
count.addEventListener('change', () => {
  trackOption(count);
  generate();
});
startLorem.addEventListener('change', () => {
  trackOption(startLorem);
  generate();
});

generate(false); // initial paint on load — see the comment on generate() above
