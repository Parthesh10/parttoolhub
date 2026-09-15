/**
 * Random password generation. Pure, no DOM beyond the platform's Web Crypto
 * API (`crypto.getRandomValues`) — the same cryptographically secure source
 * the UUID generator uses, never `Math.random()`, which is not specified to
 * be unpredictable and must never be used for anything security-adjacent.
 */

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  /** Drop characters that are easy to misread when handwritten or in some fonts: 0/O, 1/l/I, etc. */
  excludeAmbiguous: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
// A symbol set every US/UK keyboard layout types directly, no dead keys or alt-codes.
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>/?';
/** Characters commonly confused with each other in a handwritten or misread password. */
const AMBIGUOUS = new Set('0O1lI|');

const dropAmbiguous = (set: string) => [...set].filter((c) => !AMBIGUOUS.has(c)).join('');

export type PasswordStrength = 'weak' | 'fair' | 'strong' | 'very-strong';

export interface Password {
  value: string;
  /** log2(pool size) × length — the number of yes/no guesses an attacker who knows the
   * character set (but not the password) needs on average. Not a guarantee against a
   * dictionary or reused-password attack, only a measure of the random space searched. */
  entropyBits: number;
  strength: PasswordStrength;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** The characters a password will be drawn from, given the selected options. */
export function characterPool(opts: Partial<PasswordOptions> = {}): string {
  const o = { ...DEFAULT_PASSWORD_OPTIONS, ...opts };
  const sets: string[] = [];
  if (o.uppercase) sets.push(UPPERCASE);
  if (o.lowercase) sets.push(LOWERCASE);
  if (o.numbers) sets.push(NUMBERS);
  if (o.symbols) sets.push(SYMBOLS);
  const pool = sets.join('');
  return o.excludeAmbiguous ? dropAmbiguous(pool) : pool;
}

/** The pools a password will draw at least one character from — for the "guaranteed one of each" rule. */
function activeSets(opts: PasswordOptions): string[] {
  const sets: string[] = [];
  if (opts.uppercase) sets.push(opts.excludeAmbiguous ? dropAmbiguous(UPPERCASE) : UPPERCASE);
  if (opts.lowercase) sets.push(opts.excludeAmbiguous ? dropAmbiguous(LOWERCASE) : LOWERCASE);
  if (opts.numbers) sets.push(opts.excludeAmbiguous ? dropAmbiguous(NUMBERS) : NUMBERS);
  if (opts.symbols) sets.push(opts.excludeAmbiguous ? dropAmbiguous(SYMBOLS) : SYMBOLS);
  return sets.filter((s) => s.length > 0);
}

/**
 * A uniformly random integer in [0, max) from the CSPRNG. Draws just enough
 * bytes to cover the range and rejects values that would bias the result
 * toward the low end — `bytes % max` alone is a real, well-known weakness
 * whenever max doesn't evenly divide the byte range, which is true of every
 * pool size used here (character-set sizes and, via shuffle(), lengths up to
 * 512 both need this, not only the single-byte case a small character pool
 * would allow).
 */
function randomInt(max: number): number {
  if (!(max > 0) || !Number.isInteger(max)) throw new RangeError('randomInt: max must be a positive integer');
  if (max === 1) return 0;
  const byteLength = Math.ceil(Math.log2(max) / 8);
  const range = 256 ** byteLength;
  const limit = range - (range % max);
  const buf = new Uint8Array(byteLength);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf.reduce((acc, b) => acc * 256 + b, 0);
  } while (x >= limit);
  return x % max;
}

/** Fisher–Yates using the same rejection-sampled source, so guaranteed characters
 * (see generatePassword) don't end up predictably clustered at the start. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function strengthOf(bits: number): PasswordStrength {
  if (bits < 40) return 'weak';
  if (bits < 60) return 'fair';
  if (bits < 80) return 'strong';
  return 'very-strong';
}

export const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
  'very-strong': 'Very strong',
};

/**
 * One password. Guarantees at least one character from every selected class
 * when the length allows it (a purely random draw from the combined pool can,
 * by chance, omit a class entirely — most public generators don't guard
 * against this, and it's the single most common complaint about them: "I
 * asked for symbols and got none"). When the length is shorter than the
 * number of selected classes, that guarantee is dropped and the page's edge
 * cases section says so, rather than silently ignoring some of the options.
 */
export function generatePassword(opts: Partial<PasswordOptions> = {}): Result<Password> {
  const o: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS, ...opts };
  const length = Math.floor(o.length);
  if (!Number.isFinite(length) || length < 1) return { ok: false, error: 'Length must be at least 1 character.' };
  if (length > 512) return { ok: false, error: 'Length must be 512 characters or fewer.' };

  const sets = activeSets(o);
  if (sets.length === 0) return { ok: false, error: 'Select at least one character type.' };
  const pool = sets.join('');
  if (pool.length === 0) return { ok: false, error: 'Excluding ambiguous characters left no characters to choose from.' };

  const chars: string[] = [];
  const guaranteed = sets.length <= length ? sets : [];
  for (const set of guaranteed) chars.push(set[randomInt(set.length)]);
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]);
  shuffle(chars);

  const entropyBits = Math.round(length * Math.log2(pool.length) * 10) / 10;
  return { ok: true, value: { value: chars.join(''), entropyBits, strength: strengthOf(entropyBits) } };
}

/** Batch generation for the widget's "how many at once" option, 1–100 at a time. */
export function generatePasswords(count: number, opts: Partial<PasswordOptions> = {}): Result<Password[]> {
  const n = Math.min(100, Math.max(1, Math.floor(count)));
  const out: Password[] = [];
  for (let i = 0; i < n; i++) {
    const r = generatePassword(opts);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}
