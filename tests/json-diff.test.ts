import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffJson, SAMPLE_OLD, SAMPLE_NEW } from '../src/lib/json-diff.ts';

test('identical JSON (even with different whitespace) diffs to zero changes', () => {
  const r = diffJson('{"a":1,"b":2}', '{\n  "a": 1,\n  "b": 2\n}');
  assert.ok(r.ok);
  assert.equal(r.value.stats.identical, true);
});

test('reordered keys are not a change (structural, not textual, comparison)', () => {
  const r = diffJson('{"a":1,"b":2}', '{"b":2,"a":1}');
  assert.ok(r.ok);
  assert.equal(r.value.changes.length, 0);
});

test('a changed primitive value is reported with its path and both values', () => {
  const r = diffJson('{"a":1,"b":2}', '{"a":1,"b":3}');
  assert.ok(r.ok);
  assert.deepEqual(r.value.changes, [{ type: 'changed', path: '$.b', oldValue: 2, newValue: 3 }]);
});

test('an added and a removed key are both reported', () => {
  const r = diffJson('{"a":1,"b":2}', '{"a":1,"c":2}');
  assert.ok(r.ok);
  const byType = Object.fromEntries(r.value.changes.map((c) => [c.type, c]));
  assert.deepEqual(byType.removed, { type: 'removed', path: '$.b', value: 2 });
  assert.deepEqual(byType.added, { type: 'added', path: '$.c', value: 2 });
});

test('nested object changes report the full dotted path', () => {
  const r = diffJson('{"user":{"name":"Ada","age":30}}', '{"user":{"name":"Ada","age":31}}');
  assert.ok(r.ok);
  assert.deepEqual(r.value.changes, [{ type: 'changed', path: '$.user.age', oldValue: 30, newValue: 31 }]);
});

test('array insertion in the middle reports one addition, not a cascade of false "changed" entries', () => {
  const r = diffJson('{"list":[1,2,3]}', '{"list":[1,99,2,3]}');
  assert.ok(r.ok);
  assert.deepEqual(r.value.changes, [{ type: 'added', path: '$.list[1]', value: 99 }]);
});

test('array element removal is reported at the removed element’s own index', () => {
  const r = diffJson('{"list":["a","b","c"]}', '{"list":["a","c"]}');
  assert.ok(r.ok);
  assert.deepEqual(r.value.changes, [{ type: 'removed', path: '$.list[1]', value: 'b' }]);
});

test('a type mismatch at the same path (object vs array) is reported as changed, not crashed on', () => {
  const r = diffJson('{"a":{"x":1}}', '{"a":[1]}');
  assert.ok(r.ok);
  assert.deepEqual(r.value.changes, [{ type: 'changed', path: '$.a', oldValue: { x: 1 }, newValue: [1] }]);
});

test('a key present with value null is distinguished from the key being absent', () => {
  const r = diffJson('{"a":null}', '{}');
  assert.ok(r.ok);
  assert.deepEqual(r.value.changes, [{ type: 'removed', path: '$.a', value: null }]);
});

test('an object key whose name is not a valid bare identifier is bracket-quoted in the path', () => {
  const r = diffJson('{"a b":1}', '{"a b":2}');
  assert.ok(r.ok);
  assert.equal(r.value.changes[0].path, '$["a b"]');
});

test('invalid JSON on the old side is reported with side "old" and a useful location', () => {
  const r = diffJson('{"a":}', '{"a":1}');
  assert.ok(!r.ok);
  assert.equal(r.side, 'old');
  assert.ok(r.error.length > 0);
});

test('invalid JSON on the new side is reported with side "new"', () => {
  const r = diffJson('{"a":1}', 'not json');
  assert.ok(!r.ok);
  assert.equal(r.side, 'new');
});

test('empty input on either side is refused with a side-specific message, not a generic one', () => {
  const oldEmpty = diffJson('', '{"a":1}');
  assert.ok(!oldEmpty.ok);
  assert.match(oldEmpty.error, /original/);
  const newEmpty = diffJson('{"a":1}', '');
  assert.ok(!newEmpty.ok);
  assert.match(newEmpty.error, /changed/);
});

test('the shared sample pair demonstrates key reorder (no diff), an array addition, a nested addition and a new top-level key', () => {
  const r = diffJson(SAMPLE_OLD, SAMPLE_NEW);
  assert.ok(r.ok);
  const paths = r.value.changes.map((c) => c.path).sort();
  assert.deepEqual(paths, ['$.active', '$.address.country', '$.tags[1]']);
});

test('pretty-printed output is available on both sides for full-context display', () => {
  const r = diffJson('{"a":1}', '{"a":2}');
  assert.ok(r.ok);
  assert.equal(r.value.oldPretty, '{\n  "a": 1\n}');
  assert.equal(r.value.newPretty, '{\n  "a": 2\n}');
});
