import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeJson, highlightJsonHtml } from '../src/lib/json-highlight.ts';
import { SAMPLES, formatJson } from '../src/lib/json-format.ts';

const types = (src: string) => tokenizeJson(src).filter((t) => t.type !== 'plain').map((t) => `${t.type}:${t.text}`);
const unhtml = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('tells keys from string values, and gives each literal its own type', () => {
  assert.deepEqual(types('{"name": "Ada", "age": 36, "admin": true, "banned": false, "boss": null}'), [
    'punct:{', 'key:"name"', 'punct::', 'string:"Ada"', 'punct:,',
    'key:"age"', 'punct::', 'number:36', 'punct:,',
    'key:"admin"', 'punct::', 'boolean:true', 'punct:,',
    'key:"banned"', 'punct::', 'boolean:false', 'punct:,',
    'key:"boss"', 'punct::', 'null:null', 'punct:}',
  ]);
});

test('a key is still a key when the colon is on the next line or after spaces', () => {
  assert.deepEqual(types('{"a"\n  :1}').slice(0, 2), ['punct:{', 'key:"a"']);
});

test('numbers: negative, fraction, exponent, and a string that looks like a number stays a string', () => {
  assert.deepEqual(types('[-1.5e+3, 0, 9007199254740993, "42"]'), [
    'punct:[', 'number:-1.5e+3', 'punct:,', 'number:0', 'punct:,', 'number:9007199254740993', 'punct:,', 'string:"42"', 'punct:]',
  ]);
});

test('escaped quotes and backslashes do not end a string early', () => {
  assert.deepEqual(types('{"q": "say \\"hi\\" \\\\"}'), ['punct:{', 'key:"q"', 'punct::', 'string:"say \\"hi\\" \\\\"', 'punct:}']);
});

test('reconstructs the input exactly, so the colour layer lines up under the textarea', () => {
  const inputs = [
    ...Object.values(SAMPLES).map((s) => { const r = formatJson(s); return r.ok ? r.output : s; }),
    '{"html": "<b>&amp;</b>"}',
    '{"unterminated": "abc',
    'not json at all <script>',
    '',
  ];
  for (const src of inputs) assert.equal(unhtml(highlightJsonHtml(src)), src);
});

test('HTML in values is escaped, never injected', () => {
  assert.ok(!highlightJsonHtml('{"x": "<img src=x onerror=alert(1)>"}').includes('<img'));
});
