import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, minifyJson, parseJson } from '../src/lib/json-format.ts';

test('formats with 2 spaces by default', () => {
  const r = formatJson('{"b":1,"a":[1,2]}');
  assert.ok(r.ok);
  assert.equal(r.output, '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.equal(r.kind, 'object');
});

test('indent options', () => {
  const r4 = formatJson('{"a":1}', { indent: 4 });
  assert.ok(r4.ok && r4.output === '{\n    "a": 1\n}');
  const rt = formatJson('{"a":1}', { indent: 'tab' });
  assert.ok(rt.ok && rt.output === '{\n\t"a": 1\n}');
});

test('sortKeys sorts recursively', () => {
  const r = minifyJson('{"b":{"z":1,"y":2},"a":[{"d":1,"c":2}]}', { sortKeys: true });
  assert.ok(r.ok);
  assert.equal(r.output, '{"a":[{"c":2,"d":1}],"b":{"y":2,"z":1}}');
});

test('minify removes whitespace', () => {
  const r = minifyJson('{\n  "a": [ 1, 2 ]\n}');
  assert.ok(r.ok && r.output === '{"a":[1,2]}');
});

test('reports line and column for a syntax error', () => {
  const r = parseJson('{\n  "a": 1,\n  "b": \n}');
  assert.ok(!r.ok);
  assert.ok(r.line !== undefined && r.line >= 3, `line was ${r.line}`);
  assert.ok(r.error.length > 0);
  assert.ok(!/position \d+/.test(r.error), 'engine position noise should be stripped');
});

test('empty input is an error, not a crash', () => {
  const r = formatJson('   ');
  assert.ok(!r.ok && /empty/i.test(r.error));
});

test('scalars are valid JSON documents', () => {
  const r = formatJson('42');
  assert.ok(r.ok && r.output === '42' && r.kind === 'number');
});

test('locates V8 context-style errors in long input', () => {
  const input = '{"aaaaaaaaaaaaaaaaaaaa": 1,\n "bbbbbbbbbbbbbbbbbbbb": tru,\n "cccccccccccccccc": 3}';
  const r = parseJson(input);
  assert.ok(!r.ok);
  assert.equal(r.line, 2);
  assert.ok(r.column !== undefined && r.column > 20, `column was ${r.column}`);
});

test('locates unexpected end of input', () => {
  const r = parseJson('{"a": [1, 2');
  assert.ok(!r.ok && r.line === 1 && r.column === 12);
});
