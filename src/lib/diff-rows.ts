/**
 * Turns the grouped output of diffText() into display rows for the Text Diff Checker's split
 * (side-by-side) and unified views: real line numbers on both sides, changed lines paired up so a
 * replacement sits next to what it replaced, an index per contiguous change block (for the
 * previous / next change navigator), and long unchanged runs folded down to a few lines of
 * context. Pure, no DOM.
 */
import { diffArrays, type DiffOp } from './diff-core';
import { tokenizeWords, type LineGroup } from './text-diff';

export interface DiffRow {
  kind: 'equal' | 'delete' | 'insert' | 'replace';
  oldNo?: number;
  newNo?: number;
  oldText?: string;
  newText?: string;
  /** Word-level ops for a replace row whose two lines are similar enough to compare word by word. */
  wordDiff?: DiffOp<string>[];
  /** 0-based index of the change block this row belongs to; undefined for unchanged rows. */
  change?: number;
}

export interface FoldRow {
  kind: 'fold';
  rows: DiffRow[];
}

/**
 * Word-highlighting two unrelated lines that merely sit side by side produces noise (every word
 * "changed"), so a pair is only word-diffed when at least half its non-whitespace characters are
 * shared. Below that, the whole lines are marked as removed/added instead.
 */
export const WORD_DIFF_MIN_SIMILARITY = 0.5;

function pairWordDiff(a: string, b: string): DiffOp<string>[] | undefined {
  const ops = diffArrays(tokenizeWords(a), tokenizeWords(b));
  const size = (s: string) => s.replace(/\s+/g, '').length;
  const shared = ops.filter((o) => o.type === 'equal').reduce((n, o) => n + size(o.value), 0);
  const longest = Math.max(size(a), size(b));
  if (longest === 0) return undefined;
  return shared / longest >= WORD_DIFF_MIN_SIMILARITY ? ops : undefined;
}

export function buildRows(groups: LineGroup[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let change = -1;
  let prevWasChange = false;
  for (const g of groups) {
    if (g.type === 'equal') {
      for (const line of g.lines) rows.push({ kind: 'equal', oldNo: oldNo++, newNo: newNo++, oldText: line, newText: line });
      prevWasChange = false;
      continue;
    }
    if (!prevWasChange) change++;
    prevWasChange = true;
    if (g.type === 'delete') {
      for (const line of g.lines) rows.push({ kind: 'delete', oldNo: oldNo++, oldText: line, change });
    } else if (g.type === 'insert') {
      for (const line of g.lines) rows.push({ kind: 'insert', newNo: newNo++, newText: line, change });
    } else {
      const n = Math.max(g.oldLines.length, g.newLines.length);
      for (let i = 0; i < n; i++) {
        const o = g.oldLines[i];
        const nw = g.newLines[i];
        if (o !== undefined && nw !== undefined) {
          rows.push({ kind: 'replace', oldNo: oldNo++, newNo: newNo++, oldText: o, newText: nw, wordDiff: pairWordDiff(o, nw), change });
        } else if (o !== undefined) {
          rows.push({ kind: 'delete', oldNo: oldNo++, oldText: o, change });
        } else {
          rows.push({ kind: 'insert', newNo: newNo++, newText: nw, change });
        }
      }
    }
  }
  return rows;
}

/** Number of change blocks in a row list (what the navigator counts). */
export function countChanges(rows: DiffRow[]): number {
  let max = -1;
  for (const r of rows) if (r.change !== undefined && r.change > max) max = r.change;
  return max + 1;
}

/**
 * Keeps `context` unchanged lines around every change and folds each longer unchanged run into a
 * FoldRow (the page shows it as "⋯ N unchanged lines", click to expand). A run is only folded
 * when that hides at least `minHidden` lines; folding 1 line saves nothing.
 */
export function foldRows(rows: DiffRow[], context = 3, minHidden = 4): (DiffRow | FoldRow)[] {
  const out: (DiffRow | FoldRow)[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'equal') {
      out.push(rows[i++]);
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'equal') j++;
    const run = rows.slice(i, j);
    const keepHead = i === 0 ? 0 : context; // after a change
    const keepTail = j === rows.length ? 0 : context; // before a change
    if (run.length - keepHead - keepTail >= minHidden) {
      out.push(...run.slice(0, keepHead));
      out.push({ kind: 'fold', rows: run.slice(keepHead, run.length - keepTail) });
      out.push(...run.slice(run.length - keepTail));
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}
