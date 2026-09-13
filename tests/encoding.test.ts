import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase64, decodeBase64, urlEncode, urlDecode } from '../src/lib/encoding.ts';
import { dedupeLines } from '../src/lib/dedupe-lines.ts';

test('base64 round trip with unicode', () => {
  const s = 'Hello, 世界 — ünïcödé 🚀';
  const enc = encodeBase64(s);
  const dec = decodeBase64(enc);
  assert.ok(dec.ok && dec.output === s);
});

test('base64 url-safe and no padding', () => {
  assert.equal(encodeBase64('??>'), 'Pz8+');
  assert.equal(encodeBase64('??>', { urlSafe: true }), 'Pz8-');
  assert.equal(encodeBase64('a', { noPadding: true }), 'YQ');
  const dec = decodeBase64('YQ');
  assert.ok(dec.ok && dec.output === 'a');
});

test('base64 decode errors', () => {
  assert.ok(!decodeBase64('').ok);
  assert.ok(!decodeBase64('not base64!').ok);
  assert.ok(!decodeBase64('YQ===a').ok);
});

test('url encode modes', () => {
  assert.equal(urlEncode('a b&c=d/e'), 'a%20b%26c%3Dd%2Fe');
  assert.equal(urlEncode('https://x.y/p q?a=b c', 'full'), 'https://x.y/p%20q?a=b%20c');
  assert.equal(urlEncode('a b', 'form'), 'a+b');
});

test('url decode', () => {
  assert.deepEqual(urlDecode('a+b%20c%26'), { ok: true, output: 'a b c&' });
  assert.deepEqual(urlDecode('a+b', false), { ok: true, output: 'a+b' });
  assert.ok(!urlDecode('%zz').ok);
});

test('dedupe basics', () => {
  const r = dedupeLines('a\nb\na\n\nc\nb');
  assert.equal(r.output, 'a\nb\nc');
  assert.equal(r.total, 6);
  assert.equal(r.unique, 3);
  assert.equal(r.removed, 2);
});

test('dedupe ignoreCase, trim, keep last', () => {
  assert.equal(dedupeLines('A\na\n B ', { ignoreCase: true }).output, 'A\nB');
  assert.equal(dedupeLines('a\nb\na', { keep: 'last' }).output, 'b\na');
  assert.equal(dedupeLines(' a\na', { trim: false }).output, ' a\na');
});

test('dedupe onlyDuplicates and sort', () => {
  assert.equal(dedupeLines('x\ny\nx\nz\ny', { onlyDuplicates: true }).output, 'x\ny');
  assert.equal(dedupeLines('b\na\nb', { sort: 'az' }).output, 'a\nb');
});

test('url decode distinguishes a bad escape from invalid UTF-8 bytes', () => {
  const bad = urlDecode('100%');
  assert.ok(!bad.ok && /two hex digits/.test(bad.error));
  const notUtf8 = urlDecode('%FF');
  assert.ok(!notUtf8.ok && /UTF-8/.test(notUtf8.error));
});

test('lone surrogates never throw: URL encoding substitutes U+FFFD like Base64 does', () => {
  const broken = 'a\uD800b';
  assert.equal(urlEncode(broken, 'component'), 'a%EF%BF%BDb');
  assert.equal(urlEncode(broken, 'full'), 'a%EF%BF%BDb');
  assert.equal(encodeBase64(broken), encodeBase64('a\uFFFDb'));
});

test('base64 round-trips a multi-megabyte input (chunked encode/decode)', () => {
  const big = 'h\u00e9llo w\u00f6rld \u{1F44B} '.repeat(200_000); // ~4.6 MB of UTF-8
  const r = decodeBase64(encodeBase64(big));
  assert.ok(r.ok && r.output === big);
});
