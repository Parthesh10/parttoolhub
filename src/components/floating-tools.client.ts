import { RECENT_TOOLS_KEY, MAX_RECENT_TOOLS, pushRecent, parseRecent } from '../lib/recent-tools';
import { FAVORITE_TOOLS_KEY, toggleFavorite, parseFavorites } from '../lib/favorite-tools';

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
const fabToast = $('fab-toast');
const shortcutsBackdrop = $('shortcuts-backdrop');
const footerShortcutsBtn = $<HTMLButtonElement>('footer-shortcuts');

const ALL: Entry[] = JSON.parse($('tools-index').textContent ?? '[]');
const BY_HREF = new Map(ALL.map((e) => [e.href, e]));

// --- Recently used tools: recorded on every tool-page visit, surfaced in the
// command palette's empty-query state so a returning visitor's own habits —
// not a fixed editorial order — decide what shows up first. ---
const currentSlug = document.body.dataset.toolSlug;
if (currentSlug) {
  try {
    const stored = parseRecent(localStorage.getItem(RECENT_TOOLS_KEY));
    localStorage.setItem(RECENT_TOOLS_KEY, JSON.stringify(pushRecent(stored, currentSlug, MAX_RECENT_TOOLS)));
  } catch {
    /* localStorage can throw in private-browsing/storage-blocked contexts; recency is a nicety, not required. */
  }
}
function recentEntries(): Entry[] {
  try {
    const slugs = parseRecent(localStorage.getItem(RECENT_TOOLS_KEY));
    return slugs.map((slug) => BY_HREF.get(`/tools/${slug}`)).filter((e): e is Entry => Boolean(e));
  } catch {
    return [];
  }
}

// --- UX-010: favorites (pin a tool), alongside the recently-used list above. ---
function favoriteSlugs(): string[] {
  try {
    return parseFavorites(localStorage.getItem(FAVORITE_TOOLS_KEY));
  } catch {
    return [];
  }
}
function favoriteEntries(): Entry[] {
  const slugs = favoriteSlugs();
  return slugs.map((slug) => BY_HREF.get(`/tools/${slug}`)).filter((e): e is Entry => Boolean(e)).reverse(); // most-recently-pinned first
}
function isFavorited(href: string): boolean {
  const slug = href.split('/').pop() ?? '';
  return favoriteSlugs().includes(slug);
}
function toggleFavoriteBySlug(slug: string) {
  const current = favoriteSlugs();
  try {
    localStorage.setItem(FAVORITE_TOOLS_KEY, JSON.stringify(toggleFavorite(current, slug)));
  } catch {
    /* localStorage can throw in private-browsing/storage-blocked contexts; favoriting is a nicety, not required. */
  }
}
function starButton(entry: Entry): string {
  const slug = entry.href.split('/').pop() ?? '';
  const on = isFavorited(entry.href);
  return `<button type="button" class="r-star" data-slug="${escapeHtml(slug)}" aria-pressed="${on}" aria-label="${on ? 'Remove from favorites' : 'Add to favorites'}" tabindex="-1">${on ? '★' : '☆'}</button>`;
}

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

function resultRow(e: Entry, i: number): string {
  return `<li role="option" aria-selected="${i === 0}">${starButton(e)}<a href="${e.href}" tabindex="-1">
    <span class="r-name">${escapeHtml(e.name)}</span><span class="r-meta">${escapeHtml(e.category)}</span>
    <span class="r-short">${escapeHtml(e.short)}</span>
  </a></li>`;
}

