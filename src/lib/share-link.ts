/**
 * "Copy link with your input" (UI round 5c): a tool's input and changed options, packed into the
 * link's #fragment. A fragment is never sent to a server (not ours, not in a Referer header), and
 * an inline script at the top of Base.astro moves it out of the address bar before the analytics
 * and ad scripts load, so the shared text is not reported in page URLs either.
 *
 * Format: `#in=` + a one-letter tag + base64url bytes. `z` = deflate-raw compressed UTF-8 JSON
 * (CompressionStream, every current browser), `u` = the same JSON uncompressed (a browser without
 * CompressionStream). JSON Formatter-style input usually compresses to a third or less.
 */
export const SHARE_PREFIX = '#in=';
/** sessionStorage key the Base.astro inline script parks a shared fragment under. */
export const SHARED_KEY = 'pth:shared-input';
/** Longest fragment we hand out: chat apps and email clients start mangling links past this. */
export const MAX_SHARE_CHARS = 8000;

export interface SharePayload {
  v: 1;
  /** The tool's data fields by element id (textareas, and text/number/date fields outside Options).
   *  By id rather than position, so a link made today still fills the right box after a redesign. */
  i: Record<string, string>;
  /** Options that differ from the page defaults (control id -> value or pressed/checked). */
  o: Record<string, string | boolean>;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The fragment body (without `#in=`) for a payload. */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'undefined') return 'u' + toBase64Url(bytes);
  return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

/** The payload inside a fragment body, or null for anything that is not a valid share. */
export async function decodeShare(code: string): Promise<SharePayload | null> {
  try {
    const tag = code[0];
    let bytes = fromBase64Url(code.slice(1));
    if (tag === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (tag !== 'u') return null;
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (!p || p.v !== 1 || !p.i || typeof p.i !== 'object' || Array.isArray(p.i)) return null;
    if (!Object.values(p.i).every((x) => typeof x === 'string')) return null;
    const o: Record<string, string | boolean> = {};
    if (p.o && typeof p.o === 'object') {
      for (const [k, val] of Object.entries(p.o)) if (typeof val === 'string' || typeof val === 'boolean') o[k] = val;
    }
    return { v: 1, i: p.i, o };
  } catch {
    return null;
  }
}
