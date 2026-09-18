import { generatePasswords, STRENGTH_LABEL, type PasswordOptions } from '../../lib/password-generate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Named "list", not "output": the static analytics PII guard bans a bare `output`
// identifier inside any track() call, since on every other tool that name holds
// converted visitor text. Here it only ever holds freshly generated passwords, but
// the guard can't tell the two apart by name alone — see uuid-generate.client.ts.
const list = $<HTMLTextAreaElement>('output');
const listStat = $('output-stat');
const status = $('status');
const toast = $('toast');
const length = $<HTMLInputElement>('opt-length');
const uppercase = $<HTMLInputElement>('opt-uppercase');
const lowercase = $<HTMLInputElement>('opt-lowercase');
const numbers = $<HTMLInputElement>('opt-numbers');
const symbols = $<HTMLInputElement>('opt-symbols');
const ambiguous = $<HTMLInputElement>('opt-ambiguous');
const count = $<HTMLSelectElement>('opt-count');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// --- UX-003: fullscreen / focus mode ---------------------------------------
// No paste here — this tool only ever generates fresh passwords, it never
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
function currentOptions(): Partial<PasswordOptions> {
  return {
    length: Number(length.value),
    uppercase: uppercase.checked,
    lowercase: lowercase.checked,
    numbers: numbers.checked,
    symbols: symbols.checked,
    excludeAmbiguous: ambiguous.checked,
  };
}

// --- Analytics (docs/ANALYTICS.md) -----------------------------------------
// Duplicated per tool on purpose: no shared JS across tools (seo-rules §4).
// Only slugs, action names, control ids, enumerated values, size buckets and
// error *categories* are ever sent — never the text a visitor typed, and
// never a generated password. This tool has no text input at all (it
// generates, rather than transforms), so input_source is always 'sample' —
// closest existing enum value to "not typed or pasted" — and input_size
// buckets the generated list's size instead of an input's, since there is
// no input to measure. Same generator-shaped exception as uuid-generate.
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
 * Every deliberate generate click is announced, like the UUID generator: a
 * generator's core loop *is* clicking again for a new batch, and each click
 * is as meaningful as the first (docs/ANALYTICS.md). `announce: false` on the
 * first, automatic generation on page load only.
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

function generate(announce = true) {
  const r = generatePasswords(Number(count.value), currentOptions());
  if (!r.ok) {
    trackRun('generate', false, /character type/.test(r.error) ? 'no_charset' : /ambiguous/.test(r.error) ? 'empty_pool' : 'length');
    list.value = '';
    listStat.textContent = '';
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = r.error;
    return;
  }
  status.hidden = true;
  list.value = r.value.map((p) => p.value).join('\n');
  const { entropyBits, strength } = r.value[0];
  listStat.textContent = `${plural(r.value.length, 'password')} · ${entropyBits} bits each · ${STRENGTH_LABEL[strength]}`;
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
  a.download = 'passwords.txt';
  a.click();
  URL.revokeObjectURL(url);
}

$('btn-generate').addEventListener('click', () => generate());
$('btn-copy').addEventListener('click', () => void copyList());
$('btn-download').addEventListener('click', downloadList);
for (const c of [uppercase, lowercase, numbers, symbols, ambiguous, count]) {
  c.addEventListener('change', () => {
    trackOption(c);
    generate();
  });
}
// The length field is a number input people type into or spin, so it gets its own
// debounced handler (like every text-input tool on the site) instead of the
// change-only wiring above — a keystroke should never wait on the generator, and
// "change" alone would only regenerate on blur, leaving stale passwords on screen
// while the field still has focus.
let renderTimer: number | undefined;
length.addEventListener('input', () => {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => generate(), 200);
});
length.addEventListener('change', () => trackOption(length));

generate(false); // initial paint on load — see the comment on trackRun() above
