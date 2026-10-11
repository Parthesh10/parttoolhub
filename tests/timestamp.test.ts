import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timestampToDate, dateToTimestamp, relativeTime, toOffsetIso, toLocalIso, nowDateInput } from '../src/lib/timestamp.ts';

const NOW = Date.UTC(2025, 0, 15, 12, 0, 0); // fixed "now" for deterministic relative-time tests

test('timestampToDate: auto-detects seconds vs milliseconds by digit count', () => {
  const secs = timestampToDate('1736937000', 'auto', NOW); // 10 digits -> seconds
  assert.ok(secs.ok && secs.value.iso === '2025-01-15T10:30:00.000Z');
  const ms = timestampToDate('1736937000000', 'auto', NOW); // 13 digits -> milliseconds
  assert.ok(ms.ok && ms.value.iso === '2025-01-15T10:30:00.000Z');
});

test('timestampToDate: explicit unit overrides auto-detection', () => {
  const r = timestampToDate('1736937000', 's', NOW);
  assert.ok(r.ok && r.value.epochMilliseconds === 1736937000000);
  const asMs = timestampToDate('1736937000', 'ms', NOW);
  assert.ok(asMs.ok && asMs.value.epochMilliseconds === 1736937000);
});

test('timestampToDate: negative (pre-1970) timestamps work', () => {
  const r = timestampToDate('-3600', 's', NOW);
  assert.ok(r.ok && r.value.iso === '1969-12-31T23:00:00.000Z');
});

test('timestampToDate: rejects non-numeric input and empty input', () => {
  assert.ok(!timestampToDate('').ok);
  assert.ok(!timestampToDate('   ').ok);
  assert.ok(!timestampToDate('1736937000s').ok);
  assert.ok(!timestampToDate('Jan 15 2025').ok);
  assert.ok(!timestampToDate('1,736,937,000').ok);
});

test('timestampToDate: astronomically large numbers are rejected, not silently wrapped', () => {
  const r = timestampToDate('9'.repeat(30), 'ms', NOW);
  assert.ok(!r.ok);
});

test('dateToTimestamp: date-only is always UTC midnight, regardless of "Interpret as"', () => {
  const utc = dateToTimestamp('2025-01-15', 'utc', NOW);
  const local = dateToTimestamp('2025-01-15', 'local', NOW);
  assert.ok(utc.ok && utc.value.iso === '2025-01-15T00:00:00.000Z');
  // In this test runner's local zone the two may coincide (UTC+0) or differ —
  // what matters is that "local" is genuinely evaluated in the local zone.
  assert.ok(local.ok);
  const offsetMinutes = new Date(2025, 0, 15).getTimezoneOffset();
  const expectedLocalMs = Date.UTC(2025, 0, 15, 0, 0, 0) + offsetMinutes * 60_000;
  assert.ok(local.ok && local.value.epochMilliseconds === expectedLocalMs);
});

test('dateToTimestamp: date-time without an offset respects "Interpret as" (the quirk this tool avoids)', () => {
  const utc = dateToTimestamp('2025-01-15T10:30:00', 'utc', NOW);
  assert.ok(utc.ok && utc.value.iso === '2025-01-15T10:30:00.000Z');
  const local = dateToTimestamp('2025-01-15T10:30:00', 'local', NOW);
  const offsetMinutes = new Date(2025, 0, 15, 10, 30, 0).getTimezoneOffset();
  const expectedLocalMs = Date.UTC(2025, 0, 15, 10, 30, 0) + offsetMinutes * 60_000;
  assert.ok(local.ok && local.value.epochMilliseconds === expectedLocalMs);
});

test('dateToTimestamp: an explicit offset always wins over "Interpret as"', () => {
  const withZ = dateToTimestamp('2025-01-15T10:30:00Z', 'local', NOW);
  assert.ok(withZ.ok && withZ.value.iso === '2025-01-15T10:30:00.000Z');
  const withOffset = dateToTimestamp('2025-01-15T10:30:00+05:30', 'utc', NOW);
  assert.ok(withOffset.ok && withOffset.value.iso === '2025-01-15T05:00:00.000Z');
});

test('dateToTimestamp: fractional seconds parsed correctly', () => {
  const r = dateToTimestamp('2025-01-15T10:30:00.5', 'utc', NOW);
  assert.ok(r.ok && r.value.iso === '2025-01-15T10:30:00.500Z');
});

test('dateToTimestamp: non-ISO formats fall back to the platform parser', () => {
  const r = dateToTimestamp('January 15, 2025 10:30:00', 'utc', NOW);
  assert.ok(r.ok); // exact offset depends on the runner's local zone; just must parse
});

