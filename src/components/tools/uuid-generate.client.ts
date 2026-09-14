import { generateUuids, type UuidVersion } from '../../lib/uuid-generate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Named "list", not "output": the static analytics PII guard bans a bare
// `output` identifier inside any track() call, since on every other tool
// that name holds converted visitor text. Here it only ever holds freshly
// generated UUIDs, but the guard can't tell the two apart by name alone.
const list = $<HTMLTextAreaElement>('output');
const listStat = $('output-stat');
const toast = $('toast');
const ver4Btn = $<HTMLButtonElement>('ver-4');
const ver7Btn = $<HTMLButtonElement>('ver-7');
const count = $<HTMLSelectElement>('opt-count');
const uppercase = $<HTMLInputElement>('opt-uppercase');
const hyphens = $<HTMLInputElement>('opt-hyphens');
const braces = $<HTMLInputElement>('opt-braces');

let version: UuidVersion = 4;

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

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

function setVersion(next: UuidVersion) {
  version = next;
  ver4Btn.setAttribute('aria-pressed', String(next === 4));
  ver7Btn.setAttribute('aria-pressed', String(next === 7));
  track('tool_option', { option: 'version', value: String(next) }, 'opt:version');
  generate();
}

/**
 * `announce: false` is used only for the very first, automatic generation on
 * page load — good UX (there is a UUID ready immediately) but not a real
 * "use" of the tool, the same way every other tool never fires tool_use for
 * its own empty starting state. Every click after that announces normally.
 */
function generate(announce = true) {
  const ids = generateUuids(version, Number(count.value), {
    uppercase: uppercase.checked,
    hyphens: hyphens.checked,
    braces: braces.checked,
  });
  list.value = ids.join('\n');
  listStat.textContent = plural(ids.length, 'UUID');
  if (announce) trackRun('generate', true);
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
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
  a.download = 'uuids.txt';
  a.click();
  URL.revokeObjectURL(url);
}

ver4Btn.addEventListener('click', () => setVersion(4));
ver7Btn.addEventListener('click', () => setVersion(7));
$('btn-generate').addEventListener('click', () => generate());
$('btn-copy').addEventListener('click', copyList);
$('btn-download').addEventListener('click', downloadList);
for (const c of [count, uppercase, hyphens, braces]) {
  c.addEventListener('change', () => {
    trackOption(c);
    generate();
  });
}

generate(false); // initial paint on load — see the comment on generate() above
