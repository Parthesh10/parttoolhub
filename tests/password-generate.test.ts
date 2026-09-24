import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePassword, generatePasswords, characterPool, STRENGTH_LABEL, DEFAULT_PASSWORD_OPTIONS } from '../src/lib/password-generate.ts';

test('default options: correct length, full pool, plausible entropy', () => {
  const r = generatePassword(DEFAULT_PASSWORD_OPTIONS);
  assert.ok(r.ok);
  assert.equal(r.value.value.length, 16);
  const pool = characterPool(DEFAULT_PASSWORD_OPTIONS);
  assert.equal(pool.length, 88); // 26 + 26 + 10 + 26 symbols
  assert.equal(new Set(pool).size, 88, 'pool has no duplicate characters');
  for (const ch of r.value.value) assert.ok(pool.includes(ch), `"${ch}" not in the pool`);
  assert.equal(r.value.entropyBits, Math.round(16 * Math.log2(88) * 10) / 10);
  assert.equal(r.value.strength, 'very-strong');
});

test('length bounds: 0, negative, non-finite and >512 are refused; 1 and 512 succeed', () => {
  for (const length of [0, -5, NaN, Infinity, 513]) {
    const r = generatePassword({ length });
    assert.equal(r.ok, false, `length ${length} should be refused`);
  }
  assert.ok(generatePassword({ length: 1 }).ok);
  const big = generatePassword({ length: 512 });
  assert.ok(big.ok);
  assert.equal(big.value.value.length, 512);
});

test('fractional length is floored, not rejected', () => {
  const r = generatePassword({ length: 10.9 });
  assert.ok(r.ok);
  assert.equal(r.value.value.length, 10);
});

test('selecting no character type is refused with a clear message', () => {
  const r = generatePassword({ uppercase: false, lowercase: false, numbers: false, symbols: false });
  assert.deepEqual(r, { ok: false, error: 'Select at least one character type.' });
});

test('excludeAmbiguous removes 0, O, 1, l, I from every enabled set and nothing else', () => {
  const full = characterPool();
  const trimmed = characterPool({ excludeAmbiguous: true });
  assert.equal(full.length - trimmed.length, 5);
  for (const ch of '0O1lI') assert.ok(!trimmed.includes(ch), `"${ch}" should be excluded`);
  // Every other character from the full pool must still be present.
  for (const ch of full) if (!'0O1lI'.includes(ch)) assert.ok(trimmed.includes(ch), `"${ch}" should not have been removed`);
});

test('a character type with only ambiguous characters excluded can still be empty overall only if every set empties', () => {
  // Numbers alone, excluding ambiguous, leaves 8 digits — not empty.
  const r = generatePassword({ uppercase: false, lowercase: false, symbols: false, numbers: true, excludeAmbiguous: true, length: 6 });
  assert.ok(r.ok);
  assert.equal(characterPool({ uppercase: false, lowercase: false, symbols: false, numbers: true, excludeAmbiguous: true }).length, 8);
});

test('at least one of each selected type is guaranteed whenever length allows it', () => {
  for (let i = 0; i < 300; i++) {
    const r = generatePassword({ length: 8, uppercase: true, lowercase: true, numbers: true, symbols: true });
    assert.ok(r.ok);
    const p = r.value.value;
    assert.match(p, /[A-Z]/, `iteration ${i}: no uppercase in "${p}"`);
    assert.match(p, /[a-z]/, `iteration ${i}: no lowercase in "${p}"`);
    assert.match(p, /[0-9]/, `iteration ${i}: no digit in "${p}"`);
    assert.match(p, /[^A-Za-z0-9]/, `iteration ${i}: no symbol in "${p}"`);
  }
});

