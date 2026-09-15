import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvToJson, jsonToCsv, SAMPLE_CSV, SAMPLE_JSON } from '../src/lib/csv-json.ts';

test('parseCsv: basic rows and quoted fields with embedded commas', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('name,note\nAda,"hello, world"'), [['name', 'note'], ['Ada', 'hello, world']]);
});

test('parseCsv: escaped quotes and embedded newlines inside a quoted field', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
  assert.deepEqual(parseCsv('a\n"line1\nline2"'), [['a'], ['line1\nline2']]);
});

test('parseCsv: CRLF and bare CR line endings both work', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCsv: custom delimiters', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;2;3', ';'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
});

test('csvToJson: header row becomes object keys, with type inference', () => {
  const r = csvToJson('name,age,active\nAda,28,true\nGrace,,false', { indent: 0 });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [
    { name: 'Ada', age: 28, active: true },
    { name: 'Grace', age: null, active: false },
  ]);
});

test('csvToJson: leading-zero numeric strings are kept as text, not silently truncated', () => {
  const r = csvToJson('zip\n00501\n90210', { indent: 0 });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [{ zip: '00501' }, { zip: 90210 }]);
});

test('csvToJson: inferTypes off keeps everything as strings', () => {
  const r = csvToJson('n\n1\ntrue', { indent: 0, inferTypes: false });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [{ n: '1' }, { n: 'true' }]);
});

test('csvToJson: hasHeader false gives an array of arrays', () => {
  const r = csvToJson('1,2\n3,4', { indent: 0, hasHeader: false });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [[1, 2], [3, 4]]);
});

test('csvToJson: ragged rows — missing cells become null, extra cells are dropped', () => {
  const r = csvToJson('a,b,c\n1,2\n1,2,3,4', { indent: 0 });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [
    { a: 1, b: 2, c: null },
    { a: 1, b: 2, c: 3 },
  ]);
});

test('csvToJson: duplicate header names keep the last column\'s value', () => {
  const r = csvToJson('a,a\n1,2', { indent: 0 });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [{ a: 2 }]);
});

test('csvToJson: blank lines are skipped, not turned into empty rows', () => {
  const r = csvToJson('a,b\n1,2\n\n3,4\n', { indent: 0 });
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse((r as { ok: true; output: string }).output), [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
});

test('csvToJson: rejects empty input', () => {
  assert.ok(!csvToJson('').ok);
  assert.ok(!csvToJson('   ').ok);
});

test('jsonToCsv: array of objects, header is the union of keys in first-seen order', () => {
  const r = jsonToCsv(JSON.stringify([{ a: 1, b: 2 }, { b: 3, c: 4 }]));
  assert.ok(r.ok);
  assert.equal((r as { ok: true; output: string }).output, 'a,b,c\r\n1,2,\r\n,3,4');
});

test('jsonToCsv: array of arrays passes through as rows with no header', () => {
  const r = jsonToCsv(JSON.stringify([[1, 2], [3, 4]]));
  assert.ok(r.ok);
  assert.equal((r as { ok: true; output: string }).output, '1,2\r\n3,4');
});

test('jsonToCsv: quotes a cell containing the delimiter, a quote, or a newline', () => {
  const r = jsonToCsv(JSON.stringify([{ note: 'hello, "world"\nline2' }]));
  assert.ok(r.ok);
  assert.equal((r as { ok: true; output: string }).output, 'note\r\n"hello, ""world""\nline2"');
});

test('jsonToCsv: nested objects/arrays are embedded as a JSON string in the cell', () => {
  const r = jsonToCsv(JSON.stringify([{ id: 1, tags: ['a', 'b'] }]));
  assert.ok(r.ok);
  assert.equal((r as { ok: true; output: string }).output, 'id,tags\r\n1,"[""a"",""b""]"');
});

test('jsonToCsv: rejects non-array top level and mixed-shape arrays', () => {
  assert.ok(!jsonToCsv('{"a":1}').ok);
  assert.ok(!jsonToCsv('[1, {"a":2}]').ok);
  assert.ok(!jsonToCsv('not json').ok);
  assert.ok(!jsonToCsv('').ok);
});

test('jsonToCsv: empty array produces empty output, not an error', () => {
  const r = jsonToCsv('[]');
  assert.ok(r.ok && r.output === '');
});

test('round trip: the sample CSV and sample JSON describe the same data', () => {
  const fromCsv = csvToJson(SAMPLE_CSV, { indent: 0 });
  assert.ok(fromCsv.ok);
  assert.deepEqual(JSON.parse((fromCsv as { ok: true; output: string }).output), JSON.parse(SAMPLE_JSON));
});

test('csvToJson: count is the number of JSON records produced, not a character count', () => {
  const withHeader = csvToJson('a,b\n1,2\n3,4\n5,6', { indent: 0 });
  assert.ok(withHeader.ok && withHeader.count === 3);
  const withoutHeader = csvToJson('1,2\n3,4', { indent: 0, hasHeader: false });
  assert.ok(withoutHeader.ok && withoutHeader.count === 2);
});

test('jsonToCsv: count is the number of input array items, not a character count', () => {
  const r = jsonToCsv(JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }]));
  assert.ok(r.ok && r.count === 3);
  const empty = jsonToCsv('[]');
  assert.ok(empty.ok && empty.count === 0);
});
