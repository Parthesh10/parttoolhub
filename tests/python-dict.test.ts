import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pythonToJson, jsonToPython } from '../src/lib/python-dict.ts';

const mini = (src: string) => {
  const r = pythonToJson(src, { indent: 0 });
  if (!r.ok) throw new Error(r.error);
  return r.output;
};

test('basic dict with single quotes and Python constants', () => {
  assert.equal(mini("{'name': 'Ada', 'age': 36, 'admin': True, 'ref': None, 'x': False}"),
    '{"name":"Ada","age":36,"admin":true,"ref":null,"x":false}');
});

test('nested structures, tuples and sets become arrays', () => {
  assert.equal(mini("{'a': (1, 2), 'b': {1, 2}, 'c': [(1,), []]}"), '{"a":[1,2],"b":[1,2],"c":[[1],[]]}');
});

test('trailing commas and comments are tolerated', () => {
  assert.equal(mini("{\n  'a': 1,  # first\n  'b': [1, 2,],\n}"), '{"a":1,"b":[1,2]}');
});

test('string escapes, prefixes, triple quotes and concatenation', () => {
  assert.equal(mini("{'s': 'it\\'s', 'u': u'ü', 'r': r'a\\nb', 't': '''multi\nline''', 'c': 'ab' 'cd'}"),
    '{"s":"it\'s","u":"ü","r":"a\\\\nb","t":"multi\\nline","c":"abcd"}');
  assert.equal(mini('{"dq": "x\\ty"}'), '{"dq":"x\\ty"}');
});

test('numbers: underscores, hex, floats, negatives', () => {
  // 1e3 is a float in Python, so json.dumps writes 1000.0, not 1000.
  assert.equal(mini("[1_000, 0xff, 0b101, 3.5, -2, .5, 1e3]"), '[1000,255,5,3.5,-2,0.5,1000.0]');
});

test('non-string keys follow json.dumps rules', () => {
  assert.equal(mini("{1: 'a', True: 'b', None: 'c'}"), '{"1":"a","true":"b","null":"c"}');
});

test('constructor calls and float("inf")', () => {
  assert.equal(mini("{'s': set([1, 2]), 'd': dict(), 'i': float('inf'), 'o': OrderedDict({'k': 1})}"),
    '{"s":[1,2],"d":{},"i":null,"o":{"k":1}}');
});

test('pretty output and sortKeys', () => {
  const r = pythonToJson("{'b': 1, 'a': 2}", { indent: 2, sortKeys: true });
  assert.ok(r.ok && r.output === '{\n  "a": 2,\n  "b": 1\n}');
});

test('helpful errors', () => {
  const v = pythonToJson("{'a': some_var}");
  assert.ok(!v.ok && /variable/.test(v.error));
  const u = pythonToJson("{'a': 'unterminated}");
  assert.ok(!u.ok && /Unterminated/.test(u.error));
  const c = pythonToJson('[1j]');
  assert.ok(!c.ok && /Complex/.test(c.error));
  assert.ok(!pythonToJson('').ok);
});

test('pythonToJson: errors report a line/column, not just a raw character position', () => {
  const r = pythonToJson("{\n  'a': 1,\n  'b': some_var,\n}");
  assert.ok(!r.ok);
  assert.equal(r.line, 3, `expected the error on line 3, got ${JSON.stringify(r)}`);
  assert.ok(r.column !== undefined && r.column > 0);
});

test('jsonToPython reverse direction', () => {
  const r = jsonToPython('{"a": [1, true, null], "s": "it\'s"}');
  assert.ok(r.ok);
  assert.equal(r.output, "{\n    'a': [\n        1,\n        True,\n        None\n    ],\n    's': 'it\\'s'\n}");
});

test('jsonToPython: indent options (2, tab, single line)', () => {
  const two = jsonToPython('{"a": 1}', { indent: 2 });
  assert.ok(two.ok && two.output === "{\n  'a': 1\n}");
  const tab = jsonToPython('{"a": [1, 2]}', { indent: 'tab' });
  assert.ok(tab.ok && tab.output === "{\n\t'a': [\n\t\t1,\n\t\t2\n\t]\n}");
  const single = jsonToPython('{"a": 1, "b": [1, 2]}', { indent: 0 });
  assert.ok(single.ok && single.output === "{'a': 1, 'b': [1, 2]}");
});

test('jsonToPython: sortKeys sorts nested objects too', () => {
  const r = jsonToPython('{"b": {"z": 1, "a": 2}, "a": 1}', { indent: 0, sortKeys: true });
  assert.ok(r.ok && r.output === "{'a': 1, 'b': {'a': 2, 'z': 1}}");
});

test('jsonToPython: rejects invalid JSON and empty input', () => {
  assert.ok(!jsonToPython("{'a': 1}").ok); // Python-style quotes are not valid JSON
  assert.ok(!jsonToPython('{"a": 1,}').ok); // trailing comma is not valid JSON
  const empty = jsonToPython('   ');
  assert.ok(!empty.ok && /Paste JSON/.test(empty.error));
});

