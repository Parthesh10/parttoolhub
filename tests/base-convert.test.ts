import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, toDigits, toPrefixed, twosComplement, SAMPLE_INPUT } from '../src/lib/base-convert.ts';

function ok(input: string, fromBase?: 'auto' | 2 | 8 | 10 | 16) {
  const r = parseNumber(input, fromBase);
  assert.ok(r.ok, `expected ${input} to parse`);
  return (r as { ok: true; value: { value: bigint; base: number } }).value;
}

test('parseNumber: auto-detects base from prefix', () => {
  assert.equal(ok('0xff').value, 255n);
  assert.equal(ok('0b1010').value, 10n);
  assert.equal(ok('0o17').value, 15n);
  assert.equal(ok('42').value, 42n);
});

test('parseNumber: auto-detection is case-insensitive on the prefix and hex digits', () => {
  assert.equal(ok('0XFF').value, 255n);
  assert.equal(ok('0Xff').value, 255n);
});

test('parseNumber: explicit base ignores auto-detection, with or without its own prefix', () => {
  assert.equal(ok('ff', 16).value, 255n);
  assert.equal(ok('0xff', 16).value, 255n);
  assert.equal(ok('11', 2).value, 3n);
});

test('parseNumber: negative numbers and tolerated separators', () => {
  assert.equal(ok('-42').value, -42n);
  assert.equal(ok('1,000,000').value, 1_000_000n);
  assert.equal(ok('1_000_000').value, 1_000_000n);
});

test('parseNumber: values beyond Number.MAX_SAFE_INTEGER convert exactly', () => {
  const big = '0xFFFFFFFFFFFFFFFF'; // 2^64 - 1, far past 2^53
  assert.equal(ok(big).value, (1n << 64n) - 1n);
});

test('parseNumber: rejects invalid digits for the base, and empty input', () => {
  assert.ok(!parseNumber('').ok);
  assert.ok(!parseNumber('12', 2).ok); // '2' is not a binary digit
  assert.ok(!parseNumber('xyz').ok);
  assert.ok(!parseNumber('0x').ok); // prefix with nothing after it
});

test('toDigits / toPrefixed: round-trip a known value in every base', () => {
  const n = 3405691582n; // 0xCAFEBABE
  assert.equal(toDigits(n, 16), 'cafebabe');
  assert.equal(toPrefixed(n, 16), '0xcafebabe');
  assert.equal(toPrefixed(n, 2), '0b11001010111111101011101010111110');
  assert.equal(toPrefixed(n, 8), '0o31277535276');
  assert.equal(toDigits(n, 10), '3405691582');
});

test('toDigits: negative numbers keep a plain sign, not two’s complement', () => {
  assert.equal(toDigits(-5n, 2), '-101');
  assert.equal(toDigits(-255n, 16), '-ff');
});

test('twosComplement: matches the well-known 8-bit case', () => {
  const r = twosComplement(-5n, 8);
  assert.ok(r.ok && r.bits === 0b11111011n);
});

test('twosComplement: rejects a value outside the signed range for that width', () => {
  const r = twosComplement(200n, 8); // max signed 8-bit is 127
  assert.ok(!r.ok);
  const edge = twosComplement(-128n, 8);
  assert.ok(edge.ok && edge.bits === 0b10000000n);
});

test('the sample input parses as the well-known Java class-file magic number', () => {
  const v = ok(SAMPLE_INPUT);
  assert.equal(v.value, 3405691582n);
  assert.equal(toDigits(v.value, 16), 'cafebabe');
});
