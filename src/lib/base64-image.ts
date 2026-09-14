/**
 * Base64 ↔ image: decode a pasted Base64 string or data URI into image bytes
 * (sniffing the real format from the bytes, not the label), and encode image
 * bytes into the four forms people paste into code. Pure, no DOM — works in
 * Node for tests and build-time page examples as well as in the browser.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---- Shared sample ----------------------------------------------------------

/**
 * A 32×32 PNG (157 bytes): a blue rounded square with a white dot. Both pages'
 * "Load sample" buttons and their build-time Example sections use this exact
 * string, so the documentation can never drift from what the button inserts.
 * Regenerate with the zlib-only script in the commit that added it if the
 * design ever changes.
 */
export const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZElEQVR42mNgQAOqya//0xIz4AK0thivQ+htOYYjBtQBA2U53BGjDhiSDsAFaO4AYgFNHEAqoKoDyAXDwwGUglEHjDpg6DtgtBwYFEXxoKiMBkV1PNoiGp4OGO0ZDYrO6UB2zwEFpbp3WQ7rpgAAAABJRU5ErkJggg==';
export const SAMPLE_PNG_DATA_URI = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;

// ---- Format sniffing --------------------------------------------------------

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'bmp' | 'ico' | 'avif';

export interface ImageInfo {
  format: ImageFormat;
  /** The MIME type browsers expect in a data URI or <img src>. */
  mime: string;
  /** File extension for downloads, without the dot. */
  extension: string;
  /** Pixel size read from the file header. Absent when the header is unusual. */
  width?: number;
  height?: number;
  /**
   * The header is intact but the end-of-file marker is missing (PNG IEND, JPEG
   * EOI, GIF trailer) — the usual sign of a string cut off by a column limit.
   * The browser may still show the top of the image.
   */
  truncated?: true;
}

const MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};
const EXT: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg', bmp: 'bmp', ico: 'ico', avif: 'avif' };

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const i32le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);

function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  // Walk the marker segments to the first Start-Of-Frame (SOF0–SOF15, excluding
  // DHT/JPG/DAC which share the C0–CF range but carry no dimensions).
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
    const len = u16be(b, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

function webpSize(b: Uint8Array): { width: number; height: number } | undefined {
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) {
    const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | (b1 >> 6)) };
  }
  if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return undefined;
}

function avifSize(b: Uint8Array): { width: number; height: number } | undefined {
  // The ispe (image spatial extents) box: 'ispe', 4 bytes version/flags, then width and height.
  const limit = Math.min(b.length - 12, 4096);
  for (let i = 8; i < limit; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
      return { width: u32be(b, i + 8), height: u32be(b, i + 12) };
    }
  }
  return undefined;
}

function svgSize(text: string): { width: number; height: number } | undefined {
  const open = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!open) return undefined;
  const attr = (name: string) => open.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(?:px)?\\s*["']`, 'i'))?.[1];
  const w = attr('width'), h = attr('height');
  if (w && h) return { width: Number(w), height: Number(h) };
  const vb = open.match(/\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i);
  if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  return undefined;
}

/** Text that is an SVG document: optional BOM, XML declaration, comments and DOCTYPE, then <svg. */
const looksLikeSvg = (text: string) => /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text);

/**
 * Identify an image from its first bytes. Returns null for anything that is
 * not one of the eight formats browsers display: file labels lie (a ".png"
 * that is really a JPEG), so every decision downstream uses this, not the
 * name or the data-URI prefix.
 */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  const n = b.length;
  const info = (format: ImageFormat, size?: { width: number; height: number }, truncated = false): ImageInfo => ({
    format, mime: MIME[format], extension: EXT[format],
    ...(size && size.width > 0 && size.height > 0 ? size : {}),
    ...(truncated ? { truncated: true as const } : {}),
  });
  // End-of-file markers, searched in a short tail window because some writers append padding.
  const tailHas = (marker: number[], window: number) => {
    const from = Math.max(0, n - window);
    outer: for (let i = n - marker.length; i >= from; i--) {
      for (let k = 0; k < marker.length; k++) if (b[i + k] !== marker[k]) continue outer;
      return true;
    }
    return false;
  };
  if (n >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return info('png', { width: u32be(b, 16), height: u32be(b, 20) }, !tailHas([0x49, 0x45, 0x4e, 0x44], 16));
  }
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return info('jpeg', jpegSize(b), !tailHas([0xff, 0xd9], 64));
  if (n >= 10 && ascii(b, 0, 4) === 'GIF8' && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return info('gif', { width: u16le(b, 6), height: u16le(b, 8) }, !tailHas([0x3b], 4));
  }
  if (n >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return info('webp', webpSize(b));
  if (n >= 26 && b[0] === 0x42 && b[1] === 0x4d) return info('bmp', { width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) });
  if (n >= 8 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && u16le(b, 4) > 0) {
    return info('ico', { width: b[6] || 256, height: b[7] || 256 });
  }
  if (n >= 12 && ascii(b, 4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(b, 8, 12))) return info('avif', avifSize(b));
  // SVG is text, so decode the head of the file and look for the root element.
  if (n >= 5 && n <= 8 * 1024 * 1024) {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(n, 4096)));
    if (looksLikeSvg(head)) {
      return info('svg', svgSize(n <= 4096 ? head : new TextDecoder().decode(b)));
    }
  }
  return null;
}

