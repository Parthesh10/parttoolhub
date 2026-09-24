/**
 * UUID generation: version 4 (random, RFC 4122) and version 7 (Unix-timestamp-
 * prefixed, RFC 9562) — the two versions actually worth generating: v4 for a
 * generic random identifier, v7 when the ID also needs to sort roughly by
 * creation time (a common database primary-key choice, since it avoids the
 * random-insert-order index fragmentation v4 causes). Pure, no DOM beyond the
 * platform's Web Crypto API (`crypto.getRandomValues`), available in every
 * modern browser and in Node.
 */

export type UuidVersion = 4 | 7;

export interface FormatOptions {
  uppercase: boolean;
  hyphens: boolean;
  braces: boolean;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** RFC 4122 version 4: all 122 non-version/variant bits are random. */
export function generateV4(): Uint8Array {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xxxxxx
  return bytes;
}

/**
 * RFC 9562 version 7: the first 48 bits are a big-endian Unix millisecond
 * timestamp, so UUIDs generated later sort after ones generated earlier —
 * everything after that is random, like v4.
 */
export function generateV7(now: number = Date.now()): Uint8Array {
  const bytes = randomBytes(16);
  const ts = BigInt(Math.max(0, Math.floor(now)));
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt((5 - i) * 8)) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xxxxxx
  return bytes;
}

/** The Unix millisecond timestamp embedded in a v7 UUID's first 48 bits. */
export function extractV7Timestamp(bytes: Uint8Array): number {
  let ts = 0n;
  for (let i = 0; i < 6; i++) ts = (ts << 8n) | BigInt(bytes[i]);
  return Number(ts);
}

function toHyphenated(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatUuid(bytes: Uint8Array, opts: Partial<FormatOptions> = {}): string {
  const o: FormatOptions = { uppercase: false, hyphens: true, braces: false, ...opts };
  const hex = bytesToHex(bytes);
  let out = o.hyphens ? toHyphenated(hex) : hex;
  if (o.uppercase) out = out.toUpperCase();
  if (o.braces) out = `{${out}}`;
  return out;
}

export function generateUuids(version: UuidVersion, count: number, opts: Partial<FormatOptions> = {}, now: number = Date.now()): string[] {
  const n = Math.min(1000, Math.max(1, Math.floor(count)));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const bytes = version === 4 ? generateV4() : generateV7(now);
    out.push(formatUuid(bytes, opts));
  }
  return out;
}

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * The Unix millisecond timestamp inside a formatted v7 UUID (any case, with or without hyphens
 * or braces), or null when the string is not a v7 UUID. The UUID Generator shows it next to the
 * batch, since that timestamp is the whole reason to pick v7 over v4.
 */
export function v7TimestampFromString(s: string): number | null {
  const hex = s.replace(/[{}-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex) || hex[12] !== '7') return null;
  return parseInt(hex.slice(0, 12), 16);
}
