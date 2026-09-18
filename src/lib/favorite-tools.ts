/**
 * Pure helpers for the "favorite tools" list (UX-010), alongside the existing
 * recently-used list in recent-tools.ts. Storage itself (localStorage) is
 * read/written only in the client script that calls these — kept here as
 * pure functions so they're unit-testable without a DOM/storage mock.
 */

export const FAVORITE_TOOLS_KEY = 'pth:favorite-tools';
/** No real user pins anywhere near this many tools; the cap only guards against a corrupt/hostile value. */
export const MAX_FAVORITE_TOOLS = 50;

/** Adds `slug` if absent, removes it if present. Order is oldest-pinned-first. */
export function toggleFavorite(list: string[], slug: string): string[] {
  if (list.includes(slug)) return list.filter((s) => s !== slug);
  return [...list, slug].slice(-MAX_FAVORITE_TOOLS);
}

/** Parses a raw localStorage value back into a slug list; never throws. */
export function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}
