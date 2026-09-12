import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnToList, listToColumn, detectDelimiter, PRESETS } from '../src/lib/list-convert.ts';

test('basic column → comma list', () => {
  const r = columnToList('apple\nbanana\ncherry');
  assert.equal(r.output, 'apple, banana, cherry');
  assert.equal(r.count, 3);
});

test('handles CRLF and trims', () => {
  const r = columnToList('  a \r\nb\r\n c');
  assert.equal(r.output, 'a, b, c');
});

test('skips empty lines and reports dropped', () => {
  const r = columnToList('a\n\n\nb\n');
  assert.equal(r.output, 'a, b');
  assert.equal(r.count, 2);
  assert.equal(r.dropped, 3);
});

test('dedupe respects case flag', () => {
  assert.equal(columnToList('A\na\nA', { dedupe: true }).output, 'A, a');
  assert.equal(columnToList('A\na\nA', { dedupe: true, dedupeIgnoreCase: true }).output, 'A');
});

test('sorting modes', () => {
  assert.equal(columnToList('b\nc\na', { sort: 'az' }).output, 'a, b, c');
  assert.equal(columnToList('b\nc\na', { sort: 'za' }).output, 'c, b, a');
  assert.equal(columnToList('item10\nitem9\nitem1', { sort: 'az' }).output, 'item1, item9, item10');
  assert.equal(columnToList('10\n9\n100', { sort: 'num-asc' }).output, '9, 10, 100');
  assert.equal(columnToList('$1,000\n$50', { sort: 'num-desc' }).output, '$1,000, $50');
  assert.equal(columnToList('ccc\na\nbb', { sort: 'len-asc' }).output, 'a, bb, ccc');
});

test('case transforms', () => {
  assert.equal(columnToList('Hello World', { textCase: 'upper' }).output, 'HELLO WORLD');
  assert.equal(columnToList('Hello World', { textCase: 'lower' }).output, 'hello world');
  assert.equal(columnToList('hELLO wORLD', { textCase: 'title' }).output, 'Hello World');
});

test('reverse is applied after sort', () => {
  assert.equal(columnToList('b\nc\na', { sort: 'az', reverse: true }).output, 'c, b, a');
});

test('item and list wrappers', () => {
  const r = columnToList('a\nb', { itemPrefix: "'", itemSuffix: "'", listPrefix: '(', listSuffix: ')' });
  assert.equal(r.output, "('a', 'b')");
});

test('empty input gives empty output without wrappers', () => {
  const r = columnToList('', { listPrefix: '[', listSuffix: ']' });
  assert.equal(r.output, '');
  assert.equal(r.count, 0);
});

test('presets produce their advertised shape', () => {
  const input = 'a\nb\nc';
  const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p.options]));
  assert.equal(columnToList(input, byId.sql).output, "('a', 'b', 'c')");
  assert.equal(columnToList(input, byId.json).output, '["a", "b", "c"]');
  assert.equal(columnToList(input, byId.python).output, "['a', 'b', 'c']");
  assert.equal(columnToList(input, byId.regex).output, '(a|b|c)');
  assert.equal(columnToList(input, byId.compact).output, 'a,b,c');
});

test('detectDelimiter picks the most frequent candidate', () => {
  assert.equal(detectDelimiter('a, b, c'), ',');
  assert.equal(detectDelimiter('a; b; c, d'), ';');
  assert.equal(detectDelimiter('a | b | c'), '|');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a b c'), ' ');
});

test('listToColumn auto mode', () => {
  assert.equal(listToColumn('apple, banana, cherry').output, 'apple\nbanana\ncherry');
  assert.equal(listToColumn('a;b;c').output, 'a\nb\nc');
  assert.equal(listToColumn('one two three').output, 'one\ntwo\nthree');
});

test('listToColumn strips wrappers and quotes', () => {
  assert.equal(listToColumn('["a", "b", "c"]').output, 'a\nb\nc');
  assert.equal(listToColumn("('x', 'y')").output, 'x\ny');
  assert.equal(listToColumn('"a","b"', { unquote: false }).output, '"a"\n"b"');
});

test('listToColumn explicit delimiter, dedupe and sort', () => {
  const r = listToColumn('b|a|b', { delimiter: '|', dedupe: true, sort: 'az' });
  assert.equal(r.output, 'a\nb');
  assert.equal(r.count, 2);
});

test('round trip is stable', () => {
  const original = 'alpha\nbeta\ngamma';
  const joined = columnToList(original, { itemPrefix: '"', itemSuffix: '"', listPrefix: '[', listSuffix: ']' }).output;
  assert.equal(listToColumn(joined).output, original);
});
