import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffText, SAMPLE_A, SAMPLE_B } from '../src/lib/text-diff.ts';
import { buildRows, countChanges, foldRows, type DiffRow, type FoldRow } from '../src/lib/diff-rows.ts';

const rowsOf = (a: string, b: string) => {
  const r = diffText(a, b);
  assert.ok(r.ok);
  return buildRows(r.value.groups);
};
const brief = (r: DiffRow) => `${r.kind}:${r.oldNo ?? '_'}/${r.newNo ?? '_'}`;

test('line numbers follow each side independently', () => {
  const rows = rowsOf('a\nb\nc', 'a\nX\nY\nc');
  assert.deepEqual(rows.map(brief), ['equal:1/1', 'replace:2/2', 'insert:_/3', 'equal:3/4']);
});

test('a replacement is paired side by side; uneven blocks spill into delete/insert rows', () => {
  const rows = rowsOf('keep\nold one\nold two\nold three\nend', 'keep\nnew one\nend');
  assert.deepEqual(rows.map(brief), ['equal:1/1', 'replace:2/2', 'delete:3/_', 'delete:4/_', 'equal:5/3']);
  assert.equal(countChanges(rows), 1);
});

test('similar lines get a word diff, unrelated ones do not', () => {
  const [, similar] = rowsOf('x\nThe quick brown fox', 'x\nThe quick red fox');
  assert.ok(similar.wordDiff?.some((o) => o.type === 'delete' && o.value === 'brown'));
  const [, unrelated] = rowsOf('x\nalpha beta gamma', 'x\ncompletely different words');
  assert.equal(unrelated.kind, 'replace');
  assert.equal(unrelated.wordDiff, undefined);
});

test('change blocks are numbered in order for the navigator', () => {
  const rows = rowsOf(SAMPLE_A, SAMPLE_B);
  assert.deepEqual([...new Set(rows.filter((r) => r.change !== undefined).map((r) => r.change))], [0, 1, 2]);
  assert.equal(countChanges(rows), 3);
});

test('long unchanged runs fold, keeping context around changes; short runs stay', () => {
  const a = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const b = a.replace('line 15', 'line fifteen');
  const folded = foldRows(rowsOf(a, b), 3);
  const kinds = folded.map((r) => (r.kind === 'fold' ? `fold(${(r as FoldRow).rows.length})` : r.kind));
  // 14 unchanged before (11 hidden + 3 context), the change, 3 context + 12 hidden after.
  assert.deepEqual(kinds, ['fold(11)', 'equal', 'equal', 'equal', 'replace', 'equal', 'equal', 'equal', 'fold(12)']);
  // Every original row is still present, in order, once unfolded.
  const flat = folded.flatMap((r) => (r.kind === 'fold' ? (r as FoldRow).rows : [r as DiffRow]));
  assert.equal(flat.length, 30);
  assert.deepEqual(flat.map((r) => r.oldNo), Array.from({ length: 30 }, (_, i) => i + 1));

  const short = foldRows(rowsOf('a\nb\nc\nd', 'a\nb\nc\nX'), 3);
  assert.ok(short.every((r) => r.kind !== 'fold'));
});
