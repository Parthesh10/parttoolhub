/** Base64 and URL encoding helpers with full Unicode support. Pure, no DOM. */

export type Result = { ok: true; output: string } | { ok: false; error: string };

// ---- Base64 ---------------------------------------------------------------

export interface Base64Options {
  urlSafe: boolean;
  /** Omit trailing "=" padding. */
  noPadding: boolean;
}

/**
 * A lone surrogate (half of a broken emoji, common in truncated pastes) is not
 * a valid code point. TextEncoder replaces it with U+FFFD; encodeURIComponent
 * throws instead. Normalise up front so every tool behaves the same way.
 */
const wellFormed = (text: string) =>
  text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');

export function encodeBase64(text: string, opts: Partial<Base64Options> = {}): string {
  const bytes = new TextEncoder().encode(text);
  // Build the "binary string" btoa wants in 32 KB chunks: one apply() per chunk
  // is ~10× faster than appending a character at a time on multi-megabyte input.
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]));
  }
  let out = btoa(parts.join(''));
  if (opts.urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (opts.noPadding) out = out.replace(/=+$/, '');
  return out;
}

export function decodeBase64(text: string): Result {
  const cleaned = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!cleaned) return { ok: false, error: 'Paste Base64 text to decode.' };
  if (/[^A-Za-z0-9+/=]/.test(cleaned)) {
    return { ok: false, error: 'Input contains characters that are not part of the Base64 alphabet.' };
  }
  const padded = cleaned.replace(/=+$/, '');
  if (padded.length % 4 === 1) return { ok: false, error: 'Input length is not valid for Base64 (one dangling character).' };
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  try {
    const binary = atob(full);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { ok: true, output: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: 'The Base64 decodes to bytes that are not valid UTF-8 text (it may be a binary file).' };
  }
}

// ---- URL / percent encoding -----------------------------------------------

export type UrlEncodeMode = 'component' | 'full' | 'form';

/**
 * component — encodeURIComponent: for a single query value or path segment.
 * full      — encodeURI: keeps :/?#&= so a whole URL stays a URL.
 * form      — like component but spaces become "+", as in HTML form posts.
 */
export function urlEncode(text: string, mode: UrlEncodeMode = 'component'): string {
  const t = wellFormed(text);
  switch (mode) {
    case 'full':
      return encodeURI(t);
    case 'form':
      return encodeURIComponent(t).replace(/%20/g, '+');
    default:
      return encodeURIComponent(t);
  }
}

export function urlDecode(text: string, plusAsSpace = true): Result {
  const src = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return { ok: true, output: decodeURIComponent(src) };
  } catch {
    // decodeURIComponent throws the same URIError for both failure modes, so
    // tell them apart here: a "%" not followed by two hex digits, or hex that
    // is well-formed but decodes to bytes that are not valid UTF-8 (e.g. "%FF").
    const badEscape = /%(?![0-9A-Fa-f]{2})/.test(src);
    return {
      ok: false,
      error: badEscape
        ? 'Malformed percent-encoding: every "%" must be followed by exactly two hex digits.'
        : 'The percent-encoded bytes are not valid UTF-8 text, so they cannot be shown as characters.',
    };
  }
}