function renderResults() {
  const q = paletteInput.value.trim().toLowerCase();
  let html = '';
  if (!q) {
    const favorites = favoriteEntries();
    const favSlugs = new Set(favoriteSlugs());
    const recent = recentEntries().filter((e) => !favSlugs.has(e.href.split('/').pop() ?? ''));
    // Favorites are a deliberate choice, so they lead; recently used fills in after; a
    // first-time visitor with neither still sees the full list, not a blank state.
    const sections: { heading: string | null; entries: Entry[] }[] =
      favorites.length || recent.length
        ? [
            ...(favorites.length ? [{ heading: 'Favorites', entries: favorites }] : []),
            ...(recent.length ? [{ heading: 'Recently used', entries: recent }] : []),
          ]
        : [{ heading: null, entries: ALL }];
    visible = [];
    let i = 0;
    for (const section of sections) {
      const remaining = 8 - visible.length;
      if (remaining <= 0) break;
      const entries = section.entries.slice(0, remaining);
      if (!entries.length) continue;
      if (section.heading) html += `<li class="r-heading" role="presentation">${section.heading}</li>`;
      for (const e of entries) {
        html += resultRow(e, i);
        visible.push(e);
        i++;
      }
    }
  } else {
    visible = ALL.map((e) => [e, score(e, q)] as const)
      .filter(([, s]) => s >= 0)
      .sort((a, b) => a[1] - b[1])
      .map(([e]) => e)
      .slice(0, 8);
    html = visible.map((e, i) => resultRow(e, i)).join('');
  }
  selected = 0;
  emptyEl.hidden = visible.length > 0;
  resultsEl.innerHTML = html;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(next: number) {
  // The optional "Recently used" heading is a plain <li> too (for layout inside the
  // <ul>), but it isn't a selectable option, so it's excluded from this list.
  const items = [...resultsEl.querySelectorAll('li[role="option"]')];
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
resultsEl.addEventListener('click', (e) => {
  const star = (e.target as HTMLElement).closest<HTMLButtonElement>('.r-star');
  if (!star) return;
  e.preventDefault();
  e.stopPropagation();
  const slug = star.dataset.slug ?? '';
  toggleFavoriteBySlug(slug);
  window.pth?.track('tool_option', { option: 'favorite', value: isFavorited(`/tools/${slug}`) ? 'add' : 'remove' });
  renderResults();
});

// Global shortcut: Ctrl+K / Cmd+K only (never a bare key like "/", which would
// hijack typing into any tool's textarea).
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (backdrop.hidden) openPalette();
    else closePalette();
  }
});

// --- UX-013: keyboard-shortcuts help dialog ---------------------------------
// "?" is a bare key, unlike Ctrl+K — every tool's textarea needs to accept a
// literal "?" while typing, so this only fires when focus isn't in a text
// field, a <select>, or any contenteditable box (Google Docs to Markdown's
// paste target included).
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}
function openShortcuts() {
  shortcutsBackdrop.hidden = false;
  document.addEventListener('keydown', onShortcutsKeydown);
}
function closeShortcuts() {
  shortcutsBackdrop.hidden = true;
  document.removeEventListener('keydown', onShortcutsKeydown);
}
function onShortcutsKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeShortcuts();
  }
}
footerShortcutsBtn?.addEventListener('click', () => (shortcutsBackdrop.hidden ? openShortcuts() : closeShortcuts()));
shortcutsBackdrop.addEventListener('click', (e) => {
  if (e.target === shortcutsBackdrop) closeShortcuts();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '?' && !isEditableTarget(document.activeElement) && backdrop.hidden) {
    e.preventDefault();
    if (shortcutsBackdrop.hidden) openShortcuts();
    else closeShortcuts();
  }
});

// --- Share FAB: only rendered on tool pages (see FloatingTools.astro), so every
// lookup here is guarded rather than assumed present. ---
const fabShare = document.getElementById('fab-share') as HTMLButtonElement | null;
const shareMenu = document.getElementById('share-menu');
const shareCopy = document.getElementById('share-copy');
const shareReddit = document.getElementById('share-reddit');

let toastTimer: number | undefined;
function showToast(msg: string) {
  fabToast.textContent = msg;
  fabToast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (fabToast.hidden = true), 1800);
}

if (fabShare && shareMenu && shareCopy && shareReddit) {
  const closeShareMenu = () => {
    shareMenu.hidden = true;
    fabShare.setAttribute('aria-expanded', 'false');
  };
  fabShare.addEventListener('click', () => {
    const opening = shareMenu.hidden;
    shareMenu.hidden = !opening;
    fabShare.setAttribute('aria-expanded', String(opening));
  });
  document.addEventListener('click', (e) => {
    if (!shareMenu.hidden && !e.composedPath().includes(fabShare) && !e.composedPath().includes(shareMenu)) closeShareMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !shareMenu.hidden) closeShareMenu();
  });
  const shareParams = { tool_slug: currentSlug ?? '', tool_category: document.body.dataset.toolCategory ?? '' };
  shareCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied');
      window.pth?.track('share_click', { ...shareParams, channel: 'copy_link' });
    } catch {
      showToast('Could not copy link');
    }
    closeShareMenu();
  });
  shareReddit.addEventListener('click', () => {
    const url = new URL('https://www.reddit.com/submit');
    url.searchParams.set('url', window.location.href);
    url.searchParams.set('title', document.title);
    window.open(url.href, '_blank', 'noopener,noreferrer');
    window.pth?.track('share_click', { ...shareParams, channel: 'reddit' });
    closeShareMenu();
  });
}
