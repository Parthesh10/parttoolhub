import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSize, formatSize, unitLabel, UNITS } from '../src/lib/data-size.ts';

test('decimal base: 1 TB is exactly 1000 GB, 1,000,000 MB, and 10^12 bytes', () => {
  const r = convertSize(1, 'TB', 'decimal');
  assert.ok(r.ok);
  assert.equal(r.value.bytes, 1_000_000_000_000);
  assert.equal(r.value.values.GB, 1000);
  assert.equal(r.value.values.MB, 1_000_000);
  assert.equal(r.value.values.B, 1_000_000_000_000);
});

test('binary base: 1 TiB (entered as TB) is exactly 1024 GiB and 2^40 bytes', () => {
  const r = convertSize(1, 'TB', 'binary');
  assert.ok(r.ok);
  assert.equal(r.value.bytes, 2 ** 40);
  assert.equal(r.value.values.GB, 1024);
  assert.equal(r.value.values.MB, 1024 * 1024);
});

test('the real-world confusion this tool exists for: 1024 MB (binary) is exactly 1 GB, not ~0.93', () => {
  // This is the exact bug the first draft of the engine had: a bad range check rejected this
  // entirely for any unit smaller than petabytes.
  const r = convertSize(1024, 'MB', 'binary');
  assert.ok(r.ok);
  assert.equal(r.value.values.GB, 1);
});

test('decimal and binary disagree past the first unit, by design', () => {
  const decimal = convertSize(1, 'GB', 'decimal');
  const binary = convertSize(1, 'GB', 'binary');
  assert.ok(decimal.ok && binary.ok);
  assert.notEqual(decimal.value.bytes, binary.value.bytes);
  assert.equal(decimal.value.bytes, 1_000_000_000);
  assert.equal(binary.value.bytes, 1_073_741_824);
});

test('bits are always exactly 8x bytes, regardless of base', () => {
  for (const base of ['decimal', 'binary'] as const) {
    const r = convertSize(5, 'MB', base);
    assert.ok(r.ok);
    assert.equal(r.value.bits, r.value.bytes * 8);
  }
});

test('every unit converts back to the same byte total (round trip through all six units)', () => {
  const base = convertSize(2.5, 'GB', 'decimal');
  assert.ok(base.ok);
  for (const unit of UNITS) {
    const fromThisUnit = convertSize(base.value.values[unit], unit, 'decimal');
    assert.ok(fromThisUnit.ok);
    assert.ok(Math.abs(fromThisUnit.value.bytes - base.value.bytes) < 1e-6, `round-trip through ${unit} drifted`);
  }
});

test('zero is valid and converts to zero in every unit', () => {
  const r = convertSize(0, 'GB', 'decimal');
  assert.ok(r.ok);
  assert.equal(r.value.bytes, 0);
  for (const unit of UNITS) assert.equal(r.value.values[unit], 0);
});

test('rejects negative amounts, non-finite amounts, and amounts too large to convert precisely', () => {
  assert.ok(!convertSize(-1, 'MB', 'decimal').ok);
  assert.ok(!convertSize(NaN, 'MB', 'decimal').ok);
  assert.ok(!convertSize(Infinity, 'MB', 'decimal').ok);
  assert.ok(!convertSize(1e14, 'PB', 'decimal').ok);
});

test('the size-limit check is based on the actual byte count for the chosen unit, not a worst-case guess', () => {
  // A large amount in a small unit (MB) must still succeed even though the same numeric amount
  // in the largest unit (PB) would be astronomically large — the check must use real bytes.
  assert.ok(convertSize(1_000_000, 'MB', 'decimal').ok);
  assert.ok(!convertSize(1_000_000, 'PB', 'decimal').ok);
});

test('unitLabel: decimal keeps the familiar KB/MB/GB names; binary uses the real KiB/MiB/GiB names', () => {
  assert.equal(unitLabel('KB', 'decimal'), 'KB');
  assert.equal(unitLabel('GB', 'decimal'), 'GB');
  assert.equal(unitLabel('KB', 'binary'), 'KiB');
  assert.equal(unitLabel('GB', 'binary'), 'GiB');
  assert.equal(unitLabel('B', 'binary'), 'B', 'a single byte has no decimal/binary distinction');
});

test('formatSize: whole numbers show with no decimal point; large integers keep thousands separators', () => {
  assert.equal(formatSize(0), '0');
  assert.equal(formatSize(1024), '1,024');
  assert.equal(formatSize(1_099_511_627_776), '1,099,511,627,776');
});

test('formatSize: fractional values round to a sensible number of significant digits', () => {
  assert.equal(formatSize(1.5), '1.5');
  assert.equal(formatSize(931.3228378295898), '931.323');
  assert.equal(formatSize(1_234_567.891), '1,234,570');
});

test('formatSize: very small numbers keep their significant digits instead of rounding to 0', () => {
  assert.equal(formatSize(0.0009765625), '0.000976563');
  assert.notEqual(formatSize(0.0000001234), '0');
});

test('formatSize: numbers far outside any real data size fall back to trimmed exponential notation', () => {
  assert.equal(formatSize(1e-12), '1e-12');
});

test('bothBases and humanUnit: the same bytes at 1000 and 1024, and the unit to read it in', async () => {
  const { bothBases, humanUnit } = await import('../src/lib/data-size.ts');
  const b = bothBases(1_500_000_000);
  assert.equal(b.decimal.GB, 1.5);
  assert.ok(Math.abs(b.binary.GB - 1.396983862) < 1e-9);
  assert.equal(humanUnit(b.decimal), 'GB');
  assert.equal(humanUnit(b.binary), 'GB');
  // 1000 bytes is 1 KB but still under 1 KiB, so the two columns disagree on the unit.
  const k = bothBases(1000);
  assert.equal(humanUnit(k.decimal), 'KB');
  assert.equal(humanUnit(k.binary), 'B');
  assert.equal(humanUnit(bothBases(0).decimal), 'B');
});
