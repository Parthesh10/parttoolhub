import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffText, diffWords, tokenizeWords, splitLines, SAMPLE_A, SAMPLE_B, MAX_LINES, MAX_WORDS } from '../src/lib/text-diff.ts';

test('tokenizeWords reconstructs the original string exactly, including irregular whitespace', () => {
  const s = 'The  quick brown\tfox.';
  assert.equal(tokenizeWords(s).join(''), s);
});

test('splitLines splits on \\n only, matching the diff’s own line notion', () => {
  assert.deepEqual(splitLines('a\nb\nc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines(''), ['']);
});

test('identical text: one equal group, zero added/removed, identical is true', () => {
  const r = diffText('a\nb\nc', 'a\nb\nc');
  assert.ok(r.ok);
  assert.equal(r.value.groups.length, 1);
  assert.equal(r.value.groups[0].type, 'equal');
  assert.equal(r.value.stats.identical, true);
});

test('a single changed line becomes a replace group with an inline word diff', () => {
  const r = diffText('The quick brown fox', 'The quick red fox');
  assert.ok(r.ok);
  const replace = r.value.groups.find((g) => g.type === 'replace');
  assert.ok(replace && replace.type === 'replace');
  assert.ok(replace.wordDiff, 'a 1:1 replace should carry a word-level diff');
  const changedWords = replace.wordDiff!.filter((o) => o.type !== 'equal').map((o) => o.value);
  assert.deepEqual(changedWords, ['brown', 'red']);
});

test('a multi-line replace block has no wordDiff (only 1:1 replacements get inline word highlighting)', () => {
  const r = diffText('one\ntwo', 'uno\ndos\ntres');
  assert.ok(r.ok);
  const replace = r.value.groups.find((g) => g.type === 'replace');
  assert.ok(replace && replace.type === 'replace');
  assert.equal(replace.wordDiff, undefined);
});

test('a pure insertion (old has fewer lines) produces an insert group, not a replace', () => {
  const r = diffText('a\nc', 'a\nb\nc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.groups.map((g) => g.type), ['equal', 'insert', 'equal']);
  assert.equal(r.value.stats.linesAdded, 1);
  assert.equal(r.value.stats.linesRemoved, 0);
});

test('a pure deletion produces a delete group', () => {
  const r = diffText('a\nb\nc', 'a\nc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.groups.map((g) => g.type), ['equal', 'delete', 'equal']);
  assert.equal(r.value.stats.linesRemoved, 1);
});

test('empty-string inputs are valid (two single empty lines) and compare as identical', () => {
  const r = diffText('', '');
  assert.ok(r.ok);
  assert.equal(r.value.stats.identical, true);
});

test('the shared sample pair produces a mix of a changed line, an unchanged line, a removal and an addition', () => {
  const r = diffText(SAMPLE_A, SAMPLE_B);
  assert.ok(r.ok);
  assert.ok(r.value.stats.linesAdded > 0);
  assert.ok(r.value.stats.linesRemoved > 0);
  assert.ok(r.value.groups.some((g) => g.type === 'equal'));
});

test('line count over MAX_LINES is refused with a clear error rather than hanging', () => {
  const huge = Array.from({ length: MAX_LINES + 1 }, (_, i) => `line ${i}`).join('\n');
  const r = diffText(huge, 'a');
  assert.ok(!r.ok);
  assert.match(r.error, /limited to/);
});

test('diffWords: whole-document word diff ignores line boundaries (a rewrapped paragraph still matches)', () => {
  const a = 'The quick brown\nfox jumps.';
  const b = 'The quick brown fox\njumps.';
  const r = diffWords(a, b);
  assert.ok(r.ok);
  // Only whitespace tokens (the newline vs space) should differ; no word should be marked changed.
  const changedWords = r.value.filter((o) => o.type !== 'equal' && o.value.trim() !== '');
  assert.equal(changedWords.length, 0, 'rewrapping should not flag any actual word as added/removed');
});

test('diffWords: a genuine paragraph-break insertion (a blank line) is still detected as a change', () => {
  const r = diffWords('a\nb', 'a\n\nb');
  assert.ok(r.ok);
  assert.deepEqual(r.value.map((o) => o.type), ['equal', 'delete', 'insert', 'equal']);
});

test('diffWords: a genuine word change is detected', () => {
  const r = diffWords('hello world', 'hello there');
  assert.ok(r.ok);
  const changed = r.value.filter((o) => o.type !== 'equal').map((o) => o.value);
  assert.deepEqual(changed, ['world', 'there']);
});

test('diffWords: word count over MAX_WORDS is refused', () => {
  const huge = Array.from({ length: MAX_WORDS + 1 }, (_, i) => `w${i}`).join(' ');
  const r = diffWords(huge, 'a');
  assert.ok(!r.ok);
  assert.match(r.error, /limited to/);
});
