import { RECENT_TOOLS_KEY, MAX_RECENT_TOOLS, pushRecent, parseRecent } from '../lib/recent-tools';
import { FAVORITE_TOOLS_KEY, toggleFavorite, parseFavorites } from '../lib/favorite-tools';
import { matchesSynonym } from '../lib/tool-synonyms';

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

// --- Phones: tuck the buttons away while reading or typing (UI audit 2026-09-24, A3). ---
// On a narrow screen the column of floating buttons sits on top of the page itself and
// covered tool buttons (Image to Base64's Copy). They slide out while scrolling down or
// while a text field has focus, and come back on any scroll up. Desktop keeps them fixed:
// there they sit in the empty margin beside the content column.
const floating = document.querySelector<HTMLElement>('.floating-tools');
const narrow = window.matchMedia('(max-width: 640px)');
let lastY = window.scrollY;
let typing = false;
function setTucked(on: boolean) {
  if (!floating) return;
  // Never hide a button whose menu is open.
  if (on && floating.querySelector('[aria-expanded="true"]')) on = false;
  floating.classList.toggle('is-tucked', on && narrow.matches);
}
const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement && !el.closest('.floating-tools, .palette') &&
  (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type)) || el.isContentEditable);
document.addEventListener('focusin', (e) => { if (isTextField(e.target)) { typing = true; setTucked(true); } });
document.addEventListener('focusout', (e) => { if (isTextField(e.target)) { typing = false; setTucked(false); } });

// --- Back to top: appears once the hero has scrolled past, not on a short page. ---
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    fabTop.hidden = window.scrollY < 480;
    const dy = window.scrollY - lastY;
    if (Math.abs(dy) > 8) {
      setTucked(typing || (dy > 0 && window.scrollY > 120));
      lastY = window.scrollY;
    }
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
  // UX-012: a curated alternate phrasing ("pretty json", "epoch") is a more deliberate
  // signal than an incidental word match in the category or description, so it outranks both.
  if (matchesSynonym(entry.href.split('/').pop() ?? '', q)) return 3;
  if (entry.category.toLowerCase().includes(q)) return 4;
  if (entry.short.toLowerCase().includes(q)) return 5;
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

