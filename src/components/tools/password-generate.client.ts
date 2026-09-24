import { generatePasswords, crackTimeText, STRENGTH_LABEL, GUESSES_PER_SECOND, type PasswordOptions, type Password } from '../../lib/password-generate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The generated batch lives in `batch`, never in a variable named "output": the static
// analytics PII guard bans a bare `output` identifier inside any track() call, since on every
// other tool that name holds converted visitor text (see uuid-generate.client.ts).
let batch: Password[] = [];
const valueEl = $('pw-value');
const listEl = $('pw-list');
const meter = $('pw-meter');
const meterLabel = $('output-stat');
const status = $('status');
const toast = $('toast');
const copyBtn = $<HTMLButtonElement>('btn-copy');
const length = $<HTMLInputElement>('opt-length');
const lengthRange = $<HTMLInputElement>('opt-length-range');
const uppercase = $<HTMLInputElement>('opt-uppercase');
const lowercase = $<HTMLInputElement>('opt-lowercase');
const numbers = $<HTMLInputElement>('opt-numbers');
const symbols = $<HTMLInputElement>('opt-symbols');
const ambiguous = $<HTMLInputElement>('opt-ambiguous');
const count = $<HTMLSelectElement>('opt-count');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

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
  track('tool_use', { action, success: ok, input_source: inputSource, input_size: sizeBucket(batchText().length) });
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

// --- Redesign round 1: rendering -------------------------------------------
const batchText = () => batch.map((p) => p.value).join('\n');
const escapeHtml = (c: string) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c);
/** One span per digit / symbol so they read apart from letters (0 vs O, 1 vs l). */
function colouredHtml(pw: string): string {
  let html = '';
  for (const c of pw) {
    if (c >= '0' && c <= '9') html += `<span class="pw-d">${c}</span>`;
    else if (/[A-Za-z]/.test(c)) html += c;
    else html += `<span class="pw-s">${escapeHtml(c)}</span>`;
  }
  return html;
}
function render() {
  const many = batch.length > 1;
  valueEl.hidden = many;
  listEl.hidden = !many;
  copyBtn.textContent = many ? 'Copy all' : 'Copy';
  if (many) {
    listEl.innerHTML = batch
      .map((p, i) => `<div class="pw-row"><code>${colouredHtml(p.value)}</code><button type="button" class="btn btn-sm" data-copy-index="${i}">Copy</button></div>`)
      .join('');
  } else {
    valueEl.innerHTML = batch[0] ? colouredHtml(batch[0].value) : '';
  }
  const first = batch[0];
  meter.dataset.strength = first ? first.strength : 'none';
  meterLabel.innerHTML = first
    ? `<strong>${STRENGTH_LABEL[first.strength]}</strong> · ${first.entropyBits} bits · ${crackTimeText(first.entropyBits)} to guess at ${(GUESSES_PER_SECOND / 1e9).toLocaleString()} billion guesses a second${many ? ` · all ${batch.length} are equally strong` : ''}`
    : '';
}

function generate(announce = true) {
  const r = generatePasswords(Number(count.value), currentOptions());
  if (!r.ok) {
    trackRun('generate', false, /character type/.test(r.error) ? 'no_charset' : /ambiguous/.test(r.error) ? 'empty_pool' : 'length');
    batch = [];
    render();
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = r.error;
    return;
  }
  status.hidden = true;
  batch = r.value;
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
  if (!batch.length) return showToast('Nothing to download yet');
  track('download_result', { target: 'output' });
  const blob = new Blob([batchText() + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'passwords.txt';
  a.click();
  URL.revokeObjectURL(url);
}

$('btn-generate').addEventListener('click', () => generate());
copyBtn.addEventListener('click', () => void copyText(batchText(), 'output'));
listEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-index]');
  if (btn) void copyText(batch[Number(btn.dataset.copyIndex)]?.value ?? '', 'row');
});
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
// while the field still has focus. The slider and the field mirror each other; the
// field can go past the slider's 64 (up to 128), which pins the slider at its end.
let renderTimer: number | undefined;
function scheduleGenerate() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => generate(), 120);
}
length.addEventListener('input', () => {
  lengthRange.value = String(Math.min(64, Math.max(4, Number(length.value) || 4)));
  scheduleGenerate();
});
lengthRange.addEventListener('input', () => {
  length.value = lengthRange.value;
  scheduleGenerate();
});
length.addEventListener('change', () => trackOption(length));
lengthRange.addEventListener('change', () => trackOption(lengthRange, 'slider'));

generate(false); // initial paint on load — see the comment on trackRun() above
