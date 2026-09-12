/** Base64 and URL encoding helpers with full Unicode support. Pure, no DOM. */

export type Result = { ok: true; output: string } | { ok: false; error: string };

// ---- Base64 ---------------------------------------------------------------

export interface Base64Options {
  urlSafe: boolean;
  /** Omit trailing "=" padding. */
  noPadding: boolean;
}

export function encodeBase64(text: string, opts: Partial<Base64Options> = {}): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  let out = btoa(binary);
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
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
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
  switch (mode) {
    case 'full':
      return encodeURI(text);
    case 'form':
      return encodeURIComponent(text).replace(/%20/g, '+');
    default:
      return encodeURIComponent(text);
  }
}

export function urlDecode(text: string, plusAsSpace = true): Result {
  const src = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return { ok: true, output: decodeURIComponent(src) };
  } catch {
    return { ok: false, error: 'Malformed percent-encoding — a "%" must be followed by two hex digits.' };
  }
}
