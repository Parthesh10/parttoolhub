/**
 * Pure list-conversion engine. No DOM access — safe to import from
 * Astro components, client scripts, and Node tests alike.
 */

export type SortMode = 'none' | 'az' | 'za' | 'num-asc' | 'num-desc' | 'len-asc' | 'len-desc';
export type CaseMode = 'keep' | 'lower' | 'upper' | 'title';
/**
 * How a quote character inside an item is escaped when items are wrapped in that quote.
 * 'double' is the SQL/CSV rule (O'Brien -> 'O''Brien'); 'backslash' is the JSON/Python/JS rule
 * (O'Brien -> 'O\'Brien', and a backslash itself becomes two). 'auto' picks by preset: see quoteEscapeFor.
 */
export type QuoteEscape = 'auto' | 'double' | 'backslash' | 'none';

export interface ColumnToListOptions {
  /** The literal string placed between items, e.g. ", " or "|". */
  delimiter: string;
  /** Text added before / after each individual item. */
  itemPrefix: string;
  itemSuffix: string;
  /** Escaping for quotes inside items; only applies when "After" is a single ' " or ` character. */
  quoteEscape: QuoteEscape;
  /** Text added before / after the entire joined output. */
  listPrefix: string;
  listSuffix: string;
  /** Strip leading/trailing whitespace from every line. */
  trim: boolean;
  /** Drop lines that are empty after trimming. */
  skipEmpty: boolean;
  /** Keep only the first occurrence of each item. */
  dedupe: boolean;
  /** When deduping, treat "Apple" and "apple" as the same item. */
  dedupeIgnoreCase: boolean;
  sort: SortMode;
  textCase: CaseMode;
  /** Reverse the final order (applied after sorting). */
  reverse: boolean;
}

export const DEFAULT_OPTIONS: ColumnToListOptions = {
  // "Comma only" by default (changed 2026-09-15, maintainer's call): the most common
  // destination is a CSV cell, a query parameter or an IN (...) list, none of which want the space.
  delimiter: ',',
  itemPrefix: '',
  itemSuffix: '',
  quoteEscape: 'auto',
  listPrefix: '',
  listSuffix: '',
  trim: true,
  skipEmpty: true,
  dedupe: false,
  dedupeIgnoreCase: false,
  sort: 'none',
  textCase: 'keep',
  reverse: false,
};

export interface ConvertResult {
  output: string;
  /** Number of items that made it into the output. */
  count: number;
  /** Number of lines/items that were dropped (empty or duplicate). */
  dropped: number;
}

/** Split raw textarea input into lines, handling Windows and old-Mac line endings. */
export function splitLines(input: string): string[] {
  if (input.length === 0) return [];
  return input.split(/\r\n|\r|\n/);
}

function toTitleCase(s: string): string {
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case 'lower':
      return s.toLowerCase();
    case 'upper':
      return s.toUpperCase();
    case 'title':
      return toTitleCase(s);
    default:
      return s;
  }
}

/** Numeric-aware comparison so "item10" sorts after "item9". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function parseNumber(s: string): number {
  // Accept "1,234.5", "$42", "-3" etc. by stripping everything except digits, sign, dot.
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function sortItems(items: string[], mode: SortMode): string[] {
  if (mode === 'none') return items;
  const copy = [...items];
  switch (mode) {
    case 'az':
      return copy.sort((a, b) => collator.compare(a, b));
    case 'za':
      return copy.sort((a, b) => collator.compare(b, a));
    case 'num-asc':
      return copy.sort((a, b) => parseNumber(a) - parseNumber(b));
    case 'num-desc':
      return copy.sort((a, b) => parseNumber(b) - parseNumber(a));
    case 'len-asc':
      return copy.sort((a, b) => a.length - b.length || collator.compare(a, b));
    case 'len-desc':
      return copy.sort((a, b) => b.length - a.length || collator.compare(a, b));
  }
}

/**
 * Convert a column of lines into a delimited list.
 * The processing order is deliberate: clean → filter → transform → dedupe → sort → wrap.
 */
