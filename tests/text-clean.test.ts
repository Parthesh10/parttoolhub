import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText } from '../src/lib/text-clean.ts';

const out = (s: string, o = {}) => cleanText(s, o).output;

test('strips headings, emphasis, code and links', () => {
  assert.equal(out('## Title\n\nThis is **bold**, *italic*, `code` and a [link](https://x.y).'),
    'Title\n\nThis is bold, italic, code and a link.');
});

test('keeps code inside fences, drops the fence lines', () => {
  assert.equal(out('Run:\n```bash\nnpm test\n```\nDone.'), 'Run:\nnpm test\nDone.');
});

test('normalises bullets and removes task boxes and blockquotes', () => {
  assert.equal(out('* one\n+ two\n- [ ] three\n> quoted'), '- one\n- two\n- three\nquoted');
});

test('em dash modes', () => {
  const s = 'Fast — really fast — and cheap.';
  assert.equal(out(s, { emDash: 'comma' }), 'Fast, really fast, and cheap.');
  assert.equal(out(s, { emDash: 'hyphen' }), 'Fast-really fast-and cheap.');
  assert.equal(out(s, { emDash: 'spaced-hyphen' }), 'Fast - really fast - and cheap.');
  assert.equal(out(s, { emDash: 'keep' }), s);
});

test('numeric ranges never become commas', () => {
  assert.equal(out('From 2010–2020 and 5—6.', { emDash: 'comma' }), 'From 2010-2020 and 5-6.');
});

test('straightens quotes and ellipsis', () => {
  assert.equal(out('“Hello,” she said… ‘yes’'), '"Hello," she said... \'yes\'');
});

test('removes invisible characters and NBSP', () => {
  // a + ZWSP + b + NBSP + c + BOM
  const input = 'a\u200Bb\u00A0c\uFEFF';
  assert.equal(out(input), 'ab c');
});

test('removes citation markers', () => {
  assert.equal(out('Fact[1] and fact[2, 3] and 【4†source】 done[^5].'), 'Fact and fact and done.');
});

test('emoji removal is opt-in', () => {
  assert.equal(out('Great 🚀🎉 work 👍🏽'), 'Great 🚀🎉 work 👍🏽');
  assert.equal(out('Great 🚀🎉 work 👍🏽', { emoji: true }), 'Great work');
});

test('whitespace tidy', () => {
  assert.equal(out('a   b  \n\n\n\nc '), 'a b\n\nc');
});

test('table pipes are flattened', () => {
  assert.equal(out('| A | B |\n|---|---|\n| 1 | 2 |'), 'A B\n1 2');
});

test('reports what changed', () => {
  const r = cleanText('**x** — y');
  assert.ok(r.changes.markdown && r.changes.emDash);
  assert.equal(r.output, 'x, y');
});

test('a long run of brackets is cleaned in linear time (no regex backtracking blow-up)', () => {
  const input = '['.repeat(100_000) + ']'.repeat(100_000);
  const t = performance.now();
  cleanText(input);
  assert.ok(performance.now() - t < 1000, 'took longer than a second — quadratic regex again?');
  // Links still work, including labels with other punctuation.
  assert.equal(cleanText('see [the docs, v2](https://x.y) now', { citations: false }).output, 'see the docs, v2 now');
});
