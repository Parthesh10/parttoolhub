import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SYNONYMS, matchesSynonym } from '../src/lib/tool-synonyms.ts';
import { toolBySlug } from '../src/data/tools.ts';

test('every synonym key exists in the live tool registry', () => {
  for (const slug of Object.keys(TOOL_SYNONYMS)) {
    assert.doesNotThrow(() => toolBySlug(slug), `slug "${slug}" in TOOL_SYNONYMS is not in the tool registry`);
  }
});

test('every synonym list is non-empty and lowercase (matching is case-sensitive by design -- the caller lowercases the query)', () => {
  for (const [slug, phrases] of Object.entries(TOOL_SYNONYMS)) {
    assert.ok(phrases.length > 0, `${slug} has an empty synonym list`);
    for (const phrase of phrases) {
      assert.equal(phrase, phrase.toLowerCase(), `"${phrase}" for ${slug} is not lowercase`);
    }
  }
});

test('matchesSynonym finds a query that is a synonym phrase', () => {
  assert.ok(matchesSynonym('json-formatter', 'pretty json'));
  assert.ok(matchesSynonym('unix-timestamp-converter', 'epoch'));
  assert.ok(matchesSynonym('remove-duplicate-lines', 'dedupe'));
});

test('matchesSynonym matches a partial word within a synonym phrase', () => {
  assert.ok(matchesSynonym('json-formatter', 'pretty')); // "pretty" is inside "pretty json"
});

test('matchesSynonym matches when the query is longer than the phrase', () => {
  assert.ok(matchesSynonym('remove-duplicate-lines', 'please dedupe this list'));
});

test('matchesSynonym returns false for an unrelated query or slug', () => {
  assert.equal(matchesSynonym('json-formatter', 'random password'), false);
  assert.equal(matchesSynonym('unknown-slug', 'epoch'), false);
  assert.equal(matchesSynonym('json-formatter', ''), false);
});
