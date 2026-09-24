import { generateUuids, v7TimestampFromString, type UuidVersion } from '../../lib/uuid-generate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The batch lives in `ids`, never in a variable named "output": the static analytics PII guard
// bans a bare `output` identifier inside any track() call, since on every other tool that name
// holds converted visitor text. Here it only ever holds freshly generated UUIDs, but the guard
// can't tell the two apart by name alone.
let ids: string[] = [];
const listEl = $('uu-list');
const listStat = $('output-stat');
const verHint = $('ver-hint');
const countDec = $<HTMLButtonElement>('count-dec');
const countInc = $<HTMLButtonElement>('count-inc');
const toast = $('toast');
const ver4Btn = $<HTMLButtonElement>('ver-4');
const ver7Btn = $<HTMLButtonElement>('ver-7');
const count = $<HTMLInputElement>('opt-count');
const uppercase = $<HTMLInputElement>('opt-uppercase');
const hyphens = $<HTMLInputElement>('opt-hyphens');
const braces = $<HTMLInputElement>('opt-braces');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

let version: UuidVersion = 4;

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// --- UX-003: fullscreen / focus mode ---------------------------------------
// No paste here — this tool only ever generates fresh UUIDs, it never
// transforms pasted text, so there's nothing for a Paste button to feed.
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
// input_source is always 'sample' — closest existing enum value to "not
// typed or pasted" — and input_size buckets the generated list's size
// instead of an input's, since there is no input to measure.
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
 * Every generate click succeeds — there is no invalid input to reject. Unlike
 * every typing-based tool, this fires on every deliberate click rather than
 * once per page load: a generator's core loop *is* clicking again for a new
 * batch, and each click is as meaningful as the first (see docs/ANALYTICS.md).
 */
function trackRun(action: string, ok: boolean, errorType = 'unknown') {
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(ids.join('\n').length) });
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

function setVersion(next: UuidVersion) {
  version = next;
  ver4Btn.setAttribute('aria-pressed', String(next === 4));
  ver7Btn.setAttribute('aria-pressed', String(next === 7));
  verHint.textContent = next === 4
    ? 'Fully random. The default choice for most IDs.'
    : 'Starts with the creation time, so IDs sort by when they were made (good for database keys).';
  track('tool_option', { option: 'version', value: String(next) }, 'opt:version');
  generate();
}

/**
 * `announce: false` is used only for the very first, automatic generation on
 * page load — good UX (there is a UUID ready immediately) but not a real
 * "use" of the tool, the same way every other tool never fires tool_use for
 * its own empty starting state. Every click after that announces normally.
 */
/** The count field, clamped to what the tool offers (1-100); an empty or bad value reads as 1. */
function countValue(): number {
  return Math.min(100, Math.max(1, Math.floor(Number(count.value)) || 1));
}
function render() {
  listEl.classList.toggle('is-single', ids.length === 1);
  listEl.innerHTML = ids
    .map((id, i) => `<div class="uu-row"><span class="uu-n">${i + 1}</span><code>${id}</code><button type="button" class="btn btn-sm" data-copy-index="${i}">Copy</button></div>`)
    .join('');
  let text = plural(ids.length, 'UUID');
  const ts = version === 7 && ids[0] ? v7TimestampFromString(ids[0]) : null;
  if (ts !== null) {
    const iso = new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');
    text += ` · version 7, created ${iso}${ids.length > 1 ? ' (the whole batch shares this millisecond)' : ''}`;
  } else {
    text += ' · version 4, random';
  }
  listStat.textContent = text;
}
function generate(announce = true) {
  ids = generateUuids(version, countValue(), {
    uppercase: uppercase.checked,
    hyphens: hyphens.checked,
    braces: braces.checked,
  });
  render();
  if (announce) trackRun('generate', true);
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyText(text: string, target: string) {
  if (!text) return showToast('Nothing to copy yet');
  track('copy_result', { target });
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    // Clipboard API blocked: copy through a temporary, off-screen textarea instead.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copied');
  }
}

function downloadList() {
  if (!ids.length) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([ids.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'uuids.txt';
  a.click();
  URL.revokeObjectURL(url);
}

ver4Btn.addEventListener('click', () => setVersion(4));
ver7Btn.addEventListener('click', () => setVersion(7));
$('btn-generate').addEventListener('click', () => generate());
$('btn-copy').addEventListener('click', () => void copyText(ids.join('\n'), 'output'));
listEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-index]');
  if (btn) void copyText(ids[Number(btn.dataset.copyIndex)] ?? '', 'row');
});
$('btn-download').addEventListener('click', downloadList);
for (const c of [uppercase, hyphens, braces]) {
  c.addEventListener('change', () => {
    trackOption(c);
    generate();
  });
}
// Count: stepper buttons, quick presets and typing all land in the same field. Typing is
// debounced like every text input on the site; the buttons regenerate at once.
function setCount(n: number) {
  const clamped = Math.min(100, Math.max(1, n));
  count.value = String(clamped);
  // The clamped number, never count.value: the PII guard bans reading a field's value into track().
  track('tool_option', { option: 'count', value: clamped }, 'opt:count');
  generate();
}
countDec.addEventListener('click', () => setCount(countValue() - 1));
countInc.addEventListener('click', () => setCount(countValue() + 1));
document.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) =>
  b.addEventListener('click', () => setCount(Number(b.dataset.count))),
);
let countTimer: number | undefined;
count.addEventListener('input', () => {
  window.clearTimeout(countTimer);
  countTimer = window.setTimeout(() => generate(), 200);
});
count.addEventListener('change', () => {
  count.value = String(countValue());
  trackOption(count);
});

generate(false); // initial paint on load — see the comment on generate() above
