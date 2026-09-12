import { decodeJwt, relativeTime } from '../../lib/jwt-decode';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const inputStat = $('input-stat');
const status = $('status');
const result = $('result');
const timing = $('timing');
const headerOut = $<HTMLTextAreaElement>('header-out');
const payloadOut = $<HTMLTextAreaElement>('payload-out');
const toast = $('toast');

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ.' +
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

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
  try {
    await navigator.clipboard.writeText(el.value);
    showToast('Copied to clipboard');
  } catch {
    el.select();
    document.execCommand('copy');
    showToast('Copied');
  }
}

input.addEventListener('input', render);
$('btn-clear').addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});
$('btn-sample').addEventListener('click', () => {
  input.value = SAMPLE;
  render();
});
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', () => copyField(btn.dataset.copy!)),
);

render();
