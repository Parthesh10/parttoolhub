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
  assert.equal(mini("[1_000, 0xff, 0b101, 3.5, -2, .5, 1e3]"), '[1000,255,5,3.5,-2,0.5,1000]');
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

test('jsonToPython reverse direction', () => {
  const r = jsonToPython('{"a": [1, true, null], "s": "it\'s"}');
  assert.ok(r.ok);
  assert.equal(r.output, "{\n    'a': [\n        1,\n        True,\n        None\n    ],\n    's': 'it\\'s'\n}");
});

test('OrderedDict written as a list of pairs becomes an object', () => {
  assert.equal(mini("OrderedDict([('a', 1), ('b', 2)])"), '{"a":1,"b":2}');
  assert.equal(mini("OrderedDict([(1, 'x'), (None, 'y')])"), '{"1":"x","null":"y"}');
});
