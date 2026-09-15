import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, offsetToLineColumn } from '../src/lib/json-parse.ts';

test('parseJson: valid JSON parses to the right value', () => {
  const r = parseJson('{"a": [1, 2, 3]}');
  assert.ok(r.ok);
  assert.deepEqual(r.value, { a: [1, 2, 3] });
});

test('parseJson: empty input uses the caller-supplied message', () => {
  assert.deepEqual(parseJson(''), { ok: false, error: 'Input is empty.' });
  assert.deepEqual(parseJson('   ', 'Paste something.'), { ok: false, error: 'Paste something.' });
});

test('parseJson: malformed JSON reports a line and column, not a raw engine exception', () => {
  const r = parseJson('{\n  "a": 1,\n  "b": ,\n}');
  assert.ok(!r.ok);
  assert.equal(r.line, 3, `expected the error on line 3, got ${JSON.stringify(r)}`);
  assert.ok(r.column && r.column > 0);
  assert.ok(!r.error.toLowerCase().includes('json.parse'), 'engine-specific "JSON.parse:" prefix is stripped');
});

test('parseJson: unexpected end of input still gets a location (end of the text)', () => {
  const input = '{"a": 1';
  const r = parseJson(input);
  assert.ok(!r.ok);
  assert.equal(r.line, 1);
});

test('offsetToLineColumn: line/column are 1-based and count from the last newline', () => {
  assert.deepEqual(offsetToLineColumn('abc', 0), { line: 1, column: 1 });
  assert.deepEqual(offsetToLineColumn('ab\ncd', 3), { line: 2, column: 1 });
  assert.deepEqual(offsetToLineColumn('ab\ncd', 4), { line: 2, column: 2 });
});
