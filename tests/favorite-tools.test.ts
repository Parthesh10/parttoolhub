import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleFavorite, parseFavorites, MAX_FAVORITE_TOOLS } from '../src/lib/favorite-tools.ts';

test('toggleFavorite adds an absent slug', () => {
  assert.deepEqual(toggleFavorite([], 'json-formatter'), ['json-formatter']);
  assert.deepEqual(toggleFavorite(['a', 'b'], 'c'), ['a', 'b', 'c']);
});

test('toggleFavorite removes a present slug', () => {
  assert.deepEqual(toggleFavorite(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(toggleFavorite(['only'], 'only'), []);
});

test('toggleFavorite caps the list, dropping the oldest pin', () => {
  const full = Array.from({ length: MAX_FAVORITE_TOOLS }, (_, i) => `tool-${i}`);
  const after = toggleFavorite(full, 'new-tool');
  assert.equal(after.length, MAX_FAVORITE_TOOLS);
  assert.equal(after[after.length - 1], 'new-tool');
  assert.equal(after[0], 'tool-1'); // the oldest pin, tool-0, was dropped
});

test('parseFavorites handles missing, malformed, and well-formed values without throwing', () => {
  assert.deepEqual(parseFavorites(null), []);
  assert.deepEqual(parseFavorites('not json'), []);
  assert.deepEqual(parseFavorites('{"a":1}'), []); // valid JSON, not an array
  assert.deepEqual(parseFavorites('[1, 2, "a"]'), ['a']); // drops non-string entries rather than throwing
  assert.deepEqual(parseFavorites('["json-formatter","password-generator"]'), ['json-formatter', 'password-generator']);
});
