import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonStats, describeStats } from '../src/lib/json-stats.ts';

test('counts keys at every level, depth, largest array and leaf values', () => {
  const s = jsonStats({ a: 1, b: { c: [1, 2, 3], d: { e: null } }, f: [] });
  assert.deepEqual(s, { kind: 'object', keys: 6, depth: 3, largestArray: 3, leaves: 5 });
});

test('empty containers and bare primitives', () => {
  assert.deepEqual(jsonStats({}), { kind: 'object', keys: 0, depth: 1, largestArray: 0, leaves: 0 });
  assert.deepEqual(jsonStats([]), { kind: 'array', keys: 0, depth: 1, largestArray: 0, leaves: 0 });
  assert.deepEqual(jsonStats('x'), { kind: 'string', keys: 0, depth: 0, largestArray: 0, leaves: 1 });
  assert.deepEqual(jsonStats(null), { kind: 'null', keys: 0, depth: 0, largestArray: 0, leaves: 1 });
});

test('a very deeply nested document does not overflow the stack', () => {
  let v: unknown = 1;
  for (let i = 0; i < 100_000; i++) v = [v];
  assert.equal(jsonStats(v).depth, 100_000);
});

test('describeStats wording, and nothing for a primitive', () => {
  assert.deepEqual(describeStats(jsonStats({ tags: ['a', 'b'], n: 1 })), ['2 keys', 'depth 2', 'largest array 2 items', '3 values']);
  assert.deepEqual(describeStats(jsonStats({ a: 1 })), ['1 key', 'depth 1', '1 value']);
  assert.deepEqual(describeStats(jsonStats(42)), []);
});
