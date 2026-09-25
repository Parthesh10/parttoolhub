import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateDiff, formatCalendarDiff } from '../src/lib/date-diff.ts';

test('a simple same-year gap breaks down to years/months/days as expected', () => {
  const r = dateDiff('2024-06-10', '2025-01-05', 'utc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.calendar, { years: 0, months: 6, days: 26, hours: 0, minutes: 0, seconds: 0 });
  assert.equal(r.value.endBeforeStart, false);
});

test('multi-year gap with a day-of-month underflow (10 June 2023 -> 5 Jan 2025)', () => {
  const r = dateDiff('2023-06-10', '2025-01-05', 'utc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.calendar, { years: 1, months: 6, days: 26, hours: 0, minutes: 0, seconds: 0 });
});

test('the Jan-31-to-Mar-1 edge case: borrowing from a short February does not go negative', () => {
  // Naive field-by-field subtraction breaks here (30 borrowed - only 29 available in Feb 2024).
  const r = dateDiff('2024-01-31', '2024-03-01', 'utc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.calendar, { years: 0, months: 1, days: 1, hours: 0, minutes: 0, seconds: 0 });
  // Every field must be non-negative — the whole point of the fix.
  for (const [k, v] of Object.entries(r.value.calendar)) assert.ok(v >= 0, `${k} went negative: ${v}`);
});

test('Jan 31 to Mar 1 in a non-leap year (Feb has only 28 days) still stays non-negative', () => {
  const r = dateDiff('2025-01-31', '2025-03-01', 'utc');
  assert.ok(r.ok);
  for (const [k, v] of Object.entries(r.value.calendar)) assert.ok(v >= 0, `${k} went negative: ${v}`);
});

test('a same-day, later time-of-day gap is pure hours/minutes/seconds', () => {
  const r = dateDiff('2025-01-15T09:00:00', '2025-01-15T14:30:15', 'utc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.calendar, { years: 0, months: 0, days: 0, hours: 5, minutes: 30, seconds: 15 });
});

test('identical instants produce an all-zero breakdown', () => {
  const r = dateDiff('2025-01-15T09:00:00', '2025-01-15T09:00:00', 'utc');
  assert.ok(r.ok);
  assert.deepEqual(r.value.calendar, { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
  assert.equal(r.value.totalSeconds, 0);
  assert.equal(r.value.weekdays, 0);
});

test('end before start is flagged but still reports a positive (absolute) difference', () => {
  const r = dateDiff('2025-06-01', '2025-01-01', 'utc');
  assert.ok(r.ok);
  assert.equal(r.value.endBeforeStart, true);
  assert.equal(r.value.calendar.months, 5);
  assert.ok(r.value.totalDays > 0);
});

test('total units are exact for a whole-day, whole-week span', () => {
  // 2025-01-01 (Wed) to 2025-01-15 (Wed) = 14 days = 2 weeks exactly.
  const r = dateDiff('2025-01-01', '2025-01-15', 'utc');
  assert.ok(r.ok);
  assert.equal(r.value.totalDays, 14);
  assert.equal(r.value.totalWeeks, 2);
  assert.equal(r.value.totalHours, 14 * 24);
  assert.equal(r.value.totalMinutes, 14 * 24 * 60);
  assert.equal(r.value.totalSeconds, 14 * 24 * 60 * 60);
});

test('weekdays: a known Monday-to-Monday week has exactly 5 weekdays', () => {
  // 2025-01-06 is a Monday, 2025-01-13 is the following Monday: Mon-Fri = 5 weekdays (Sat/Sun excluded).
  const r = dateDiff('2025-01-06', '2025-01-13', 'utc');
  assert.ok(r.ok);
  assert.equal(r.value.weekdays, 5);
});

test('weekdays: a full 7-day span always has exactly 5, regardless of which day it starts on', () => {
  for (let offset = 0; offset < 7; offset++) {
    const start = new Date(Date.UTC(2025, 0, 6 + offset));
    const end = new Date(start.getTime() + 7 * 86_400_000);
    const r = dateDiff(start.toISOString(), end.toISOString(), 'utc');
    assert.ok(r.ok);
    assert.equal(r.value.weekdays, 5, `7-day span starting ${start.toISOString()} should have 5 weekdays`);
  }
});

test('rejects empty input on either side', () => {
  assert.ok(!dateDiff('', '2025-01-01').ok);
  assert.ok(!dateDiff('2025-01-01', '   ').ok);
});

test('propagates a parse error with a Start/End prefix so the visitor knows which field is wrong', () => {
  const badStart = dateDiff('not a date', '2025-01-01');
  assert.ok(!badStart.ok && badStart.error.startsWith('Start date:'));
  const badEnd = dateDiff('2025-01-01', 'not a date');
  assert.ok(!badEnd.ok && badEnd.error.startsWith('End date:'));
});

test('an explicit offset in either input is respected regardless of the Interpret-as setting', () => {
  // Same instant, one written with a +05:30 offset, the other as plain UTC.
  const r = dateDiff('2025-01-15T14:30:00+05:30', '2025-01-15T09:00:00Z', 'utc');
  assert.ok(r.ok);
  assert.equal(r.value.totalSeconds, 0);
});

test('formatCalendarDiff skips zero units, pluralizes correctly, and joins with "and"', () => {
  assert.equal(formatCalendarDiff({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }), '0 seconds');
  assert.equal(formatCalendarDiff({ years: 0, months: 0, days: 1, hours: 0, minutes: 0, seconds: 0 }), '1 day');
  assert.equal(
    formatCalendarDiff({ years: 2, months: 0, days: 3, hours: 0, minutes: 0, seconds: 0 }),
    '2 years and 3 days',
  );
  assert.equal(
    formatCalendarDiff({ years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }),
    '1 year, 2 months, 3 days, 4 hours, 5 minutes and 6 seconds',
  );
});

test('a leap-day start (Feb 29) one non-leap year later lands on Feb 28, not March 1', () => {
  const r = dateDiff('2024-02-29', '2025-02-28', 'utc');
  assert.ok(r.ok);
  // Exactly 1 year to the (clamped) same calendar position, 0 days left over.
  assert.equal(r.value.calendar.years, 1);
  assert.equal(r.value.calendar.months, 0);
  assert.equal(r.value.calendar.days, 0);
});

test('timelineTicks: days, months or years depending on the span, on real boundaries, capped', async () => {
  const { timelineTicks } = await import('../src/lib/date-diff.ts');
  const d = (s: string) => Date.parse(s + 'T00:00:00Z');
  // 10 days: daily ticks strictly inside the span.
  assert.deepEqual(timelineTicks(d('2025-01-01'), d('2025-01-05')).map((t) => t.label), ['2 Jan', '3 Jan', '4 Jan']);
  // Jan 15 - Jun 1: first of each month, and 1 January would show the year.
  assert.deepEqual(timelineTicks(d('2025-01-15'), d('2025-06-01')).map((t) => t.label), ['Feb', 'Mar', 'Apr', 'May']);
  assert.deepEqual(timelineTicks(d('2024-11-10'), d('2025-02-10')).map((t) => t.label), ['Dec', '2025', 'Feb']);
  // Order does not matter.
  assert.deepEqual(timelineTicks(d('2025-06-01'), d('2025-01-15')).map((t) => t.label), ['Feb', 'Mar', 'Apr', 'May']);
  // 70 years: stepped years, never more than 12 ticks, all on 1 January.
  const long = timelineTicks(d('1950-03-01'), d('2020-03-01'));
  assert.ok(long.length <= 12 && long.length > 0);
  assert.ok(long.every((t) => new Date(t.ms).getUTCMonth() === 0 && new Date(t.ms).getUTCDate() === 1));
  assert.equal(long[0].label, '1960');
  // Every tick is inside the span; an empty span has none.
  for (const t of timelineTicks(d('2023-02-03'), d('2025-11-20'))) assert.ok(t.ms > d('2023-02-03') && t.ms < d('2025-11-20'));
  assert.deepEqual(timelineTicks(d('2025-01-01'), d('2025-01-01')), []);
});