export function columnToList(input: string, opts: Partial<ColumnToListOptions> = {}): ConvertResult {
  const o: ColumnToListOptions = { ...DEFAULT_OPTIONS, ...opts };
  let items = splitLines(input);
  const total = items.length;

  if (o.trim) items = items.map((s) => s.trim());
  if (o.skipEmpty) items = items.filter((s) => s.trim().length > 0);
  items = items.map((s) => applyCase(s, o.textCase));

  if (o.dedupe) {
    const seen = new Set<string>();
    items = items.filter((s) => {
      const key = o.dedupeIgnoreCase ? s.toLowerCase() : s;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  items = sortItems(items, o.sort);
  if (o.reverse) items = items.reverse();

  const quote = /^['"`]$/.test(o.itemSuffix) ? o.itemSuffix : '';
  const escape = quote ? quoteEscapeFor(o) : 'none';
  if (escape === 'double') items = items.map((s) => s.replaceAll(quote, quote + quote));
  else if (escape === 'backslash') items = items.map((s) => s.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote));

  const wrapped = items.map((s) => o.itemPrefix + s + o.itemSuffix);
  const body = wrapped.join(o.delimiter);
  const output = items.length === 0 ? '' : o.listPrefix + body + o.listSuffix;

  return { output, count: items.length, dropped: total - items.length };
}

// ---------------------------------------------------------------------------
// Reverse direction: delimited list → one item per line
// ---------------------------------------------------------------------------

export interface ListToColumnOptions {
  /** Literal delimiter, or 'auto' to detect the most likely one. */
  delimiter: string | 'auto';
  trim: boolean;
  skipEmpty: boolean;
  /** Strip matching surrounding quotes ("x", 'x', `x`) from each item. */
  unquote: boolean;
  dedupe: boolean;
  sort: SortMode;
  textCase: CaseMode;
  reverse: boolean;
}

export const DEFAULT_REVERSE_OPTIONS: ListToColumnOptions = {
  delimiter: 'auto',
  trim: true,
  skipEmpty: true,
  unquote: true,
  dedupe: false,
  sort: 'none',
  textCase: 'keep',
  reverse: false,
};

const CANDIDATE_DELIMITERS = [',', ';', '|', '\t', '\n'] as const;

/**
 * Guess the delimiter by counting occurrences. Falls back to whitespace when
 * none of the usual suspects appear, so "a b c" still splits sensibly.
 */
export function detectDelimiter(input: string): string {
  let best: string = ',';
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = input.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return bestCount === 0 ? ' ' : best;
}

/**
 * Strip one matching pair of quotes and undo the escaping columnToList adds inside them, so
 * ('O''Brien') and ['O\'Brien'] both come back as O'Brien: a doubled quote (SQL, CSV) or a
 * backslash before the quote or before another backslash (JSON, Python, JS). Other backslash
 * sequences such as \n are left as typed.
 */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      const doubled = first + first;
      return s.slice(1, -1).replace(/\\([\\"'`])|(["'`])\2/g, (m, escaped) => escaped ?? (m === doubled ? first : m));
    }
  }
  return s;
}

/** Remove common list wrappers like [ ], ( ), { } around the whole input. */
function stripListWrapper(s: string): string {
  const t = s.trim();
  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
  const open = t[0];
  if (open && pairs[open] && t[t.length - 1] === pairs[open]) return t.slice(1, -1);
  return t;
}

export function listToColumn(input: string, opts: Partial<ListToColumnOptions> = {}): ConvertResult {
  const o: ListToColumnOptions = { ...DEFAULT_REVERSE_OPTIONS, ...opts };
  const cleaned = stripListWrapper(input);
  if (cleaned.length === 0) return { output: '', count: 0, dropped: 0 };

  const delimiter = o.delimiter === 'auto' ? detectDelimiter(cleaned) : o.delimiter;
  let items = delimiter === ' ' ? cleaned.split(/\s+/) : cleaned.split(delimiter);
  const total = items.length;

  if (o.trim) items = items.map((s) => s.trim());
  if (o.unquote) items = items.map(stripQuotes);
  if (o.skipEmpty) items = items.filter((s) => s.length > 0);
  items = items.map((s) => applyCase(s, o.textCase));

  if (o.dedupe) items = [...new Set(items)];
  items = sortItems(items, o.sort);
  if (o.reverse) items = items.reverse();

  return { output: items.join('\n'), count: items.length, dropped: total - items.length };
}

// ---------------------------------------------------------------------------
// Presets — one-click configurations for the most common real-world targets
// ---------------------------------------------------------------------------

export interface Preset {
  id: string;
  label: string;
  /** Example of the shape this preset produces. */
  hint: string;
  options: Partial<ColumnToListOptions>;
  /** What 'auto' quote escaping means while the wrapper fields match this preset. */
  escape?: Exclude<QuoteEscape, 'auto'>;
}

const bare = { itemPrefix: '', itemSuffix: '', listPrefix: '', listSuffix: '' };

export const PRESETS: Preset[] = [
  { id: 'compact', label: 'No spaces', hint: 'a,b,c', options: { ...bare, delimiter: ',' } },
  { id: 'plain', label: 'Plain', hint: 'a, b, c', options: { ...bare, delimiter: ', ' } },
  { id: 'sql', label: 'SQL IN', hint: "('a', 'b', 'c')", options: { delimiter: ', ', itemPrefix: "'", itemSuffix: "'", listPrefix: '(', listSuffix: ')' }, escape: 'double' },
  { id: 'json', label: 'JSON array', hint: '["a", "b", "c"]', options: { delimiter: ', ', itemPrefix: '"', itemSuffix: '"', listPrefix: '[', listSuffix: ']' }, escape: 'backslash' },
  { id: 'python', label: 'Python list', hint: "['a', 'b', 'c']", options: { delimiter: ', ', itemPrefix: "'", itemSuffix: "'", listPrefix: '[', listSuffix: ']' }, escape: 'backslash' },
  { id: 'semicolon', label: 'Semicolon', hint: 'a; b; c', options: { ...bare, delimiter: '; ' } },
  { id: 'pipe', label: 'Pipe', hint: 'a | b | c', options: { ...bare, delimiter: ' | ' } },
  { id: 'regex', label: 'Regex OR', hint: '(a|b|c)', options: { delimiter: '|', itemPrefix: '', itemSuffix: '', listPrefix: '(', listSuffix: ')' } },
];

/** The preset whose separator and wrapper fields equal these options, if any (drives the highlighted chip). */
export function matchingPreset(o: ColumnToListOptions): Preset | undefined {
  return PRESETS.find(
    (p) =>
      p.options.delimiter === o.delimiter &&
      (p.options.itemPrefix ?? '') === o.itemPrefix &&
      (p.options.itemSuffix ?? '') === o.itemSuffix &&
      (p.options.listPrefix ?? '') === o.listPrefix &&
      (p.options.listSuffix ?? '') === o.listSuffix,
  );
}

/**
 * Resolve 'auto': the escaping of the preset the wrapper matches, keyed on the list brackets as well
 * as the quote, because ('a') is SQL (double it) while ['a'] is Python (backslash). A hand-made
 * wrapper that matches no preset is left alone, since there is no way to tell its language.
 */
export function quoteEscapeFor(o: ColumnToListOptions): Exclude<QuoteEscape, 'auto'> {
  if (o.quoteEscape !== 'auto') return o.quoteEscape;
  const p = PRESETS.find(
    (x) =>
      x.escape &&
      (x.options.itemPrefix ?? '') === o.itemPrefix &&
      (x.options.itemSuffix ?? '') === o.itemSuffix &&
      (x.options.listPrefix ?? '') === o.listPrefix &&
      (x.options.listSuffix ?? '') === o.listSuffix,
  );
  return p?.escape ?? 'none';
}

/** Delimiter choices for the UI select. `value` is used verbatim in the join. */
export const DELIMITER_CHOICES = [
  // First entry is what the <select> starts on; it must equal DEFAULT_OPTIONS.delimiter.
  { value: ',', label: 'Comma only' },
  { value: ', ', label: 'Comma + space' },
  { value: '; ', label: 'Semicolon + space' },
  { value: ';', label: 'Semicolon only' },
  { value: ' | ', label: 'Pipe with spaces' },
  { value: '|', label: 'Pipe only' },
  { value: ' ', label: 'Space' },
  { value: '\t', label: 'Tab' },
  { value: '\n', label: 'New line' },
  { value: '__custom__', label: 'Custom…' },
] as const;

export const CUSTOM_DELIMITER = '__custom__';
