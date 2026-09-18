import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat } from '../src/lib/detect-format.ts';
import { toolBySlug } from '../src/data/tools.ts';

test('empty or whitespace-only input detects nothing', () => {
  assert.equal(detectFormat(''), null);
  assert.equal(detectFormat('   \n  '), null);
});

test('detects JSON objects and arrays', () => {
  assert.equal(detectFormat('{"a": 1, "b": [1,2,3]}')?.slug, 'json-formatter');
  assert.equal(detectFormat('[1, 2, 3]')?.slug, 'json-formatter');
  assert.equal(detectFormat('  { "x": true }  ')?.slug, 'json-formatter');
});

test('does not mistake plain prose for JSON just because of stray braces', () => {
  assert.equal(detectFormat('{not valid json at all'), null);
});

test('detects a JWT over plain JSON, since a JWT header segment is itself base64url-encoded JSON', () => {
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '123' })}.sig`;
  assert.equal(detectFormat(token)?.slug, 'jwt-decoder');
});

test('a three-dot-separated string whose first part is not JSON is not a JWT', () => {
  assert.equal(detectFormat('not.a.jwt'), null);
});

test('detects Python dict literals (single quotes + True/False/None) but not valid JSON', () => {
  assert.equal(detectFormat("{'a': 1, 'b': True, 'c': None}")?.slug, 'python-dict-to-json');
  assert.equal(detectFormat('{"a": 1}')?.slug, 'json-formatter'); // valid JSON wins, not treated as a dict
});

test('detects an image data URI', () => {
  assert.equal(detectFormat('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB')?.slug, 'base64-to-image');
});

test('detects raw Base64 that decodes to a PNG signature as an image, not generic Base64', () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
  const b64 = pngBytes.toString('base64');
  assert.equal(detectFormat(b64)?.slug, 'base64-to-image');
});

test('detects generic Base64 text', () => {
  const b64 = Buffer.from('Hello, this is a reasonably long plain text string!').toString('base64');
  assert.equal(detectFormat(b64)?.slug, 'base64-encode-decode');
});

test('does not flag short strings as Base64 (too easy to false-positive on real words)', () => {
  assert.equal(detectFormat('Hello'), null);
  assert.equal(detectFormat('abcd'), null);
});

test('detects hex, rgb() and hsl() colors', () => {
  assert.equal(detectFormat('#3366ff')?.slug, 'color-converter');
  assert.equal(detectFormat('#fff')?.slug, 'color-converter');
  assert.equal(detectFormat('rgb(51, 102, 255)')?.slug, 'color-converter');
  assert.equal(detectFormat('hsl(225, 100%, 60%)')?.slug, 'color-converter');
});

test('detects a bare 10 or 13 digit Unix timestamp but not other digit strings', () => {
  assert.equal(detectFormat('1736937000')?.slug, 'unix-timestamp-converter');
  assert.equal(detectFormat('1736937000000')?.slug, 'unix-timestamp-converter');
  assert.equal(detectFormat('12345'), null);
  assert.equal(detectFormat('123456789012345'), null);
});

test('detects URL-encoded text', () => {
  assert.equal(detectFormat('hello%20world%21')?.slug, 'url-encode-decode');
  assert.equal(detectFormat('a%2Bb%3Dc')?.slug, 'url-encode-decode');
});

test('detects HTML', () => {
  assert.equal(detectFormat('<div><p>Hello <b>world</b></p></div>')?.slug, 'html-to-markdown');
});

test('plain sentences and ordinary short text detect nothing', () => {
  assert.equal(detectFormat('This is just a normal sentence, with a comma.'), null);
  assert.equal(detectFormat('apple\nbanana\ncherry'), null);
});

test('every slug the detector can return exists in the live tool registry', () => {
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64url({ alg: 'HS256' })}.${b64url({ sub: '1' })}.sig`;
  const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
  const samples = [
    jwt,
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    '{"a": 1}',
    "{'a': True, 'b': None}",
    '<div><p>x</p></div>',
    '#3366ff',
    '1736937000',
    'hello%20world',
    pngB64,
    Buffer.from('a reasonably long plain text string for base64').toString('base64'),
  ];
  for (const s of samples) {
    const d = detectFormat(s);
    assert.ok(d, `expected a detection for: ${s}`);
    assert.doesNotThrow(() => toolBySlug(d!.slug), `slug "${d!.slug}" from detecting "${s}" is not in the tool registry`);
  }
});
