import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffArrays } from '../src/lib/diff-core.ts';

function show(ops: ReturnType<typeof diffArrays>) {
  return ops.map((o) => (o.type === 'equal' ? ' ' : o.type === 'delete' ? '-' : '+') + o.value).join(' ');
}

test('identical arrays diff to all-equal', () => {
  assert.equal(show(diffArrays(['a', 'b', 'c'], ['a', 'b', 'c'])), ' a  b  c');
});

test('a single middle element changed', () => {
  assert.equal(show(diffArrays(['a', 'b', 'c'], ['a', 'x', 'c'])), ' a -b +x  c');
});

test('insert-only and delete-only', () => {
  assert.equal(show(diffArrays(['a', 'c'], ['a', 'b', 'c'])), ' a +b  c');
  assert.equal(show(diffArrays(['a', 'b', 'c'], ['a', 'c'])), ' a -b  c');
});

test('completely different arrays', () => {
  assert.equal(show(diffArrays(['a', 'b'], ['x', 'y'])), '-a -b +x +y');
});

test('empty-array edge cases', () => {
  assert.equal(show(diffArrays([], ['a', 'b'])), '+a +b');
  assert.equal(show(diffArrays(['a', 'b'], [])), '-a -b');
  assert.equal(show(diffArrays([], [])), '');
});

test('the algorithm’s own textbook example (A=ABCABBA, B=CBABAC): shortest edit script has length 5, LCS length 4', () => {
  const ops = diffArrays(['A', 'B', 'C', 'A', 'B', 'B', 'A'], ['C', 'B', 'A', 'B', 'A', 'C']);
  const equalCount = ops.filter((o) => o.type === 'equal').length;
  const editCount = ops.filter((o) => o.type !== 'equal').length;
  assert.equal(equalCount, 4, 'LCS length should be 4 (e.g. C, A, B, A)');
  assert.equal(editCount, 5, 'shortest edit script should have 5 operations');
});

test('repeated elements: a minimal 2-edit script exists and is found', () => {
  const ops = diffArrays(['a', 'a', 'b'], ['a', 'b', 'a']);
  const editCount = ops.filter((o) => o.type !== 'equal').length;
  assert.equal(editCount, 2, 'minimum edit distance between "aab" and "aba" is 2');
});

test('a custom equality function is honored (deep-equal-style comparison)', () => {
  const a = [{ id: 1 }, { id: 2 }];
  const b = [{ id: 1 }, { id: 3 }];
  const ops = diffArrays(a, b, (x, y) => x.id === y.id);
  assert.deepEqual(ops.map((o) => o.type), ['equal', 'delete', 'insert']);
});

test('reconstructing the new array from the ops matches b exactly', () => {
  const a = [1, 2, 3, 4, 5];
  const b = [1, 9, 3, 5, 6];
  const ops = diffArrays(a, b);
  const rebuilt = ops.filter((o) => o.type !== 'delete').map((o) => o.value);
  assert.deepEqual(rebuilt, b);
});
