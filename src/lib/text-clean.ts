/**
 * Clean up text produced by AI assistants: Markdown symbols, typographic
 * punctuation, invisible characters, emoji, citation markers. Pure, no DOM.
 */
export type DashMode = 'keep' | 'comma' | 'hyphen' | 'spaced-hyphen' | 'remove';

export interface CleanOptions {
  /** Strip headings, bold/italic markers, inline code, links, blockquotes and rules. */
  markdown: boolean;
  /** Normalise "*" and "+" bullets to "-" (only meaningful when markdown is on). */
  normalizeBullets: boolean;
  emDash: DashMode;
  /** “ ” ‘ ’ « » → straight quotes. */
  straightenQuotes: boolean;
  /** Zero-width spaces, soft hyphens, BOM, NBSP, control characters. */
  invisible: boolean;
  emoji: boolean;
  /** [1], [2, 3], 【4】, [^5] and similar reference markers. */
  citations: boolean;
  /** … → ... */
  ellipsis: boolean;
  /** Collapse runs of spaces, trim line ends, limit blank lines to one. */
  whitespace: boolean;
}

export const DEFAULT_CLEAN: CleanOptions = {
  markdown: true,
  normalizeBullets: true,
  emDash: 'comma',
  straightenQuotes: true,
  invisible: true,
  emoji: false,
  citations: true,
  ellipsis: true,
  whitespace: true,
};

export interface CleanResult {
  output: string;
  /** Characters in minus characters out (can be negative if dashes expand). */
  removed: number;
  /** Per-step counts of characters changed, for the UI summary. */
  changes: Partial<Record<keyof CleanOptions, number>>;
}

// Built from explicit code points (not pasted glyphs) so the ranges are
// auditable and survive copy/paste, git diffs and editor re-encoding intact.
const EMOJI_RE =
  /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{FE0E}\u{FE0F}]?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{FE0E}\u{FE0F}]?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\u{FE0F}?\u20E3/gu;

/** Zero-width joins, marks and BOM — removed with no replacement (they have no width). */
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\u180E]/g;
/** Non-breaking and typographic spaces — these do have width, so they become a plain space. */
const UNICODE_SPACE_RE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
/** C0/C1 control characters other than tab and newline. */
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function stripMarkdown(text: string, normalizeBullets: boolean): string {
  let t = text;
  // Fenced code blocks: drop the fence lines, keep the code.
  t = t.replace(/^[ \t]*```[^\n]*\n?/gm, '');
  // ATX headings
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm, '$1');
  // Table separator rows ( |---|:--:| ) vanish along with their own newline,
  // so no blank line is left behind where the row used to be.
  t = t.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*\r?\n?/gm, '');
  // Setext heading underlines and horizontal rules
  t = t.replace(/^[ \t]*(?:[-=*_][ \t]*){3,}$/gm, '');
  // Images and links: keep the visible text. The label excludes '[' as well as
  // ']' so a run of opening brackets fails fast at each position instead of
  // re-scanning to the next ']' every time (was O(n²): 100k '[' took 17 s).
  t = t.replace(/!\[([^[\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^[\]]+)\]\([^)]*\)/g, '$1');
  // Bold / italic / strikethrough (longest markers first)
  t = t.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '$2');
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');
  t = t.replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1');
  t = t.replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1');
  t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');
  // Inline code
  t = t.replace(/`([^`\n]+)`/g, '$1');
  // Blockquotes
  t = t.replace(/^[ \t]*>[ \t]?/gm, '');
  // Remaining table rows: drop the leading/trailing pipe, turn inner pipes into a space
  t = t.replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, '');
  t = t.replace(/[ \t]*\|[ \t]*/g, ' ');
  // Bullets
  if (normalizeBullets) t = t.replace(/^([ \t]*)[*+][ \t]+/gm, '$1- ');
  // Task list boxes
  t = t.replace(/^([ \t]*[-*+][ \t]+)\[[ xX]\][ \t]+/gm, '$1');
  return t;
}

function replaceDashes(text: string, mode: DashMode): string {
  if (mode === 'keep') return text;
  const rep = { comma: ', ', hyphen: '-', 'spaced-hyphen': ' - ', remove: ' ' }[mode];
  // Numeric ranges like 2010–2020 always keep a plain hyphen, regardless of
  // mode — this must run before the general substitutions below, since those
  // consume the dash character before a "between two digits" check could see it.
  let t = text.replace(/(\d)[ \t]*[–—][ \t]*(\d)/g, '$1-$2');
  // Em dash with any surrounding spaces → replacement; en dash between words likewise.
  t = t.replace(/[ \t]*—[ \t]*/g, rep);
  t = t.replace(/(?<=\S)[ \t]*–[ \t]*(?=\S)/g, mode === 'comma' ? ' - ' : rep);
  if (mode === 'comma') t = t.replace(/, ([,.;:!?])/g, '$1'); // avoid ", ."
  return t;
}

function straightenQuotes(text: string): string {
  return text
    .replace(/[“”„‟«»″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'");
}

function removeInvisible(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(UNICODE_SPACE_RE, ' ').replace(CONTROL_CHAR_RE, '');
}

function removeCitations(text: string): string {
  return text
    .replace(/\[\^?\d+(?:\s*[,–-]\s*\d+)*\]/g, '')
    .replace(/【[^】\n]*】/g, '')
    .replace(/\[(?:citation needed|source|ref)\]/gi, '');
}

function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanText(input: string, opts: Partial<CleanOptions> = {}): CleanResult {
  const o = { ...DEFAULT_CLEAN, ...opts };
  const changes: CleanResult['changes'] = {};
  let t = input.replace(/\r\n?/g, '\n');

  const step = (key: keyof CleanOptions, fn: (s: string) => string) => {
    const before = t;
    t = fn(t);
    if (t !== before) changes[key] = Math.abs(before.length - t.length) || 1;
  };

  if (o.invisible) step('invisible', removeInvisible);
  if (o.markdown) step('markdown', (s) => stripMarkdown(s, o.normalizeBullets));
  if (o.citations) step('citations', removeCitations);
  if (o.straightenQuotes) step('straightenQuotes', straightenQuotes);
  if (o.emDash !== 'keep') step('emDash', (s) => replaceDashes(s, o.emDash));
  if (o.ellipsis) step('ellipsis', (s) => s.replace(/…/g, '...'));
  if (o.emoji) step('emoji', (s) => s.replace(EMOJI_RE, ''));
  if (o.whitespace) step('whitespace', tidyWhitespace);

  return { output: t, removed: input.length - t.length, changes };
}