/** Non-image files worth naming in an error message, so "not an image" can say what it is. */
export function sniffOther(bytes: Uint8Array): { name: string; extension: string; mime: string } | null {
  const b = bytes;
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return { name: 'a PDF', extension: 'pdf', mime: 'application/pdf' };
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return { name: 'a ZIP archive', extension: 'zip', mime: 'application/zip' };
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return { name: 'a gzip file', extension: 'gz', mime: 'application/gzip' };
  return null;
}

/** True when the bytes are valid UTF-8 with no control characters other than tab/newline — i.e. plain text. */
export function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
    // eslint-disable-next-line no-control-regex
    return !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text);
  } catch {
    return false;
  }
}

// ---- Base64 bytes -----------------------------------------------------------

export interface Cleanup {
  /** A data: prefix (or an <img>/CSS wrapper around one) was removed. */
  prefix: boolean;
  /** The MIME type the data: prefix claimed, if it had one. */
  claimedMime?: string;
  /** Spaces, line breaks or tabs were removed from inside the Base64. */
  whitespace: boolean;
  /** Surrounding quotes or JSON string escapes (\/ and \n) were removed. */
  quotes: boolean;
  /** Percent-escapes such as %2B or %3D were decoded first. */
  percent: boolean;
  /** The URL-safe alphabet (- and _) was translated to + and /. */
  urlSafe: boolean;
  /** Trailing "=" padding was missing and has been restored. */
  padding: boolean;
}

/**
 * Turn whatever was pasted into raw bytes. Accepts a bare Base64 string, a
 * full data: URI (Base64 or percent-encoded), an <img src="…"> tag or a CSS
 * url(…) wrapping one, a JSON string value with its quotes and escapes, the
 * URL-safe alphabet, missing padding, and line wrapping — every form these
 * strings arrive in when copied out of a database, a JSON body, an email or
 * a stylesheet. Reports what it had to clean so the UI can say so.
 */
