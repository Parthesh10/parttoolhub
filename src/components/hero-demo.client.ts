import { convertAll } from '../lib/case-convert';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('demo-input');
const toast = $('demo-toast');
const rows = [...document.querySelectorAll<HTMLButtonElement>('.demo-row')];

function render() {
  const all = convertAll(input.value);
  for (const row of rows) {
    const style = row.dataset.style as keyof typeof all;
    const value = row.querySelector<HTMLElement>('[data-value]')!;
    value.textContent = all[style] || '—';
  }
}

let toastTimer: number | undefined;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1400);
}

async function copyRow(row: HTMLButtonElement) {
  const value = row.querySelector<HTMLElement>('[data-value]')!.textContent ?? '';
  if (!value || value === '—') return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* clipboard blocked — still flash the row so the click feels acknowledged */
  }
  row.classList.add('just-copied');
  window.setTimeout(() => row.classList.remove('just-copied'), 700);
  showToast('Copied');
}

// No debounce: convertAll() is a handful of regex passes over a short phrase,
// far under the 50 ms budget, and instant feedback is the whole point of a demo.
input.addEventListener('input', render);
for (const row of rows) row.addEventListener('click', () => void copyRow(row));

render();
