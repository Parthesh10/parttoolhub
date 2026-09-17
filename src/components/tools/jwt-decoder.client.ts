import { decodeJwt, relativeTime, SAMPLE_TOKEN } from '../../lib/jwt-decode';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const status = $('status');
const result = $('result');
const timing = $('timing');
const headerOut = $<HTMLTextAreaElement>('header-out');
const payloadOut = $<HTMLTextAreaElement>('payload-out');
const toast = $('toast');
const pasteBtn = $<HTMLButtonElement>('btn-paste');
const fullscreenBtn = $<HTMLButtonElement>('btn-fullscreen');
const toolSection = $('tool');

const SAMPLE = SAMPLE_TOKEN;

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

// --- UX-002: paste from clipboard + drag-and-drop file upload -------------
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return showToast('Clipboard is empty');
    inputSource = 'pasted';
    input.value = text;
    render();
  } catch {
    showToast('Clipboard permission denied — use Ctrl+V instead');
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
  input.value = fileText.trim();
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

function fmtClaimTime(d: Date | undefined): string {
  if (!d) return '—';
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} (${relativeTime(d)})`;
}

function render() {
  const raw = input.value;
  inputStat.textContent = raw.trim() ? '' : 'Paste a token to decode';

  const r = decodeJwt(raw);
  if (!raw.trim()) {
    status.hidden = true;
    result.hidden = true;
    return;
  }
  trackRun(
    'decode',
    r.ok,
    r.ok
      ? undefined
      : /dot-separated/.test(r.error) ? 'segments'
        : /Base64URL/.test(r.error) ? 'base64url'
          : /not valid JSON/.test(r.error) ? 'json'
            : /JSON object/.test(r.error) ? 'object'
              : /cannot be empty/.test(r.error) ? 'empty_segment'
                : 'other',
  );
  if (!r.ok) {
    status.hidden = false;
    status.className = 'status-banner is-error';
    status.textContent = r.error;
    result.hidden = true;
    return;
  }

  status.hidden = true;
  result.hidden = false;
  headerOut.value = JSON.stringify(r.jwt.header, null, 2);
  payloadOut.value = JSON.stringify(r.jwt.payload, null, 2);

  const t = r.jwt.timing;
  const items: string[] = [];
  items.push(`<div class="item"><span class="k">Issued</span><span class="v">${fmtClaimTime(t.iat)}</span></div>`);
  items.push(
    `<div class="item"><span class="k">Expires</span><span class="v ${t.expired ? 'expired' : t.exp ? 'valid' : ''}">${fmtClaimTime(t.exp)}${
      t.expired === true ? ' — expired' : t.expired === false ? ' — valid' : ''
    }</span></div>`,
  );
  if (t.nbf) {
    items.push(
      `<div class="item"><span class="k">Not before</span><span class="v ${t.notYetValid ? 'expired' : 'valid'}">${fmtClaimTime(t.nbf)}</span></div>`,
    );
  }
  timing.innerHTML = items.join('');
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copyField(id: string) {
  const el = $<HTMLTextAreaElement>(id);
  if (!el.value) return showToast('Nothing to copy yet');
  track('copy_result', { target: id === 'header-out' ? 'header' : 'payload' });
  try {
    await navigator.clipboard.writeText(el.value);
    showToast('Copied to clipboard');
  } catch {
    el.select();
    document.execCommand('copy');
    showToast('Copied');
  }
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
pasteBtn.addEventListener('click', pasteFromClipboard);
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
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', () => copyField(btn.dataset.copy!)),
);

render();
