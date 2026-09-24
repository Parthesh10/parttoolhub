/**
 * Shape summary of a parsed JSON value for the JSON Formatter's summary strip ("object · 14 keys ·
 * depth 4 · largest array 120 items"). Iterative, not recursive, so a deeply nested document
 * cannot overflow the call stack. Pure, no DOM.
 */

export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonStats {
  kind: JsonKind;
  /** Object keys summed across every nesting level. */
  keys: number;
  /** Nesting levels of objects/arrays: `{}` is 1, `{"a":{"b":1}}` is 2, a bare primitive is 0. */
  depth: number;
  /** Length of the longest array anywhere in the document (0 when there are none). */
  largestArray: number;
  /** Leaf values: strings, numbers, booleans and nulls. */
  leaves: number;
}

export function kindOf(v: unknown): JsonKind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonKind;
}

export function jsonStats(root: unknown): JsonStats {
  const stats: JsonStats = { kind: kindOf(root), keys: 0, depth: 0, largestArray: 0, leaves: 0 };
  const stack: [unknown, number][] = [[root, 1]];
  while (stack.length) {
    const [v, level] = stack.pop()!;
    if (v !== null && typeof v === 'object') {
      if (level > stats.depth) stats.depth = level;
      if (Array.isArray(v)) {
        if (v.length > stats.largestArray) stats.largestArray = v.length;
        for (const child of v) stack.push([child, level + 1]);
      } else {
        const values = Object.values(v as Record<string, unknown>);
        stats.keys += values.length;
        for (const child of values) stack.push([child, level + 1]);
      }
    } else {
      stats.leaves++;
    }
  }
  return stats;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** The strip's text parts, most useful first; empty for a bare primitive (nothing to summarise). */
export function describeStats(s: JsonStats): string[] {
  if (s.kind !== 'object' && s.kind !== 'array') return [];
  const parts = [plural(s.keys, 'key'), `depth ${s.depth}`];
  if (s.largestArray) parts.push(`largest array ${plural(s.largestArray, 'item')}`);
  parts.push(plural(s.leaves, 'value'));
  return parts;
}
