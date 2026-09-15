/**
 * Maps each category to one of the four fixed CSS custom properties defined in
 * global.css (--tint-converters / --tint-text-tools / --tint-encoders /
 * --tint-generators) — a small, deliberate palette (cobalt / teal / violet /
 * brass) rather than a per-tool color, so the site reads as one system. Used
 * for the card top-stripe on home and the category hubs; add a new category's
 * tint here and in global.css together.
 */
export function categoryTintVar(slug: string): string {
  return `var(--tint-${slug}, var(--accent))`;
}