test('jsonToPython: malformed JSON reports a line/column instead of a raw engine exception', () => {
  const r = jsonToPython('{\n  "a": 1,\n  "b": ,\n}');
  assert.ok(!r.ok);
  assert.ok(r.line !== undefined, `expected a line number, got ${JSON.stringify(r)}`);
});

test('jsonToPython: key order and every digit survive (no trip through a JS object or number)', () => {
  // A plain JS object would move "2" and "1" to the front in numeric order, and JSON.parse
  // would round 12345678901234567890 to 12345678901234567000.
  const r = jsonToPython('{"2": "b", "1": "a", "x": "c", "id": 12345678901234567890, "f": 1.0, "e": 1E5}', { indent: 0 });
  assert.ok(r.ok);
  assert.equal(r.ok && r.output, "{'2': 'b', '1': 'a', 'x': 'c', 'id': 12345678901234567890, 'f': 1.0, 'e': 1E5}");
});

test('jsonToPython: control characters are escaped so the output is valid Python', () => {
  const c = String.fromCharCode;
  const r = jsonToPython(JSON.stringify(['a' + c(13) + 'b', 'nul' + c(0), 'bell' + c(7), 'del' + c(0x7f)]), { indent: 0 });
  assert.ok(r.ok);
  assert.equal(r.ok && r.output, String.raw`['a\rb', 'nul\x00', 'bell\x07', 'del\x7f']`);
});

test('OrderedDict written as a list of pairs becomes an object', () => {
  assert.equal(mini("OrderedDict([('a', 1), ('b', 2)])"), '{"a":1,"b":2}');
  assert.equal(mini("OrderedDict([(1, 'x'), (None, 'y')])"), '{"1":"x","null":"y"}');
});

test('regression: big integers keep every digit (Python ints have no size limit)', () => {
  assert.equal(mini("{'id': 12345678901234567890, 'neg': -98765432109876543210, 'hex': 0xFFFFFFFFFFFFFFFFFF}"),
    '{"id":12345678901234567890,"neg":-98765432109876543210,"hex":4722366482869645213695}');
  assert.equal(mini('-0'), '0');
});

test('regression: dict keys keep their written order, integer-like ones included', () => {
  assert.equal(mini("{'b': 1, '2': 2, 'a': 3, 1: 4}"), '{"b":1,"2":2,"a":3,"1":4}');
  assert.equal(mini("{'a': 1, 'b': 2, 'a': 3}"), '{"a":3,"b":2}'); // repeated key: first position, last value
});

test('floats are written the way json.dumps (Python repr) writes them', () => {
  const cases: [string, string][] = [
    ['1.0', '1.0'], ['-0.0', '-0.0'], ['0.1', '0.1'], ['1e16', '1e+16'], ['1e15', '1000000000000000.0'],
    ['123456789012345678.0', '1.2345678901234568e+17'], ['0.0001', '0.0001'], ['0.00001', '1e-05'],
    ['1.5e-7', '1.5e-07'], ['2.5e300', '2.5e+300'], ['5e-324', '5e-324'], ['1_0.2_5', '10.25'], ['1e999', 'null'],
  ];
  for (const [py, json] of cases) assert.equal(mini(py), json, py);
  assert.equal(mini("{1.0: 'a', 2.5: 'b'}"), '{"1.0":"a","2.5":"b"}'); // float keys use repr too
});

test('sortKeys sorts by code point, as Python does (an emoji sorts after U+FF01)', () => {
  const emoji = String.fromCodePoint(0x1f600);
  const fullwidth = String.fromCodePoint(0xff01);
  const r = pythonToJson(`{'${emoji}': 1, '${fullwidth}': 2, 'Z': 3, 'a': 4}`, { indent: 0, sortKeys: true });
  assert.ok(r.ok && r.output === `{"Z":3,"a":4,"${fullwidth}":2,"${emoji}":1}`);
});

test('a number prefix with no digits is an error, not a crash', () => {
  const r = pythonToJson('[0x_]');
  assert.ok(!r.ok && /prefix with no digits/.test(r.error));
});

test('escapes decode as Python decodes them: octal, exact-length hex, nothing extra in bytes', () => {
  const c = String.fromCharCode;
  // Octal takes one to three digits: \012 is a newline, \0 a NUL, \1234 is S then "4".
  assert.equal(JSON.parse(mini(String.raw`['\012', '\0', '\1234', '\x41\u00e9\U0001F600']`)).join('|'),
    [c(10), c(0), 'S4', 'A' + c(0xe9) + String.fromCodePoint(0x1f600)].join('|'));
  // In a bytes literal \u is not an escape, so it stays as written.
  assert.equal(JSON.parse(mini(String.raw`b'\u00e9\x41'`)), String.raw`\u00e9` + 'A');
  // Python rejects a short or non-hex escape; it used to become a NUL here.
  for (const bad of [String.raw`'\xZZ'`, String.raw`'\x4'`, String.raw`'\u12'`, String.raw`'\U00110000'`]) {
    const r = pythonToJson(bad);
    assert.ok(!r.ok && /escape/.test(r.error), bad);
  }
});