export function base64ToBytes(input: string): Result<{ bytes: Uint8Array; cleanup: Cleanup }> {
  const cleanup: Cleanup = { prefix: false, whitespace: false, quotes: false, percent: false, urlSafe: false, padding: false };
  let text = input.trim();
  if (!text) return { ok: false, error: 'Paste a Base64 string or a data: URI to decode.' };

  // Quoted JSON/JS string: strip the quotes and the escapes JSON adds to "/" and line breaks.
  if (/^["'`][\s\S]*["'`]$/.test(text) && text.length >= 2) {
    text = text.slice(1, -1);
    cleanup.quotes = true;
  }
  if (/\\\/|\\[nrt]/.test(text)) {
    text = text.replace(/\\\//g, '/').replace(/\\[nrt]/g, '');
    cleanup.quotes = true;
  }

  // A data: URI, possibly inside <img src="…"> or url(…). The payload runs to the
  // closing quote/paren that opened it, if one did; a bare URI runs to the end.
  const at = text.search(/data:/i);
  if (at !== -1) {
    const uri = text.slice(at).match(/^data:([^,]*),([\s\S]*)$/i);
    if (!uri) return { ok: false, error: 'The data: URI has no comma, so there is no payload after the media type.' };
    cleanup.prefix = true;
    const meta = uri[1].trim();
    const claimed = meta.split(';')[0].trim().toLowerCase();
    if (claimed) cleanup.claimedMime = claimed;
    let payload = uri[2];
    const opener = text.slice(0, at).match(/(["'`(])\s*$/)?.[1];
    const closer = opener === '(' ? ')' : opener;
    const end = closer ? payload.indexOf(closer) : -1;
    if (end !== -1) payload = payload.slice(0, end);
    if (!/;\s*base64\s*$/i.test(meta)) {
      // Percent-encoded (or raw) text payload — typical for inline SVG in CSS.
      if (!payload.trim()) return { ok: false, error: 'The data: URI has nothing after the comma.' };
      try {
        const decoded = decodeURIComponent(payload.replace(/\+/g, '%2B'));
        return { ok: true, value: { bytes: new TextEncoder().encode(decoded), cleanup: { ...cleanup, percent: /%[0-9A-Fa-f]{2}/.test(payload) } } };
      } catch {
        return { ok: false, error: 'The data: URI is not Base64 and its percent-encoding is malformed.' };
      }
    }
    // Base64 is letters, digits, + / (- _ % when URL-safe or percent-escaped), line breaks, then
    // padding — so the payload ends where that pattern does. An unquoted <img src=data:… alt=x>
    // therefore stops before " alt", and ">" or ")" never get in.
    text = payload.match(/^[A-Za-z0-9+/%_\-\s]*=*/)?.[0] ?? '';
    if (!text.trim()) return { ok: false, error: 'The data: URI has nothing after the comma.' };
  }

  // Percent-escapes from a query string: %2B for +, %2F for /, %3D for =.
  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    try {
      text = decodeURIComponent(text);
      cleanup.percent = true;
    } catch {
      /* leave it; the alphabet check below reports it */
    }
  }

  const noSpace = text.replace(/\s+/g, '');
  if (noSpace.length !== text.length) cleanup.whitespace = true;
  text = noSpace;

  if (/[-_]/.test(text)) {
    text = text.replace(/-/g, '+').replace(/_/g, '/');
    cleanup.urlSafe = true;
  }
  if (!text) return { ok: false, error: 'Paste a Base64 string or a data: URI to decode.' };
  if (/[^A-Za-z0-9+/=]/.test(text)) {
    return { ok: false, error: 'Input contains characters that are not part of the Base64 alphabet.' };
  }
  const unpadded = text.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return { ok: false, error: 'Input length is not valid for Base64 (one dangling character).' };
  const needed = (4 - (unpadded.length % 4)) % 4;
  if (text.length - unpadded.length !== needed) cleanup.padding = true;
  const full = unpadded + '='.repeat(needed);
  try {
    const binary = atob(full);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { ok: true, value: { bytes, cleanup } };
  } catch {
    return { ok: false, error: 'Input contains characters that are not part of the Base64 alphabet.' };
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  // 32 KB chunks: one apply() per chunk is ~10× faster than one character at a time.
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]));
  }
  return btoa(parts.join(''));
}

// ---- Base64 → image -----------------------------------------------------------

export interface DecodedImage {
  bytes: Uint8Array;
  info: ImageInfo;
  /** A data: URI built from the sniffed MIME type — safe to put straight into <img src>. */
  dataUri: string;
  cleanup: Cleanup;
  /** Set when the pasted prefix named a different type from what the bytes are. */
  mismatch?: { claimed: string; actual: string };
}

/**
 * Decode a Base64 string or data: URI into displayable image bytes. Fails with
 * a message that says *what* the bytes are when they are not an image (plain
 * text, a PDF, …) so the page can point at the right tool instead.
 */
export function base64ToImage(input: string): Result<DecodedImage> {
  const r = base64ToBytes(input);
  if (!r.ok) return r;
  const { bytes, cleanup } = r.value;
  const info = sniffImage(bytes);
  if (!info) {
    const other = sniffOther(bytes);
    if (other) return { ok: false, error: `The Base64 decodes to ${other.name}, not an image.` };
    if (isPlainText(bytes)) return { ok: false, error: 'The Base64 decodes to plain text, not an image.' };
    return { ok: false, error: 'The Base64 decodes to bytes that are not a PNG, JPEG, GIF, WebP, SVG, BMP, ICO or AVIF image.' };
  }
  const dataUri = `data:${info.mime};base64,${bytesToBase64(bytes)}`;
  const claimed = cleanup.claimedMime;
  const mismatch = claimed && claimed !== info.mime && !(claimed === 'image/jpg' && info.mime === 'image/jpeg') ? { claimed, actual: info.mime } : undefined;
  return { ok: true, value: { bytes, info, dataUri, cleanup, ...(mismatch ? { mismatch } : {}) } };
}

// ---- Image → Base64 -----------------------------------------------------------

export interface EncodedImage {
  info: ImageInfo;
  /** Raw Base64 with no prefix, for a database column, a JSON field or an API body. */
  base64: string;
  /** data:<mime>;base64,… for <img src>, CSS url() or a browser address bar. */
  dataUri: string;
  /** A complete <img> tag with width/height when known, so the browser reserves the space. */
  html: string;
  /** A CSS declaration for background-image. */
  css: string;
  /** Sizes, so the UI can show what inlining costs. */
  bytes: number;
  base64Length: number;
}

/**
 * Encode image bytes for embedding. The format comes from the bytes, never from
 * the file name: a ".png" that is really a JPEG gets image/jpeg, because a
 * wrong MIME type in a data URI is the most common reason an inline image
 * shows as broken.
 */
export function imageToBase64(bytes: Uint8Array): Result<EncodedImage> {
  if (bytes.length === 0) return { ok: false, error: 'The file is empty.' };
  const info = sniffImage(bytes);
  if (!info) {
    const other = sniffOther(bytes);
    return { ok: false, error: `This file is ${other ? other.name : 'not a PNG, JPEG, GIF, WebP, SVG, BMP, ICO or AVIF image'}, so a browser would not display it.` };
  }
  const base64 = bytesToBase64(bytes);
  const dataUri = `data:${info.mime};base64,${base64}`;
  const size = info.width && info.height ? ` width="${info.width}" height="${info.height}"` : '';
  return {
    ok: true,
    value: {
      info,
      base64,
      dataUri,
      html: `<img src="${dataUri}" alt=""${size}>`,
      css: `background-image: url("${dataUri}");`,
      bytes: bytes.length,
      base64Length: base64.length,
    },
  };
}

/** "1.2 KB" style sizes for the UI and the page. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
