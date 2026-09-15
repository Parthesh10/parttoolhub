/**
 * Difference between two dates/date-times: a calendar breakdown (years,
 * months, days, hours, minutes, seconds — accounting for real month
 * lengths, not a fixed 30/31 average) plus totals in each single unit and
 * a weekday-only count. Pure, no DOM.
 *
 * Reuses timestamp.ts's `dateToTimestamp` for parsing both inputs, so this
 * tool inherits the exact same "Interpret as UTC/local" handling — and the
 * exact same fix for the ECMA-262 quirk where a date-only string parses as
 * UTC midnight but a date-time string with no offset parses in local time —
 * rather than a second, possibly-inconsistent implementation of the same
 * parsing problem.
 */
import { dateToTimestamp, type ZoneInterpretation } from './timestamp';
export type { ZoneInterpretation };

export interface CalendarDiff {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface DateDiffValue {
  /** True when the end date is earlier than the start date — the totals below are still positive
   *  (the absolute gap), this just says which direction it runs. */
  endBeforeStart: boolean;
  calendar: CalendarDiff;
  totalWeeks: number;
  totalDays: number;
  totalHours: number;
  totalMinutes: number;
  totalSeconds: number;
  /** Mon-Fri days in the span, both ends inclusive of whichever whole days they fall on. */
  weekdays: number;
  startISO: string;
  endISO: string;
}

export type DateDiffResult = { ok: true; value: DateDiffValue } | { ok: false; error: string };

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** `earlier` advanced by `months` whole months, clamping the day-of-month to that month's real
 *  length (Jan 31 + 1 month lands on Feb 28/29, never rolling over into March the way plain
 *  Date arithmetic would). */
function addMonthsClamped(date: Date, months: number): Date {
  const totalM = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(totalM / 12);
  const month = ((totalM % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

/**
 * Calendar difference as "the largest whole years+months that fit, then whatever's left over as
 * days/hours/minutes/seconds" — the convention most date-difference calculators use, and the one
 * that avoids the ambiguity a naive field-by-field subtraction hits (Jan 31 to Mar 1: which
 * month's length do you borrow from, January's 31 days or February's 28/29?). Requires
 * `earlier <= later`.
 */
function calendarBreakdown(earlier: Date, later: Date): CalendarDiff {
  let totalMonths = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + (later.getUTCMonth() - earlier.getUTCMonth());
  let anchor = addMonthsClamped(earlier, totalMonths);
  if (anchor.getTime() > later.getTime()) {
    totalMonths--;
    anchor = addMonthsClamped(earlier, totalMonths);
  }
  const years = Math.trunc(totalMonths / 12);
  const months = totalMonths - years * 12;

  let remainingMs = later.getTime() - anchor.getTime();
  const days = Math.floor(remainingMs / 86_400_000); remainingMs -= days * 86_400_000;
  const hours = Math.floor(remainingMs / 3_600_000); remainingMs -= hours * 3_600_000;
  const minutes = Math.floor(remainingMs / 60_000); remainingMs -= minutes * 60_000;
  const seconds = Math.floor(remainingMs / 1000);
  return { years, months, days, hours, minutes, seconds };
}

/** Whole calendar days (UTC) strictly between the two instants that fall on a Monday-Friday,
 *  counting the start day but not the end day — the usual "how many workdays until X" framing. */
function countWeekdays(earlierMs: number, laterMs: number): number {
  const dayMs = 86_400_000;
  const startDay = Math.floor(earlierMs / dayMs);
  const endDay = Math.floor(laterMs / dayMs);
  let count = 0;
  for (let d = startDay; d < endDay; d++) {
    // 1970-01-01 (day 0) was a Thursday: (day + 4) % 7 gives 0=Sunday.
    const weekday = ((d % 7) + 4 + 7) % 7;
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

export function dateDiff(startInput: string, endInput: string, interpret: ZoneInterpretation = 'utc', now: number = Date.now()): DateDiffResult {
  if (!startInput.trim() || !endInput.trim()) return { ok: false, error: 'Enter both a start and an end date.' };

  const start = dateToTimestamp(startInput, interpret, now);
  if (!start.ok) return { ok: false, error: `Start date: ${start.error}` };
  const end = dateToTimestamp(endInput, interpret, now);
  if (!end.ok) return { ok: false, error: `End date: ${end.error}` };

  const startMs = start.value.epochMilliseconds;
  const endMs = end.value.epochMilliseconds;
  const endBeforeStart = endMs < startMs;
  const [earlierMs, laterMs] = endBeforeStart ? [endMs, startMs] : [startMs, endMs];
  const totalMs = laterMs - earlierMs;

  const totalSeconds = Math.floor(totalMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const totalWeeks = Math.floor(totalDays / 7);

  return {
    ok: true,
    value: {
      endBeforeStart,
      calendar: calendarBreakdown(new Date(earlierMs), new Date(laterMs)),
      totalWeeks,
      totalDays,
      totalHours,
      totalMinutes,
      totalSeconds,
      weekdays: countWeekdays(earlierMs, laterMs),
      startISO: start.value.iso,
      endISO: end.value.iso,
    },
  };
}

/** A short, human sentence for the calendar breakdown, skipping zero units — e.g. "2 years, 3
 *  months and 1 day" or "0 seconds" when the two instants are identical. */
export function formatCalendarDiff(c: CalendarDiff): string {
  const units: [number, string][] = [
    [c.years, 'year'], [c.months, 'month'], [c.days, 'day'],
    [c.hours, 'hour'], [c.minutes, 'minute'], [c.seconds, 'second'],
  ];
  const parts = units.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
  if (!parts.length) return '0 seconds';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