test('dateToTimestamp: rejects unparseable text', () => {
  assert.ok(!dateToTimestamp('').ok);
  assert.ok(!dateToTimestamp('not a date').ok);
});

test('dateToTimestamp: out-of-range calendar values roll over rather than error', () => {
  // Matches native `Date` behaviour rather than fighting it: month 13 and day
  // 40 are not rejected, they overflow into the following months/year.
  const r = dateToTimestamp('2025-13-40', 'utc', NOW);
  assert.ok(r.ok && r.value.iso === '2026-02-09T00:00:00.000Z');
});

test('round trip: dateToTimestamp -> timestampToDate recovers the same instant', () => {
  const d = dateToTimestamp('2025-06-01T00:00:00Z', 'utc', NOW);
  assert.ok(d.ok);
  const back = timestampToDate(String((d as { ok: true; value: { epochSeconds: number } }).value.epochSeconds), 's', NOW);
  assert.ok(back.ok && back.value.iso === '2025-06-01T00:00:00.000Z');
});

test('relativeTime phrasing around the "now" boundary', () => {
  assert.equal(relativeTime(new Date(NOW), NOW), 'in 1 second'); // diff of exactly 0 rounds to the "in" side
  assert.equal(relativeTime(new Date(NOW + 2 * 3600e3), NOW), 'in 2 hours');
  assert.equal(relativeTime(new Date(NOW - 3 * 86400e3), NOW), '3 days ago');
});

test('toOffsetIso: writes the wall-clock time of a fixed offset, ending in that offset', () => {
  const d = new Date(1736937000000); // 2025-01-15T10:30:00Z
  assert.equal(toOffsetIso(d, 330), '2025-01-15T16:00:00.000+05:30'); // India
  assert.equal(toOffsetIso(d, -300), '2025-01-15T05:30:00.000-05:00'); // New York in winter
  assert.equal(toOffsetIso(d, 0), '2025-01-15T10:30:00.000+00:00');
  assert.equal(toOffsetIso(d, 345, false), '2025-01-15T16:15:00+05:45'); // Nepal, no milliseconds
  assert.equal(toOffsetIso(new Date(Date.UTC(2025, 0, 15, 20, 0)), 330), '2025-01-16T01:30:00.000+05:30'); // crosses midnight
  assert.equal(toOffsetIso(d, 353 + 1 / 3), '2025-01-15T16:23:20.000+05:53:20'); // historical LMT offset with seconds
  const ancient = new Date(Date.UTC(-1, 0, 1));
  assert.equal(toOffsetIso(ancient, 0), ancient.toISOString().replace('Z', '+00:00')); // same signed 6-digit year form
});

test('toOffsetIso: always the same instant, for any offset and any year', () => {
  const instants = [0, -1, 1736937000000, 1736937000500, Date.UTC(1900, 5, 1), Date.UTC(9999, 11, 31, 23, 59), Date.UTC(-500, 0, 1), Date.UTC(12000, 0, 1)];
  for (const ms of instants) {
    for (let off = -720; off <= 840; off += 15) {
      assert.equal(new Date(toOffsetIso(new Date(ms), off)).getTime(), ms, `${ms} at ${off}`);
    }
  }
});

test('localIso: the result row in the local zone is the same instant as iso', () => {
  for (const input of ['1736937000', '-3600', '1736937000500', '0']) {
    const r = timestampToDate(input, 'auto', NOW);
    assert.ok(r.ok);
    if (!r.ok) continue;
    assert.equal(new Date(r.value.localIso).getTime(), r.value.epochMilliseconds);
    assert.equal(r.value.localIso, toLocalIso(new Date(r.value.epochMilliseconds)));
  }
});

test('regression: Convert now on the date side gives the current Unix time under either "Interpret as" (India)', () => {
  // The bug: the input was toISOString() minus its Z (UTC fields, no offset), so under
  // "Local time" an IST browser got a timestamp 5 h 30 min early. Run it in a real IST zone.
  const before = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    const now = new Date(Date.UTC(2026, 9, 11, 11, 19, 58, 400));
    const filled = nowDateInput(now);
    assert.equal(filled, '2026-10-11T16:49:58+05:30'); // reads as the local clock, offset written out
    for (const interpret of ['utc', 'local'] as const) {
      const r = dateToTimestamp(filled, interpret, now.getTime());
      assert.ok(r.ok && r.value.epochSeconds === Math.floor(now.getTime() / 1000), interpret);
    }
    const r = timestampToDate('1736937000', 'auto', NOW);
    assert.ok(r.ok && r.value.localIso === '2025-01-15T16:00:00.000+05:30');
    assert.ok(r.ok && /4:00:00/.test(r.value.local));
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
