/**
 * Integer base conversion (binary/octal/decimal/hexadecimal), using BigInt
 * throughout so values beyond Number.MAX_SAFE_INTEGER (2^53) still convert
 * exactly — unlike Number-based conversion, which silently loses precision
 * past that point. Pure, no DOM.
 */

export type Base = 2 | 8 | 10 | 16;
export type FromBase = 'auto' | Base;
export type BitWidth = 8 | 16 | 32 | 64;

const DIGIT_RE: Record<Base, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
  16: /^[0-9a-fA-F]+$/,
};

const PREFIX: Record<Base, string> = { 2: '0b', 8: '0o', 10: '', 16: '0x' };
const BASE_NAME: Record<Base, string> = { 2: 'binary (0-1)', 8: 'octal (0-7)', 10: 'decimal (0-9)', 16: 'hexadecimal (0-9, a-f)' };

export interface ParsedNumber {
  value: bigint;
  /** The base actually used, after auto-detection. */
  base: Base;
}

export type Result = { ok: true; value: ParsedNumber } | { ok: false; error: string };

export function parseNumber(input: string, fromBase: FromBase = 'auto'): Result {
  let s = input.trim().replace(/[,_\s]/g, ''); // tolerate thousands separators and digit-group underscores
  let neg = false;
  if (s[0] === '-' || s[0] === '+') {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  if (!s) return { ok: false, error: 'Enter a number.' };

  let base: Base;
  if (fromBase === 'auto') {
    const low = s.toLowerCase();
    if (low.startsWith('0x')) { base = 16; s = s.slice(2); }
    else if (low.startsWith('0b')) { base = 2; s = s.slice(2); }
    else if (low.startsWith('0o')) { base = 8; s = s.slice(2); }
    else base = 10;
  } else {
    base = fromBase;
    const low = s.toLowerCase();
    if (PREFIX[base] && low.startsWith(PREFIX[base])) s = s.slice(PREFIX[base].length);
  }

  if (!s) return { ok: false, error: `Enter the ${BASE_NAME[base]} digits.` };
  if (!DIGIT_RE[base].test(s)) return { ok: false, error: `That is not a valid ${BASE_NAME[base]} number.` };

  let acc = 0n;
  const b = BigInt(base);
  for (const ch of s) acc = acc * b + BigInt(parseInt(ch, 16));
  return { ok: true, value: { value: acc * (neg ? -1n : 1n), base } };
}

/** Bare digits, no prefix, no leading zeros (beyond a single "0"). */
export function toDigits(value: bigint, base: Base): string {
  const neg = value < 0n;
  const digits = (neg ? -value : value).toString(base);
  return (neg ? '-' : '') + digits;
}

/** Digits with the base's conventional code-literal prefix (0x/0b/0o), decimal has none. */
export function toPrefixed(value: bigint, base: Base): string {
  const neg = value < 0n;
  const digits = (neg ? -value : value).toString(base);
  return (neg ? '-' : '') + PREFIX[base] + digits;
}

export type TwosComplementResult = { ok: true; bits: bigint } | { ok: false; error: string };

/** The N-bit two's complement bit pattern for a signed integer, as an unsigned bigint. */
export function twosComplement(value: bigint, width: BitWidth): TwosComplementResult {
  const w = BigInt(width);
  const range = 1n << w;
  const half = range / 2n;
  if (value >= half || value < -half) {
    return { ok: false, error: `${value} does not fit in a signed ${width}-bit integer (range ${-half} to ${half - 1n}).` };
  }
  return { ok: true, bits: value < 0n ? range + value : value };
}

/** 0xCAFEBABE — the Java .class file magic number, a recognisable worked example. */
export const SAMPLE_INPUT = '0xCAFEBABE';

export interface Nibble {
  hex: string;
  bits: string;
}

/**
 * A non-negative bit pattern split into 4-bit groups, most significant first, each with its hex
 * digit, for the Number Base Converter's bit map (hex digit above its nibble). Padded to at least
 * `minBits` (and always to a whole nibble); 0 is one nibble.
 */
export function nibbles(bits: bigint, minBits = 4): Nibble[] {
  if (bits < 0n) throw new RangeError('nibbles: pass the two\'s complement bit pattern for negatives');
  const bin = bits.toString(2);
  const width = Math.max(minBits, Math.ceil(bin.length / 4) * 4);
  const padded = bin.padStart(width, '0');
  const out: Nibble[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const b = padded.slice(i, i + 4);
    out.push({ hex: parseInt(b, 2).toString(16).toUpperCase(), bits: b });
  }
  return out;
}

export interface WidthReading {
  width: BitWidth;
  /** The value read as an unsigned integer of this width, or null when the bit pattern doesn't fit. */
  unsigned: bigint | null;
  /** The same bits read as a signed (two's complement) integer, or null when it doesn't fit. */
  signed: bigint | null;
}

/**
 * How a value lands in 8/16/32/64-bit storage: a non-negative value that fits unsigned is also
 * shown as the signed number those same bits mean (0xCAFEBABE is -889275714 as int32); a negative
 * value that fits signed is shown as the unsigned number of its two's complement bits.
 */
export function widthReadings(value: bigint): WidthReading[] {
  return ([8, 16, 32, 64] as BitWidth[]).map((width) => {
    const w = BigInt(width);
    const mod = 1n << w;
    const half = 1n << (w - 1n);
    if (value >= 0n) {
      if (value >= mod) return { width, unsigned: null, signed: null };
      return { width, unsigned: value, signed: value >= half ? value - mod : value };
    }
    if (value < -half) return { width, unsigned: null, signed: null };
    return { width, unsigned: value + mod, signed: value };
  });
}
