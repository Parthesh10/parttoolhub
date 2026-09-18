/**
 * Data size conversion — the one thing worth getting right here is decimal
 * (1000-based, SI: kB/MB/GB…) vs binary (1024-based: KiB/MiB/GiB…), the
 * exact confusion behind "why does my 1 TB drive show 931 GB in Windows".
 * Pure, no DOM.
 */

export const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
export type SizeUnit = (typeof UNITS)[number];
export type SizeBase = 'decimal' | 'binary';

/** 1 for bytes, then 1000^n (decimal) or 1024^n (binary) for each step up. */
function unitFactor(unit: SizeUnit, base: SizeBase): number {
  const step = base === 'decimal' ? 1000 : 1024;
  const power = UNITS.indexOf(unit);
  return step ** power;
}

/** The binary unit's real name (KiB, not KB) — decimal keeps the familiar KB/MB/GB names. */
export function unitLabel(unit: SizeUnit, base: SizeBase): string {
  if (unit === 'B' || base === 'decimal') return unit;
  return `${unit[0]}i${unit[1]}`;
}

export interface SizeValue {
  /** The exact value in bytes (may not be a whole number if the input wasn't, e.g. 1.5 KB). */
  bytes: number;
  bits: number;
  /** The input value converted into every unit at the same base, keyed by the plain unit ('KB', not 'KiB'). */
  values: Record<SizeUnit, number>;
}

export type SizeResult = { ok: true; value: SizeValue } | { ok: false; error: string };

export function convertSize(amount: number, unit: SizeUnit, base: SizeBase): SizeResult {
  if (!Number.isFinite(amount)) return { ok: false, error: 'Enter a number.' };
  if (amount < 0) return { ok: false, error: 'Enter a size of zero or more; negative sizes don’t mean anything here.' };

  const bytes = amount * unitFactor(unit, base);
  // Checked on the actual byte count, not a worst-case guess from `amount` alone — a guess based
  // on the largest possible unit (PB) would wrongly reject even a modest amount in a smaller unit
  // (e.g. 1024 MB), since it's nowhere near PB-scale in bytes.
  if (bytes > Number.MAX_SAFE_INTEGER) return { ok: false, error: 'That number is too large to convert precisely.' };
  const values = Object.fromEntries(UNITS.map((u) => [u, bytes / unitFactor(u, base)])) as Record<SizeUnit, number>;

  return { ok: true, value: { bytes, bits: bytes * 8, values } };
}

/**
 * Format a converted value for display: up to `sig` significant digits, trailing zeros trimmed,
 * plain (non-exponential) notation for anything in a realistic range. Whole numbers show with no
 * decimal point at all, since "1,048,576 B" reads better than "1,048,576.000000 B".
 */
export function formatSize(n: number, sig = 6): string {
  if (n === 0) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString();
  // toPrecision handles small numbers (many leading zeros after the point) correctly, where a
  // fixed decimal-places count would round a tiny value straight down to 0 and lose it entirely.
  const precise = Number(n.toPrecision(sig));
  if (Math.abs(precise) >= 1e-6 && Math.abs(precise) < 1e15) {
    // toPrecision can still choose exponential notation for very small numbers within this
    // range's edge; toLocaleString never does, and also adds thousands separators.
    return precise.toLocaleString(undefined, { maximumFractionDigits: 20 });
  }
  // Trim trailing zeros toExponential always pads to a fixed decimal count (1.00000e-12 rather
  // than 1e-12) — a plain regex is simpler here than fighting Intl.NumberFormat's own exponential
  // notation flags for a case this rare (only reached by inputs far outside any real data size).
  return precise.toExponential(Math.max(0, sig - 1)).replace(/\.?0+e/, 'e');
}