// Whichever control opened the palette gets focus back when it closes (the header search on
// desktop, the floating button on phones, the page itself for Ctrl+K).
let paletteOpener: HTMLElement | null = null;
function openPalette(e?: Event) {
  paletteOpener = (e?.currentTarget as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
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
  (paletteOpener && paletteOpener.isConnected && paletteOpener.offsetParent !== null ? paletteOpener : fabSearch).focus();
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
// Any other opener on the page (the header search box) just carries data-open-palette.
document.querySelectorAll<HTMLElement>('[data-open-palette]').forEach((el) => el.addEventListener('click', openPalette));
// Shortcut hints say Cmd K on Apple keyboards, Ctrl K elsewhere.
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  document.querySelectorAll<HTMLElement>('[data-kbd]').forEach((el) => (el.textContent = '⌘K'));
}
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

// --- UI round 3: copy buttons confirm in place ------------------------------------------------
// Every tool reports a successful copy through its toast ("Copied to clipboard", "Markdown
// copied", ...) and a failed one with different words. Rather than edit ~40 copy handlers in 32
// tool scripts, this watches the tool's toast: when a success message appears within 1.5 s of a
// click on a copy control, that control briefly reads "✓ Copied". Failures never trigger it.
const COPY_CONTROL = 'button[data-copy], button[data-copy-index], button[id^="btn-copy"], button[data-now]';
let lastCopyControl: HTMLElement | null = null;
let lastCopyAt = 0;
document.addEventListener(
  'click',
  (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b && (b.matches(COPY_CONTROL) || /^\s*copy\b/i.test(b.textContent ?? ''))) {
      lastCopyControl = b;
      lastCopyAt = performance.now();
    }
  },
  true,
);
function confirmCopied(b: HTMLElement) {
  if (b.dataset.copiedShowing) return;
  const html = b.innerHTML;
  const r = b.getBoundingClientRect();
  b.dataset.copiedShowing = '1';
  b.style.minWidth = `${r.width}px`;
  b.style.minHeight = `${r.height}px`;
  b.innerHTML = '<span class="copied-mark" aria-hidden="true">✓</span> Copied';
  b.classList.add('is-copied');
  window.setTimeout(() => {
    b.innerHTML = html;
    b.classList.remove('is-copied');
    b.style.minWidth = '';
    b.style.minHeight = '';
    delete b.dataset.copiedShowing;
  }, 1400);
}
const toolToast = document.querySelector<HTMLElement>('.tool-toast');
if (toolToast) {
  new MutationObserver(() => {
    const text = (toolToast.textContent ?? '').trim();
    if (toolToast.hidden || !/\bcopied\b/i.test(text) || /could not|failed|nothing/i.test(text)) return;
    if (lastCopyControl && performance.now() - lastCopyAt < 1500 && lastCopyControl.isConnected) confirmCopied(lastCopyControl);
    lastCopyControl = null;
  }).observe(toolToast, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
}

// --- UI round 3: tools remember their settings ---------------------------------------------------
// Option controls only (checkboxes, selects, number/range fields, pressed toggle buttons, and text
// fields inside an Options panel such as separators), never the input a visitor pastes or types,
// never "Load sample" or Fullscreen. Snapshotted on leaving the page (so a tool's own "Reset
// options", which changes controls without events, is captured too) and restored on the next
// visit by driving the real controls, so each tool reacts exactly as if the visitor had clicked.
// Stored per tool in this browser only; a note with "Reset to defaults" shows when it applied.
const settingsTool = document.querySelector<HTMLElement>('.tool[data-tool]');
if (settingsTool) {
  const key = `pth:settings:${settingsTool.dataset.tool}`;
  type Snapshot = Record<string, string | boolean>;
  const controls = () =>
    [...settingsTool.querySelectorAll<HTMLElement>('select[id], input[id], button[id][aria-pressed]')].filter((el) => {
      if (el.closest('.tool-toolbar') || /sample|fullscreen/i.test(el.id)) return false;
      if (el instanceof HTMLInputElement) {
        if (['checkbox', 'radio', 'number', 'range'].includes(el.type)) return true;
        return ['text', 'search'].includes(el.type) && !!el.closest('.options');
      }
      return true;
    });
  const snapshot = (): Snapshot => {
    const s: Snapshot = {};
    for (const el of controls()) {
      if (el instanceof HTMLButtonElement) s[el.id] = el.getAttribute('aria-pressed') === 'true';
      else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) s[el.id] = el.checked;
      else s[el.id] = (el as HTMLInputElement | HTMLSelectElement).value;
    }
    return s;
  };
  const same = (a: Snapshot, b: Snapshot) => Object.keys(a).every((k) => a[k] === b[k]);
  const defaults = snapshot();
  // Set by "Reset to defaults": the reload it triggers fires pagehide, which must not save the
  // settings straight back.
  let resetting = false;
  // Only a page where an option was actually changed (or a tool's own reset pressed) saves on
  // exit; otherwise an untouched second tab of the same tool would overwrite, or delete, the
  // settings chosen in the first when it closes.
  let touched = false;
  const markTouched = (e: Event) => {
    const t = e.target as HTMLElement;
    if (controls().includes(t) || t.closest?.('button[id*="reset"]')) touched = true;
  };
  settingsTool.addEventListener('change', markTouched, true);
  settingsTool.addEventListener('click', markTouched, true);

  let saved: Snapshot | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    saved = null;
  }
  if (saved && typeof saved === 'object' && !same(saved, defaults)) {
    // Restoring fires the tools' own handlers, which would report every restored value as a
    // visitor's choice; analytics is muted for the restore and a short tail of debounced renders.
    const pth = window.pth;
    const realTrack = pth?.track;
    if (pth) pth.track = () => {};
    const byId = (id: string) => controls().find((el) => el.id === id);
    // Mode buttons first (they can change which fields are shown), then the fields.
    for (const [id, want] of Object.entries(saved)) {
      const el = byId(id);
      if (el instanceof HTMLButtonElement && (el.getAttribute('aria-pressed') === 'true') !== want) el.click();
    }
    for (const [id, want] of Object.entries(saved)) {
      const el = byId(id);
      if (!el || el instanceof HTMLButtonElement) continue;
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        if (el.checked !== want) el.click();
      } else if (typeof want === 'string') {
        const f = el as HTMLInputElement | HTMLSelectElement;
        if (f instanceof HTMLSelectElement && ![...f.options].some((o) => o.value === want)) continue;
        if (f.value !== want) {
          f.value = want;
          f.dispatchEvent(new Event('input', { bubbles: true }));
          f.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
    window.setTimeout(() => {
      if (pth && realTrack) pth.track = realTrack;
    }, 400);

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.innerHTML = 'Your settings from last time are applied. <button type="button" class="link-reset">Reset to defaults</button>';
    const toolbar = settingsTool.querySelector(':scope > .tool-toolbar');
    settingsTool.insertBefore(note, toolbar ? toolbar.nextSibling : settingsTool.firstChild);
    note.querySelector('button')?.addEventListener('click', () => {
      resetting = true;
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing stored to clear.
      }
      window.pth?.track('tool_option', { option: 'settings_reset', value: 'reset' });
      window.location.reload();
    });
  }

  const persist = () => {
    if (resetting || !touched) return;
    try {
      const now = snapshot();
      if (same(now, defaults)) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(now));
    } catch {
      // Storage blocked: settings just aren't remembered.
    }
  };
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
}