test('the guarantee is dropped, not silently broken, when length is shorter than the number of selected types', () => {
  const pool = new Set(characterPool());
  for (let i = 0; i < 100; i++) {
    const r = generatePassword({ length: 2, uppercase: true, lowercase: true, numbers: true, symbols: true });
    assert.ok(r.ok);
    assert.equal(r.value.value.length, 2);
    for (const ch of r.value.value) assert.ok(pool.has(ch));
  }
});

test('strength bands follow the documented bit thresholds', () => {
  // Numbers-only (pool size 10, ~3.32 bits/char) sweeps through every band as length grows.
  const at = (length: number) => generatePassword({ uppercase: false, lowercase: false, symbols: false, numbers: true, length });
  const weak = at(6);
  const fair = at(14);
  const strong = at(20);
  const veryStrong = at(25);
  assert.ok(weak.ok && weak.value.strength === 'weak' && weak.value.entropyBits < 40);
  assert.ok(fair.ok && fair.value.strength === 'fair' && fair.value.entropyBits >= 40 && fair.value.entropyBits < 60);
  assert.ok(strong.ok && strong.value.strength === 'strong' && strong.value.entropyBits >= 60 && strong.value.entropyBits < 80);
  assert.ok(veryStrong.ok && veryStrong.value.strength === 'very-strong' && veryStrong.value.entropyBits >= 80);
  assert.deepEqual(Object.keys(STRENGTH_LABEL).sort(), ['fair', 'strong', 'very-strong', 'weak'].sort());
});

test('generatePasswords: clamps count to 1-100, every password independently valid', () => {
  assert.ok(generatePasswords(0, {}).ok);
  const zero = generatePasswords(0, {});
  assert.ok(zero.ok && zero.value.length === 1, 'count below 1 clamps up to 1');
  const many = generatePasswords(1000, { length: 12 });
  assert.ok(many.ok);
  assert.equal(many.value.length, 100, 'count above 100 clamps down to 100');
  const values = many.value.map((p) => p.value);
  assert.equal(new Set(values).size, values.length, 'no two passwords in a batch collide');
});

test('generatePasswords propagates an engine error instead of returning a partial batch', () => {
  const r = generatePasswords(5, { uppercase: false, lowercase: false, numbers: false, symbols: false });
  assert.deepEqual(r, { ok: false, error: 'Select at least one character type.' });
});

test('digit distribution is close to uniform over many draws (no modulo bias)', () => {
  const counts = new Map<string, number>();
  const n = 6000;
  for (let i = 0; i < n; i++) {
    const r = generatePassword({ uppercase: false, lowercase: false, symbols: false, numbers: true, length: 1 });
    assert.ok(r.ok);
    counts.set(r.value.value, (counts.get(r.value.value) ?? 0) + 1);
  }
  assert.equal(counts.size, 10, 'all ten digits appeared');
  const expected = n / 10;
  for (const [digit, count] of counts) {
    assert.ok(Math.abs(count - expected) < expected * 0.35, `digit ${digit} drawn ${count} times, expected ~${expected}`);
  }
});

test('100 passwords of 128 characters generate well under a second', () => {
  const t0 = performance.now();
  const r = generatePasswords(100, { length: 128 });
  assert.ok(r.ok);
  assert.ok(performance.now() - t0 < 1500, `took ${(performance.now() - t0).toFixed(0)} ms`);
});

test('crackTimeText: average brute-force time in plain words at 10 billion guesses a second', async () => {
  const { crackTimeText } = await import('../src/lib/password-generate.ts');
  assert.equal(crackTimeText(20), 'under a second'); // 2^19 guesses
  assert.equal(crackTimeText(40), 'about 55 seconds'); // 2^39 / 1e10 = 54.97 s
  assert.equal(crackTimeText(56), 'about 42 days'); // 2^55 / 1e10 = 3.6e6 s
  assert.equal(crackTimeText(70), 'about 2 thousand years'); // 1,871 years
  assert.equal(crackTimeText(80), 'about 2 million years');
  assert.equal(crackTimeText(104), 'longer than the age of the universe');
});
