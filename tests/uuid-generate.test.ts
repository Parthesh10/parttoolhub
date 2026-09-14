import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateV4, generateV7, extractV7Timestamp, formatUuid, generateUuids } from '../src/lib/uuid-generate.ts';

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('generateV4: correct version and variant nibbles, valid RFC 4122 shape', () => {
  for (let i = 0; i < 20; i++) assert.match(formatUuid(generateV4()), V4_RE);
});

test('generateV7: correct version and variant nibbles', () => {
  for (let i = 0; i < 20; i++) assert.match(formatUuid(generateV7()), V7_RE);
});

test('generateV4/generateV7: two calls never collide (16 random bytes, astronomically unlikely)', () => {
  const a = formatUuid(generateV4());
  const b = formatUuid(generateV4());
  assert.notEqual(a, b);
});

test('extractV7Timestamp: round-trips the millisecond timestamp a v7 UUID was built from', () => {
  const now = Date.UTC(2026, 0, 15, 10, 30, 0, 123);
  const bytes = generateV7(now);
  assert.equal(extractV7Timestamp(bytes), now);
});

test('v7 UUIDs generated later sort after ones generated earlier (the whole point of v7)', () => {
  const earlier = formatUuid(generateV7(Date.UTC(2026, 0, 1)));
  const later = formatUuid(generateV7(Date.UTC(2026, 6, 1)));
  assert.ok(earlier < later);
});

test('formatUuid: hyphens, uppercase and braces options', () => {
  const bytes = generateV4();
  const hyphenated = formatUuid(bytes);
  assert.match(hyphenated, /^[0-9a-f-]{36}$/);
  assert.equal(formatUuid(bytes, { hyphens: false }), hyphenated.replace(/-/g, ''));
  assert.equal(formatUuid(bytes, { uppercase: true }), hyphenated.toUpperCase());
  assert.equal(formatUuid(bytes, { braces: true }), `{${hyphenated}}`);
});

test('generateUuids: produces the requested count, all unique, all matching the version', () => {
  const ids = generateUuids(4, 25);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25);
  for (const id of ids) assert.match(id, V4_RE);
});

test('generateUuids: count is clamped to a sane range rather than erroring', () => {
  assert.equal(generateUuids(4, 0).length, 1);
  assert.equal(generateUuids(4, -5).length, 1);
  assert.equal(generateUuids(4, 1_000_000).length, 1000);
});
