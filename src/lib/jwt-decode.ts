/**
 * Decode (never verify) a JSON Web Token. Pure, no DOM. Uses the platform
 * atob/TextDecoder that exist in every modern browser and in Node 16+.
 */
/**
 * The token behind the page's "Load sample" button and the worked example on
 * /tools/jwt-decoder — one constant so the two can never drift apart.
 * HS256, sub 1234567890, name "Ada Lovelace", iat 2023-11-14, exp 2033-05-18.
 */
export const SAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ.' +
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

export interface JwtTiming {
  exp?: Date;
  iat?: Date;
  nbf?: Date;
  /** null when the token has no exp claim. */
  expired: boolean | null;
  /** null when the token has no nbf claim. */
  notYetValid: boolean | null;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  timing: JwtTiming;
}

export type JwtResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string };

export function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseSegment(segment: string, name: string): Record<string, unknown> {
  let text: string;
  try {
    text = base64UrlDecode(segment);
  } catch {
    throw new Error(`The ${name} is not valid Base64URL.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`The ${name} decodes, but is not valid JSON.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The ${name} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function claimDate(payload: Record<string, unknown>, key: string): Date | undefined {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? new Date(v * 1000) : undefined;
}

export function decodeJwt(token: string, now: number = Date.now()): JwtResult {
  const t = token.trim().replace(/^Bearer\s+/i, '');
  if (!t) return { ok: false, error: 'Paste a token to decode.' };

  const parts = t.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: `A JWT has three dot-separated parts; this input has ${parts.length}.` };
  }
  const [h, p, s] = parts;
  if (!h || !p) return { ok: false, error: 'The header and payload parts cannot be empty.' };

  try {
    const header = parseSegment(h, 'header');
    const payload = parseSegment(p, 'payload');
    const exp = claimDate(payload, 'exp');
    const nbf = claimDate(payload, 'nbf');
    const timing: JwtTiming = {
      exp,
      iat: claimDate(payload, 'iat'),
      nbf,
      expired: exp ? exp.getTime() <= now : null,
      notYetValid: nbf ? nbf.getTime() > now : null,
    };
    return { ok: true, jwt: { header, payload, signature: s, timing } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "in 2 hours" / "3 days ago" style phrasing for claim timestamps. */
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
