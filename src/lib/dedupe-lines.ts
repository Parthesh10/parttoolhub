/** Remove duplicate lines. Pure, no DOM. */
/** The "Load sample" input, shared with the worked example on /tools/remove-duplicate-lines. */
export const SAMPLE_INPUT = ['apple', 'banana', 'Apple', 'cherry', 'banana', 'date'].join('\n');

export interface DedupeOptions {
  ignoreCase: boolean;
  /** Compare trimmed lines (and output them trimmed). */
  trim: boolean;
  /** Drop blank lines entirely. */
  removeBlank: boolean;
  /** Which occurrence survives. */
  keep: 'first' | 'last';
  sort: 'none' | 'az' | 'za';
  /** Output only the lines that had duplicates (one copy each). */
  onlyDuplicates: boolean;
}

export const DEFAULT_DEDUPE: DedupeOptions = {
  ignoreCase: false,
  trim: true,
  removeBlank: true,
  keep: 'first',
  sort: 'none',
  onlyDuplicates: false,
};

export interface DedupeResult {
  output: string;
  total: number;
  unique: number;
  removed: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function dedupeLines(input: string, opts: Partial<DedupeOptions> = {}): DedupeResult {
  const o = { ...DEFAULT_DEDUPE, ...opts };
  if (!input.length) return { output: '', total: 0, unique: 0, removed: 0 };

  let lines = input.split(/\r\n|\r|\n/);
  const total = lines.length;
  if (o.trim) lines = lines.map((l) => l.trim());
  if (o.removeBlank) lines = lines.filter((l) => l.trim().length > 0);

  const key = (l: string) => (o.ignoreCase ? l.toLowerCase() : l);
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);

  const ordered = o.keep === 'last' ? [...lines].reverse() : lines;
  const seen = new Set<string>();
  let result: string[] = [];
  for (const l of ordered) {
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!o.onlyDuplicates || (counts.get(k) ?? 0) > 1) result.push(l);
  }
  if (o.keep === 'last') result.reverse();

  if (o.sort === 'az') result = [...result].sort(collator.compare);
  if (o.sort === 'za') result = [...result].sort((a, b) => collator.compare(b, a));

  const unique = seen.size;
  return { output: result.join('\n'), total, unique, removed: lines.length - unique };
}
