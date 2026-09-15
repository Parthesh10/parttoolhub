import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLorem, makeWords, makeSentences, makeParagraphs, WORD_BANK, MIN_COUNT, MAX_COUNT } from '../src/lib/lorem-ipsum.ts';

test('makeWords: returns exactly n lowercase words with no punctuation', () => {
  const words = makeWords(12);
  assert.equal(words.length, 12);
  for (const w of words) {
    assert.match(w, /^[a-z]+$/, `"${w}" should be lowercase letters only`);
    assert.ok(WORD_BANK.includes(w), `"${w}" should come from the word bank`);
  }
});

test('makeWords: startWithLorem always opens with "lorem ipsum dolor sit amet"', () => {
  const words = makeWords(20, true);
  assert.deepEqual(words.slice(0, 5), ['lorem', 'ipsum', 'dolor', 'sit', 'amet']);
});

test('makeWords: startWithLorem with fewer words than the opening phrase truncates it, not errors', () => {
  const words = makeWords(3, true);
  assert.deepEqual(words, ['lorem', 'ipsum', 'dolor']);
});

test('makeSentences: each sentence is capitalized and ends with a period', () => {
  const sentences = makeSentences(10);
  assert.equal(sentences.length, 10);
  for (const s of sentences) {
    assert.match(s, /^[A-Z]/, `"${s}" should start with a capital letter`);
    assert.match(s, /\.$/, `"${s}" should end with a period`);
    assert.equal((s.match(/\./g) ?? []).length, 1, `"${s}" should have exactly one period`);
  }
});

test('makeSentences: only the first sentence gets the Lorem ipsum opening', () => {
  const sentences = makeSentences(5, true);
  assert.match(sentences[0], /^Lorem ipsum dolor sit amet/);
  for (const s of sentences.slice(1)) assert.doesNotMatch(s, /^Lorem ipsum/);
});

test('makeParagraphs: each paragraph has multiple sentences', () => {
  const paragraphs = makeParagraphs(4);
  assert.equal(paragraphs.length, 4);
  for (const p of paragraphs) {
    const sentenceCount = (p.match(/\./g) ?? []).length;
    assert.ok(sentenceCount >= 3 && sentenceCount <= 7, `paragraph had ${sentenceCount} sentences, expected 3-7`);
  }
});

test('generateLorem: words unit produces a single space-joined line', () => {
  const r = generateLorem({ unit: 'words', count: 15, startWithLorem: true });
  assert.ok(r.ok);
  assert.ok(r.value.text.startsWith('Lorem ipsum dolor sit amet'));
  assert.equal(r.value.text.includes('\n'), false);
  assert.equal(r.value.wordCount, 15);
});

test('generateLorem: sentences unit joins with spaces, paragraphs unit joins with blank lines', () => {
  const sentences = generateLorem({ unit: 'sentences', count: 3 });
  assert.ok(sentences.ok);
  assert.equal(sentences.value.text.includes('\n'), false);

  const paragraphs = generateLorem({ unit: 'paragraphs', count: 3 });
  assert.ok(paragraphs.ok);
  assert.equal(paragraphs.value.text.split('\n\n').length, 3);
});

test('generateLorem: defaults to 3 paragraphs starting with the classic opening', () => {
  const r = generateLorem();
  assert.ok(r.ok);
  assert.equal(r.value.unitCount, 3);
  assert.ok(r.value.text.startsWith('Lorem ipsum dolor sit amet'));
});

test('generateLorem: count bounds are enforced (1-50), fractional counts are floored', () => {
  for (const count of [0, -1, 51, NaN, Infinity]) {
    const r = generateLorem({ count });
    assert.equal(r.ok, false, `count ${count} should be refused`);
  }
  assert.ok(generateLorem({ count: MIN_COUNT }).ok);
  assert.ok(generateLorem({ count: MAX_COUNT }).ok);
  const fractional = generateLorem({ unit: 'words', count: 5.9 });
  assert.ok(fractional.ok);
  assert.equal(fractional.value.unitCount, 5);
});

test('50 paragraphs generate well under a second', () => {
  const t0 = performance.now();
  const r = generateLorem({ unit: 'paragraphs', count: 50 });
  assert.ok(r.ok);
  assert.ok(performance.now() - t0 < 500, `took ${(performance.now() - t0).toFixed(0)} ms`);
});
