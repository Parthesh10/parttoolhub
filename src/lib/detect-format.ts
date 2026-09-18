/**
 * Homepage "paste to detect" (UX-011): sniffs pasted text for a small set of
 * unambiguous formats and points at the matching tool. Deliberately narrow —
 * only formats with a near-zero false-positive rate are included. Detectors
 * that would guess at prose (a comma-separated sentence looking like a list,
 * a dash-prefixed line looking like Markdown) are left out on purpose: a
 * wrong suggestion costs more trust than a missed one.
 */

export interface Detection {
  slug: string;
  label: string;
}

const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

function isValidBase64(s: string): boolean {
  if (s.length < 16 || s.length % 4 !== 0) return false;
  if (!BASE64_RE.test(s)) return false;
  try {
    // atob only accepts the standard alphabet; reject URL-safe strings here so
    // they fall through to the JWT/base64url-specific checks instead.
    if (/[-_]/.test(s)) return false;
    atob(s);
    return true;
  } catch {
    return false;
  }
}

function base64UrlDecode(s: string): string | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

function looksLikeJwt(raw: string): boolean {
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return false;
  const header = base64UrlDecode(parts[0]);
  if (!header) return false;
  try {
    const parsed = JSON.parse(header);
    return typeof parsed === 'object' && parsed !== null && ('alg' in parsed || 'typ' in parsed);
  } catch {
    return false;
  }
}

/** Base64 that decodes to bytes starting with a known image file signature. */
function looksLikeBase64Image(raw: string): boolean {
  if (!isValidBase64(raw)) return false;
  try {
    const bytes = atob(raw.slice(0, 16));
    const sig = Array.from(bytes.slice(0, 8), (c) => c.charCodeAt(0));
    const startsWith = (magic: number[]) => magic.every((b, i) => sig[i] === b);
    return (
      startsWith([0x89, 0x50, 0x4e, 0x47]) || // PNG
      startsWith([0xff, 0xd8, 0xff]) || // JPEG
      startsWith([0x47, 0x49, 0x46]) || // GIF
      (startsWith([0x52, 0x49, 0x46, 0x46]) && bytes.slice(8, 12) === 'WEBP')
    );
  } catch {
    return false;
  }
}

function looksLikePythonDict(raw: string): boolean {
  if (!/^[{[]/.test(raw)) return false;
  if (isJson(raw)) return false; // valid JSON is handled by its own, higher-priority check
  return /'[^']*'\s*:/.test(raw) && /\b(True|False|None)\b/.test(raw);
}

function isJson(raw: string): boolean {
  if (!/^[{[]/.test(raw)) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_HSL_RE = /^(rgb|hsl)a?\(\s*[\d.%]+[\s,]+[\d.%]+[\s,]+[\d.%]+/i;

/**
 * Detects the format of pasted text and returns the tool slug and a short
 * reason, or null if nothing matches confidently. Checked most-specific
 * first, since a JWT is technically also three valid base64url blobs.
 */
export function detectFormat(input: string): Detection | null {
  const raw = input.trim();
  if (!raw) return null;

  if (looksLikeJwt(raw)) {
    return { slug: 'jwt-decoder', label: 'Looks like a JWT token' };
  }
  if (raw.startsWith('data:image/')) {
    return { slug: 'base64-to-image', label: 'Looks like an image data URI' };
  }
  if (isJson(raw)) {
    return { slug: 'json-formatter', label: 'Looks like JSON' };
  }
  if (looksLikePythonDict(raw)) {
    return { slug: 'python-dict-to-json', label: "Looks like a Python dict (single quotes, True/False/None)" };
  }
  if (/^<[a-z!][\s\S]*>$/i.test(raw) && /<\/[a-z]+>/i.test(raw)) {
    return { slug: 'html-to-markdown', label: 'Looks like HTML' };
  }
  if (HEX_COLOR_RE.test(raw) || RGB_HSL_RE.test(raw)) {
    return { slug: 'color-converter', label: 'Looks like a color value' };
  }
  if (/^\d{10}$/.test(raw) || /^\d{13}$/.test(raw)) {
    return { slug: 'unix-timestamp-converter', label: 'Looks like a Unix timestamp' };
  }
  if (/%[0-9a-f]{2}/i.test(raw) && decodeURIComponentSafely(raw) !== raw) {
    return { slug: 'url-encode-decode', label: 'Looks like URL-encoded text' };
  }
  if (looksLikeBase64Image(raw)) {
    return { slug: 'base64-to-image', label: 'Looks like a Base64-encoded image' };
  }
  if (isValidBase64(raw)) {
    return { slug: 'base64-encode-decode', label: 'Looks like Base64-encoded text' };
  }
  return null;
}

function decodeURIComponentSafely(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
