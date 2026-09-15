/**
 * Pure helpers for the "recently used tools" list. Storage itself
 * (localStorage) is read/written only in the client script that calls
 * these — kept here as pure functions so they're unit-testable without a
 * DOM/storage mock.
 */

export const RECENT_TOOLS_KEY = 'pth:recent-tools';
export const MAX_RECENT_TOOLS = 8;

/** Moves `slug` to the front of `list`, de-duplicating and capping at `max`. */
export function pushRecent(list: string[], slug: string, max = MAX_RECENT_TOOLS): string[] {
  const next = [slug, ...list.filter((s) => s !== slug)];
  return next.slice(0, max);
}

/** Parses a raw localStorage value back into a slug list; never throws. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}
