/**
 * Text diffing: line-level (the default, with inline word-highlighting for a single changed line
 * replacing another single line) and a separate whole-document word-level mode for prose where
 * line breaks aren't meaningful. Built on diffArrays from diff-core.ts. Pure, no DOM.
 */
import { diffArrays, type DiffOp } from './diff-core';

/** Lines split for the diff; the caller (or renderer) decides how to treat a trailing newline. */
export function splitLines(s: string): string[] {
  return s.split('\n');
}

/** Whitespace runs and non-whitespace runs, each its own token — join() reconstructs the input exactly. */
export function tokenizeWords(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}

export type LineGroup =
  | { type: 'equal'; lines: string[] }
  | { type: 'delete'; lines: string[] }
  | { type: 'insert'; lines: string[] }
  | { type: 'replace'; oldLines: string[]; newLines: string[]; wordDiff?: DiffOp<string>[] };

export interface TextDiffStats {
  linesAdded: number;
  linesRemoved: number;
  linesUnchanged: number;
  identical: boolean;
}

export interface TextDiffValue {
  groups: LineGroup[];
  stats: TextDiffStats;
}

export type TextDiffResult = { ok: true; value: TextDiffValue } | { ok: false; error: string };

/** Lines beyond this make the O(N·D) algorithm slow for genuinely unrelated documents; disclosed on the page. */
export const MAX_LINES = 5000;
/** Same reasoning, for the whole-document word-diff mode. */
export const MAX_WORDS = 20000;

export function diffText(a: string, b: string): TextDiffResult {
  const linesA = splitLines(a);
  const linesB = splitLines(b);
  if (linesA.length > MAX_LINES || linesB.length > MAX_LINES) {
    return { ok: false, error: `Each side is limited to ${MAX_LINES.toLocaleString()} lines for line diff; this input has more.` };
  }

  const ops = diffArrays(linesA, linesB);
  const groups: LineGroup[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  let linesUnchanged = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      const lines: string[] = [];
      while (i < ops.length && ops[i].type === 'equal') {
        lines.push(ops[i].value);
        linesUnchanged++;
        i++;
      }
      groups.push({ type: 'equal', lines });
      continue;
    }
    const oldLines: string[] = [];
    while (i < ops.length && ops[i].type === 'delete') {
      oldLines.push(ops[i].value);
      linesRemoved++;
      i++;
    }
    const newLines: string[] = [];
    while (i < ops.length && ops[i].type === 'insert') {
      newLines.push(ops[i].value);
      linesAdded++;
      i++;
    }
    if (oldLines.length === 0) {
      groups.push({ type: 'insert', lines: newLines });
    } else if (newLines.length === 0) {
      groups.push({ type: 'delete', lines: oldLines });
    } else {
      const wordDiff = oldLines.length === 1 && newLines.length === 1 ? diffArrays(tokenizeWords(oldLines[0]), tokenizeWords(newLines[0])) : undefined;
      groups.push({ type: 'replace', oldLines, newLines, wordDiff });
    }
  }

  return {
    ok: true,
    value: { groups, stats: { linesAdded, linesRemoved, linesUnchanged, identical: linesAdded === 0 && linesRemoved === 0 } },
  };
}

export type WordDiffResult = { ok: true; value: DiffOp<string>[] } | { ok: false; error: string };

/**
 * Two whitespace-only tokens compare equal if they serve the same role — plain word-wrapping
 * (spaces, or a single line break) vs. a paragraph break (two or more line breaks) — rather than
 * requiring the exact same characters. Without this, a paragraph reflowed at a different width
 * (a single space becoming a line break, or vice versa) triggers word-level false positives:
 * Myers diff finds an equally-short edit script either way, and with plain `===` equality it can
 * just as easily "explain" the difference by swapping which occurrence of a real word it matches
 * as by matching the whitespace — verified by reproducing exactly that misfire before adding this
 * rule. A genuine blank-line insertion/removal (a different bucket) still shows as a real change.
 */
function wordDiffEq(a: string, b: string): boolean {
  const bucket = (s: string): 'wrap' | 'parabreak' | null => (/^\s+$/.test(s) ? ((s.match(/\n/g) ?? []).length >= 2 ? 'parabreak' : 'wrap') : null);
  const ba = bucket(a);
  const bb = bucket(b);
  if (ba && bb) return ba === bb;
  return a === b;
}

/** Whole-document word diff, ignoring exactly how words are wrapped — for prose that may have been reflowed. */
export function diffWords(a: string, b: string): WordDiffResult {
  const wordsA = tokenizeWords(a);
  const wordsB = tokenizeWords(b);
  if (wordsA.length > MAX_WORDS || wordsB.length > MAX_WORDS) {
    return { ok: false, error: `Each side is limited to ${MAX_WORDS.toLocaleString()} words for word diff; this input has more.` };
  }
  return { ok: true, value: diffArrays(wordsA, wordsB, wordDiffEq) };
}

export const SAMPLE_A = 'The quick brown fox jumps over the lazy dog.\nThis line stays the same.\nA line that will be removed.\nThe final line here.';
export const SAMPLE_B = 'The quick red fox jumps over the lazy dog.\nThis line stays the same.\nThe final line here.\nA newly added line.';
