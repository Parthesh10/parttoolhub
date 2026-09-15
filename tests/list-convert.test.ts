import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnToList, listToColumn, detectDelimiter, PRESETS, DEFAULT_OPTIONS, DELIMITER_CHOICES } from '../src/lib/list-convert.ts';

test('the default separator is "Comma only", and the UI starts on it', () => {
  // Maintainer's decision (2026-09-15): most destinations (CSV cells, query strings, IN lists) want no space.
  assert.equal(DEFAULT_OPTIONS.delimiter, ',');
  assert.equal(DELIMITER_CHOICES[0].value, DEFAULT_OPTIONS.delimiter, 'the <select> starts on its first option, which must be the default');
  assert.equal(PRESETS[0].options.delimiter, DEFAULT_OPTIONS.delimiter, 'the first preset chip is the one highlighted at load');
});

test('basic column → comma list', () => {
  const r = columnToList('apple\nbanana\ncherry');
  assert.equal(r.output, 'apple,banana,cherry');
  assert.equal(r.count, 3);
});

test('handles CRLF and trims', () => {
  const r = columnToList('  a \r\nb\r\n c');
  assert.equal(r.output, 'a,b,c');
});

test('skips empty lines and reports dropped', () => {
  const r = columnToList('a\n\n\nb\n');
  assert.equal(r.output, 'a,b');
  assert.equal(r.count, 2);
  assert.equal(r.dropped, 3);
});

test('dedupe respects case flag', () => {
  assert.equal(columnToList('A\na\nA', { delimiter: ', ', dedupe: true }).output, 'A, a');
  assert.equal(columnToList('A\na\nA', { delimiter: ', ', dedupe: true, dedupeIgnoreCase: true }).output, 'A');
});

test('sorting modes', () => {
  assert.equal(columnToList('b\nc\na', { delimiter: ', ', sort: 'az' }).output, 'a, b, c');
  assert.equal(columnToList('b\nc\na', { delimiter: ', ', sort: 'za' }).output, 'c, b, a');
  assert.equal(columnToList('item10\nitem9\nitem1', { delimiter: ', ', sort: 'az' }).output, 'item1, item9, item10');
  assert.equal(columnToList('10\n9\n100', { delimiter: ', ', sort: 'num-asc' }).output, '9, 10, 100');
  assert.equal(columnToList('$1,000\n$50', { delimiter: ', ', sort: 'num-desc' }).output, '$1,000, $50');
  assert.equal(columnToList('ccc\na\nbb', { delimiter: ', ', sort: 'len-asc' }).output, 'a, bb, ccc');
});

test('case transforms', () => {
  assert.equal(columnToList('Hello World', { delimiter: ', ', textCase: 'upper' }).output, 'HELLO WORLD');
  assert.equal(columnToList('Hello World', { delimiter: ', ', textCase: 'lower' }).output, 'hello world');
  assert.equal(columnToList('hELLO wORLD', { delimiter: ', ', textCase: 'title' }).output, 'Hello World');
});

test('reverse is applied after sort', () => {
  assert.equal(columnToList('b\nc\na', { delimiter: ', ', sort: 'az', reverse: true }).output, 'c, b, a');
});

test('item and list wrappers', () => {
  const r = columnToList('a\nb', { delimiter: ', ', itemPrefix: "'", itemSuffix: "'", listPrefix: '(', listSuffix: ')' });
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
  const joined = columnToList(original, { delimiter: ', ', itemPrefix: '"', itemSuffix: '"', listPrefix: '[', listSuffix: ']' }).output;
  assert.equal(listToColumn(joined).output, original);
});
