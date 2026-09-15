interface Entry {
  name: string;
  short: string;
  category: string;
  href: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fabTop = $<HTMLButtonElement>('fab-top');
const fabSearch = $<HTMLButtonElement>('fab-search');
const backdrop = $('palette-backdrop');
const paletteInput = $<HTMLInputElement>('palette-input');
const resultsEl = $<HTMLUListElement>('palette-results');
const emptyEl = $('palette-empty');

const ALL: Entry[] = JSON.parse($('tools-index').textContent ?? '[]');

// --- Back to top: appears once the hero has scrolled past, not on a short page. ---
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    fabTop.hidden = window.scrollY < 480;
    ticking = false;
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();
fabTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

// --- Command palette: fuzzy-ish substring match over name/short/category, ranked
// with name-matches first, keyboard-navigable, closes on Escape or an outside click. ---
let selected = 0;
let visible: Entry[] = [];

function score(entry: Entry, q: string): number {
  const name = entry.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (entry.category.toLowerCase().includes(q)) return 3;
  if (entry.short.toLowerCase().includes(q)) return 4;
  return -1;
}

function renderResults() {
  const q = paletteInput.value.trim().toLowerCase();
  visible = !q
    ? ALL
    : ALL.map((e) => [e, score(e, q)] as const)
        .filter(([, s]) => s >= 0)
        .sort((a, b) => a[1] - b[1])
        .map(([e]) => e);
  visible = visible.slice(0, 8);
  selected = 0;
  emptyEl.hidden = visible.length > 0;
  resultsEl.innerHTML = visible
    .map(
      (e, i) => `<li role="option" aria-selected="${i === 0}"><a href="${e.href}" tabindex="-1">
        <span class="r-name">${escapeHtml(e.name)}</span><span class="r-meta">${escapeHtml(e.category)}</span>
        <span class="r-short">${escapeHtml(e.short)}</span>
      </a></li>`,
    )
    .join('');
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(next: number) {
  const items = [...resultsEl.querySelectorAll('li')];
  items.forEach((li, i) => li.setAttribute('aria-selected', String(i === next)));
  items[next]?.scrollIntoView({ block: 'nearest' });
  selected = next;
}

function openPalette() {
  backdrop.hidden = false;
  paletteInput.value = '';
  renderResults();
  // Focus after the element is visible, not mid-paint.
  requestAnimationFrame(() => paletteInput.focus());
  document.addEventListener('keydown', onPaletteKeydown);
}
function closePalette() {
  backdrop.hidden = true;
  document.removeEventListener('keydown', onPaletteKeydown);
  fabSearch.focus();
}

function onPaletteKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (visible.length) highlight((selected + 1) % visible.length);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (visible.length) highlight((selected - 1 + visible.length) % visible.length);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = visible[selected];
    if (target) window.location.href = target.href;
  }
}

fabSearch.addEventListener('click', openPalette);
backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) closePalette();
});
paletteInput.addEventListener('input', renderResults);

// Global shortcut: Ctrl+K / Cmd+K only (never a bare key like "/", which would
// hijack typing into any tool's textarea).
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (backdrop.hidden) openPalette();
    else closePalette();
  }
});
