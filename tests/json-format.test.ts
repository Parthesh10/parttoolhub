import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, minifyJson, parseJson, autoFixJson } from '../src/lib/json-format.ts';

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

test('locates an error whose offending token is a line break', () => {
  // A value cut short at the end of a line: V8 reports the newline itself as the token.
  const r = parseJson('{\n  "a": 1,\n  "b": tru\n}');
  assert.ok(!r.ok);
  assert.equal(r.line, 3, `line was ${r.line}`);
  assert.ok(!/is not valid JSON/.test(r.error), `context noise not stripped: ${r.error}`);
});

test('strips V8 context noise even when the context contains quotes', () => {
  const r = parseJson('{"a": NaN}');
  assert.ok(!r.ok);
  assert.ok(!/is not valid JSON/.test(r.error), r.error);
  assert.equal(r.line, 1);
});

test('pathological nesting is an error, not a stack-overflow exception', () => {
  const deep = '['.repeat(10_000) + '1' + ']'.repeat(10_000);
  const r = formatJson(deep);
  assert.ok(!r.ok && /too deeply/.test(r.error), 'format');
  const m = minifyJson(deep, { sortKeys: true });
  assert.ok(!m.ok && /too deeply/.test(m.error), 'minify with sortKeys');
});

test('autoFixJson: converts single-quoted strings to double-quoted', () => {
  const fixed = autoFixJson("{'name': 'Ada', 'active': true}");
  assert.equal(fixed, '{"name": "Ada", "active": true}');
  const r = parseJson(fixed);
  assert.ok(r.ok);
});

test('autoFixJson: strips a trailing comma before } or ]', () => {
  assert.equal(autoFixJson('{"a": 1,}'), '{"a": 1}');
  assert.equal(autoFixJson('[1, 2,]'), '[1, 2]');
  assert.equal(autoFixJson('{"a": 1,   }'), '{"a": 1   }'); // whitespace before the bracket is kept as-is
});

test('autoFixJson: combines both fixes together, matching a realistic pasted-JS-object mistake', () => {
  const fixed = autoFixJson("{'name': 'Ada', 'tags': ['x', 'y',],}");
  assert.equal(fixed, '{"name": "Ada", "tags": ["x", "y"]}');
  const r = parseJson(fixed);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.value, { name: 'Ada', tags: ['x', 'y'] });
});

test('autoFixJson: an escaped apostrophe inside a single-quoted string becomes a plain character', () => {
  const fixed = autoFixJson("{'name': 'O\\'Brien'}");
  assert.equal(fixed, '{"name": "O\'Brien"}');
  const r = parseJson(fixed);
  assert.ok(r.ok && r.value && (r.value as { name: string }).name === "O'Brien");
});

test('autoFixJson: a literal double quote inside a single-quoted string gets escaped', () => {
  const fixed = autoFixJson(`{'quote': 'She said "hi"'}`);
  const r = parseJson(fixed);
  assert.ok(r.ok);
  assert.equal((r.value as { quote: string }).quote, 'She said "hi"');
});

test('autoFixJson: already-valid double-quoted JSON passes through unchanged', () => {
  const valid = '{"a": 1, "b": [1, 2, 3]}';
  assert.equal(autoFixJson(valid), valid);
});

test('autoFixJson: a comma inside a string is never mistaken for a trailing comma', () => {
  const fixed = autoFixJson('{"note": "a, b, c",}');
  assert.equal(fixed, '{"note": "a, b, c"}');
  assert.ok(parseJson(fixed).ok);
});

test('autoFixJson: does not touch other kinds of syntax errors it cannot fix', () => {
  const input = '{not: json at : all !! ][';
  const fixed = autoFixJson(input);
  assert.ok(!parseJson(fixed).ok, 'still invalid, as expected — this is a best-effort repair, not a full parser');
});
