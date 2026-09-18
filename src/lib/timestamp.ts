/**
 * Unix timestamp ↔ human date/time conversion. Pure, no DOM.
 *
 * The one JS date-parsing quirk this module exists to route around: per
 * ECMA-262, a date-ONLY ISO string ("2025-01-15") with no offset parses as
 * UTC midnight, but a date-TIME ISO string ("2025-01-15T10:30:00") with no
 * offset parses in the *browser's local* zone — same missing-offset shape,
 * opposite default. Rather than hand that inconsistency to the visitor,
 * `dateToTimestamp` parses the numeric fields itself and applies whichever
 * zone the "Interpret as" option says, for both shapes alike. An explicit
 * offset (`Z` or `+05:30`) always wins over the option, since it is
 * unambiguous already.
 */

export type Result = { ok: true; output: string } | { ok: false; error: string };

/**
 * The same instant in both directions' sample inputs, so the page's worked
 * example, the "Load sample" button and the two directions never drift apart:
 * 2025-01-15T10:30:00Z.
 */
export const SAMPLE_EPOCH_SECONDS = '1736937000';
export const SAMPLE_DATE_TIME = '2025-01-15T10:30:00';

export type TimestampUnit = 'auto' | 's' | 'ms';
export type ZoneInterpretation = 'utc' | 'local';

export interface TimestampBreakdown {
  epochSeconds: number;
  epochMilliseconds: number;
  /** Full ISO 8601, always UTC (the "Z" form). */
  iso: string;
  /** RFC 7231-style UTC string, e.g. "Wed, 15 Jan 2025 10:30:00 GMT". */
  utc: string;
  /** Formatted in whichever zone this JS engine resolves as local. */
  local: string;
  /** "in 3 days" / "2 hours ago" phrasing relative to `now`. */
  relative: string;
  /** IANA zone name behind `local`, e.g. "Asia/Kolkata" — so the UI can label it. */
  timeZone: string;
}

export type BreakdownResult = { ok: true; value: TimestampBreakdown } | { ok: false; error: string };

// Date's own representable range is ±100,000,000 days from the epoch.
const MAX_SAFE_MS = 8_640_000_000_000_000;

/** "in 2 hours" / "3 days ago" style phrasing, duplicated from jwt-decode.ts by design (no shared JS across tools). */
export function relativeTime(date: Date, now: number = Date.now()): string {
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const units: [string, number][] = [
    ['year', 365 * 86400e3],
    ['month', 30 * 86400e3],
    ['day', 86400e3],
    ['hour', 3600e3],
    ['minute', 60e3],
    ['second', 1e3],
  ];
  for (const [name, ms] of units) {
    if (abs >= ms || name === 'second') {
      const n = Math.max(1, Math.round(abs / ms));
      const label = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff >= 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return 'now';
}

function breakdown(date: Date, now: number): BreakdownResult {
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'That does not resolve to a valid date.' };
  if (Math.abs(date.getTime()) > MAX_SAFE_MS) return { ok: false, error: 'That is outside the range JavaScript dates can represent (year ±273,790).' };
  return {
    ok: true,
    value: {
      epochSeconds: Math.floor(date.getTime() / 1000),
      epochMilliseconds: date.getTime(),
      iso: date.toISOString(),
      utc: date.toUTCString(),
      local: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(date),
      relative: relativeTime(date, now),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

/** Digit-count heuristic for `unit: 'auto'`: 10 digits ≈ seconds (until year 2286), 13 ≈ milliseconds. */
function detectUnit(n: number): 's' | 'ms' {
  return Math.abs(n) < 1e11 ? 's' : 'ms';
}

export function timestampToDate(input: string, unit: TimestampUnit = 'auto', now: number = Date.now()): BreakdownResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a Unix timestamp.' };
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: 'A Unix timestamp is a plain integer (optionally signed), with no letters, colons, commas or units.' };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, error: 'That number is too large to represent.' };
  const resolvedUnit = unit === 'auto' ? detectUnit(n) : unit;
  const ms = resolvedUnit === 's' ? n * 1000 : n;
  return breakdown(new Date(ms), now);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function dateToTimestamp(input: string, interpret: ZoneInterpretation = 'utc', now: number = Date.now()): BreakdownResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a date and time.' };

  const m = trimmed.match(DATE_RE);
  if (m) {
    const [, y, mo, d, h, mi, s, frac, offset] = m;
    if (offset) {
      // An explicit offset is unambiguous — hand the original string straight
      // to the platform parser rather than reimplementing offset arithmetic.
      return breakdown(new Date(trimmed), now);
    }
    const ms = frac ? Number((frac + '000').slice(0, 3)) : 0;
    const parts: [number, number, number, number, number, number, number] = [
      Number(y), Number(mo) - 1, Number(d), Number(h ?? '0'), Number(mi ?? '0'), Number(s ?? '0'), ms,
    ];
    const date = interpret === 'utc' ? new Date(Date.UTC(...parts)) : new Date(...parts);
    return breakdown(date, now);
  }

  // Not a recognised date/date-time shape: fall back to the platform parser,
  // which accepts many other formats (e.g. "Jan 15, 2025", RFC 2822) — always
  // in local time for these, per the language spec.
  const fallback = new Date(trimmed);
  if (Number.isNaN(fallback.getTime())) {
    return { ok: false, error: 'Could not parse that as a date. Try ISO 8601, e.g. 2025-01-15 or 2025-01-15T10:30:00.' };
  }
  return breakdown(fallback, now);
}
