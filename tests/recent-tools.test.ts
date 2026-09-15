import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushRecent, parseRecent, MAX_RECENT_TOOLS } from '../src/lib/recent-tools.ts';

test('pushRecent puts the new slug first', () => {
  assert.deepEqual(pushRecent([], 'json-formatter'), ['json-formatter']);
  assert.deepEqual(pushRecent(['json-formatter'], 'password-generator'), ['password-generator', 'json-formatter']);
});

test('pushRecent de-duplicates: revisiting a tool moves it to the front instead of listing it twice', () => {
  const after = pushRecent(['a', 'b', 'c'], 'b');
  assert.deepEqual(after, ['b', 'a', 'c']);
});

test('pushRecent caps the list at max, dropping the oldest', () => {
  const full = ['a', 'b', 'c'];
  assert.deepEqual(pushRecent(full, 'd', 3), ['d', 'a', 'b']);
});

test('pushRecent defaults to MAX_RECENT_TOOLS', () => {
  const long = Array.from({ length: MAX_RECENT_TOOLS }, (_, i) => `tool-${i}`);
  const after = pushRecent(long, 'new-tool');
  assert.equal(after.length, MAX_RECENT_TOOLS);
  assert.equal(after[0], 'new-tool');
});

test('parseRecent handles missing, malformed, and well-formed values without throwing', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('not json'), []);
  assert.deepEqual(parseRecent('{"a":1}'), []); // valid JSON, not an array
  assert.deepEqual(parseRecent('[1, 2, "a"]'), ['a']); // drops non-string entries rather than throwing
  assert.deepEqual(parseRecent('["json-formatter","password-generator"]'), ['json-formatter', 'password-generator']);
});
