import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCaseLine, sentenceCaseLine, convertCase } from '../src/lib/title-case.ts';

test('APA lowercases short minor words, capitalises 4+ letter prepositions', () => {
  assert.equal(titleCaseLine('the lord of the rings', { style: 'apa' }), 'The Lord of the Rings');
  assert.equal(titleCaseLine('a walk through the park with dogs', { style: 'apa' }), 'A Walk Through the Park With Dogs');
});

test('Chicago lowercases all prepositions', () => {
  assert.equal(titleCaseLine('a walk through the park with dogs', { style: 'chicago' }), 'A Walk through the Park with Dogs');
});

test('first and last words are always capitalised', () => {
  assert.equal(titleCaseLine('of mice and men in', { style: 'chicago' }), 'Of Mice and Men In');
});

test('word after a colon is capitalised', () => {
  assert.equal(titleCaseLine('star wars: the empire strikes back'), 'Star Wars: The Empire Strikes Back');
});

test('hyphenated compounds capitalise each part', () => {
  assert.equal(titleCaseLine('self-driving cars and out-of-date maps'), 'Self-Driving Cars and Out-of-Date Maps');
});

test('intentional casing such as acronyms and brands is preserved', () => {
  assert.equal(titleCaseLine('working at NASA on the iPhone team'), 'Working at NASA on the iPhone Team');
  assert.equal(titleCaseLine('working at NASA', { preserveIntentionalCase: false }), 'Working at Nasa');
});

test('an all-caps line is normalised first', () => {
  assert.equal(titleCaseLine('THE QUICK BROWN FOX'), 'The Quick Brown Fox');
});

test('leading punctuation does not block capitalisation', () => {
  assert.equal(titleCaseLine('"hello world"'), '"Hello World"');
});

test('sentence case', () => {
  assert.equal(sentenceCaseLine('HELLO WORLD. this is a TEST! i am here'), 'Hello world. This is a test! I am here');
});

test('other modes', () => {
  assert.equal(convertCase('hello world', 'upper'), 'HELLO WORLD');
  assert.equal(convertCase('Hello World', 'lower'), 'hello world');
  assert.equal(convertCase('hello big-world', 'capitalize'), 'Hello Big-World');
  assert.equal(convertCase('hello', 'alternating'), 'hElLo');
  assert.equal(convertCase('Hello', 'toggle'), 'hELLO');
});

test('multi-line input is processed per line', () => {
  assert.equal(convertCase('the first\nthe second', 'title'), 'The First\nThe Second');
});
