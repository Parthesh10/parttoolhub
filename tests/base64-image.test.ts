import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  base64ToImage,
  imageToBase64,
  sniffImage,
  sniffOther,
  isPlainText,
  formatBytes,
  bytesToBase64,
  SAMPLE_PNG_BASE64,
  SAMPLE_PNG_DATA_URI,
} from '../src/lib/base64-image.ts';

const sampleBytes = Uint8Array.from(atob(SAMPLE_PNG_BASE64), (c) => c.charCodeAt(0));
const okImage = (input: string) => {
  const r = base64ToImage(input);
  assert.ok(r.ok, `expected ok, got: ${r.ok ? '' : r.error}`);
  return r.value;
};
const err = (input: string) => {
  const r = base64ToImage(input);
  assert.ok(!r.ok, 'expected an error');
  return r.error;
};

// ---- the shared sample ---------------------------------------------------------

test('sample is a 157-byte 32×32 PNG and the data URI wraps the same string', () => {
  assert.equal(sampleBytes.length, 157);
  assert.deepEqual(sniffImage(sampleBytes), { format: 'png', mime: 'image/png', extension: 'png', width: 32, height: 32 });
  assert.equal(SAMPLE_PNG_DATA_URI, `data:image/png;base64,${SAMPLE_PNG_BASE64}`);
});

// ---- every form a Base64 image arrives in --------------------------------------

test('decodes raw Base64 and a full data: URI to the same bytes', () => {
  const raw = okImage(SAMPLE_PNG_BASE64);
  const uri = okImage(SAMPLE_PNG_DATA_URI);
  assert.deepEqual(raw.bytes, sampleBytes);
  assert.deepEqual(uri.bytes, sampleBytes);
  assert.equal(raw.cleanup.prefix, false);
  assert.equal(uri.cleanup.prefix, true);
  assert.equal(uri.cleanup.claimedMime, 'image/png');
  assert.equal(raw.dataUri, SAMPLE_PNG_DATA_URI);
});

test('extracts the data URI out of an <img> tag (quoted or not) and a CSS url()', () => {
  for (const wrapped of [
    `<img src="${SAMPLE_PNG_DATA_URI}" alt="dot">`,
    `<img src='${SAMPLE_PNG_DATA_URI}'>`,
    `<img src=${SAMPLE_PNG_DATA_URI} alt=x>`,
    `background: url(${SAMPLE_PNG_DATA_URI}) no-repeat;`,
    `background-image: url("${SAMPLE_PNG_DATA_URI}");`,
  ]) {
    assert.deepEqual(okImage(wrapped).bytes, sampleBytes, wrapped.slice(0, 30));
  }
});

test('strips JSON quotes and the \\/ and \\n escapes a JSON string adds', () => {
  const quoted = okImage(JSON.stringify(SAMPLE_PNG_DATA_URI));
  assert.deepEqual(quoted.bytes, sampleBytes);
  assert.equal(quoted.cleanup.quotes, true);
  const escaped = okImage(JSON.stringify(SAMPLE_PNG_BASE64).replace(/\//g, '\\/'));
  assert.deepEqual(escaped.bytes, sampleBytes);
  assert.equal(escaped.cleanup.quotes, true);
});

test('ignores MIME line wrapping, accepts the URL-safe alphabet, restores missing padding, decodes percent-escapes', () => {
  const wrapped = okImage(SAMPLE_PNG_BASE64.replace(/(.{76})/g, '$1\r\n'));
  assert.deepEqual(wrapped.bytes, sampleBytes);
  assert.equal(wrapped.cleanup.whitespace, true);

  const urlSafe = okImage(SAMPLE_PNG_BASE64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  assert.deepEqual(urlSafe.bytes, sampleBytes);
  assert.equal(urlSafe.cleanup.urlSafe, true);
  assert.equal(urlSafe.cleanup.padding, true);

  const percent = okImage(encodeURIComponent(SAMPLE_PNG_BASE64));
  assert.deepEqual(percent.bytes, sampleBytes);
  assert.equal(percent.cleanup.percent, true);
});

test('the sniffed format wins over a wrong data: prefix, and image/jpg is not a mismatch for a JPEG', () => {
  const wrong = okImage(`data:image/jpeg;base64,${SAMPLE_PNG_BASE64}`);
  assert.equal(wrong.info.mime, 'image/png');
  assert.deepEqual(wrong.mismatch, { claimed: 'image/jpeg', actual: 'image/png' });
  assert.ok(wrong.dataUri.startsWith('data:image/png;base64,'), 'the rebuilt data URI uses the real type');

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
  const alias = okImage(`data:image/jpg;base64,${bytesToBase64(jpeg)}`);
  assert.equal(alias.info.format, 'jpeg');
  assert.equal(alias.mismatch, undefined);
});

test('SVG: percent-encoded, raw utf8 and Base64 data URIs, with size from width/height or viewBox', () => {
  const pct = okImage('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2220%22%3E%3C%2Fsvg%3E');
  assert.equal(pct.info.format, 'svg');
  assert.equal(pct.info.width, 10);
  assert.equal(pct.info.height, 20);
  assert.equal(pct.cleanup.percent, true);

  const raw = okImage('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');
  assert.equal(raw.info.width, 24);
  assert.equal(new TextDecoder().decode(raw.bytes).length, 91, 'the whole document, not cut at the first quote');

  const inCss = okImage(`url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/>") no-repeat`);
  assert.equal(inCss.info.width, 8);

  const b64 = okImage('data:image/svg+xml;base64,' + btoa('<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" width="48px" height="32px"></svg>'));
  assert.equal(b64.info.width, 48);
  assert.equal(b64.info.height, 32);

  const noSize = okImage(btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'));
  assert.equal(noSize.info.format, 'svg');
  assert.equal(noSize.info.width, undefined);
});

// ---- errors say what the bytes are --------------------------------------------

test('error messages: empty, text, PDF, ZIP, unknown binary, bad alphabet, dangling char, malformed data URI', () => {
  assert.equal(err(''), 'Paste a Base64 string or a data: URI to decode.');
  assert.equal(err('  \n '), 'Paste a Base64 string or a data: URI to decode.');
  assert.equal(err(btoa('Hello, world!')), 'The Base64 decodes to plain text, not an image.');
  assert.equal(err(btoa('<html><body>hi</body></html>')), 'The Base64 decodes to plain text, not an image.');
  assert.equal(err(btoa('%PDF-1.4 x')), 'The Base64 decodes to a PDF, not an image.');
  assert.equal(err(btoa('PK\x03\x04rest')), 'The Base64 decodes to a ZIP archive, not an image.');
  assert.equal(err('/w=='), 'The Base64 decodes to bytes that are not a PNG, JPEG, GIF, WebP, SVG, BMP, ICO or AVIF image.');
  assert.equal(err('abc$def'), 'Input contains characters that are not part of the Base64 alphabet.');
  assert.equal(err(SAMPLE_PNG_BASE64 + 'A'), 'Input length is not valid for Base64 (one dangling character).');
  assert.equal(err('data:image/png;base64'), 'The data: URI has no comma, so there is no payload after the media type.');
  assert.equal(err('data:image/png;base64,'), 'The data: URI has nothing after the comma.');
});

test('a PNG cut short keeps its header size but is flagged truncated', () => {
  const cut = okImage(SAMPLE_PNG_BASE64.slice(0, 60));
  assert.equal(cut.info.width, 32);
  assert.equal(cut.info.truncated, true);
  assert.equal(okImage(SAMPLE_PNG_BASE64).info.truncated, undefined);
});

// ---- format sniffing from synthetic headers ----------------------------------

test('sniffs GIF, BMP (negative height), ICO (0 = 256), WebP lossy/lossless/extended, AVIF ispe, JPEG SOF0', () => {
  assert.deepEqual(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00, 0, 0, 0, 0x3b])), { format: 'gif', mime: 'image/gif', extension: 'gif', width: 16, height: 32 });

  const bmp = new Uint8Array(30);
  bmp[0] = 0x42; bmp[1] = 0x4d; bmp[18] = 100; bmp[22] = 0x38; bmp[23] = 0xff; bmp[24] = 0xff; bmp[25] = 0xff; // height −200 (top-down)
  assert.deepEqual(sniffImage(bmp), { format: 'bmp', mime: 'image/bmp', extension: 'bmp', width: 100, height: 200 });

  assert.deepEqual(sniffImage(new Uint8Array([0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), { format: 'ico', mime: 'image/x-icon', extension: 'ico', width: 256, height: 256 });

  const riff = (chunk: string) => { const b = new Uint8Array(30); for (const [i, c] of [...`RIFF____WEBP${chunk}`].entries()) b[i] = c.charCodeAt(0); return b; };
  const lossy = riff('VP8 '); lossy[26] = 0x40; lossy[27] = 0x01; lossy[28] = 0xf0; lossy[29] = 0x00; // 320 × 240
  assert.deepEqual(sniffImage(lossy), { format: 'webp', mime: 'image/webp', extension: 'webp', width: 320, height: 240 });
  const lossless = riff('VP8L'); lossless[20] = 0x2f; lossless[21] = 0x63; lossless[22] = 0x00; lossless[23] = 0x19; lossless[24] = 0x00; // 100 × 101
  assert.deepEqual(sniffImage(lossless), { format: 'webp', mime: 'image/webp', extension: 'webp', width: 100, height: 101 });
  const extended = riff('VP8X'); extended[24] = 0x1f; extended[27] = 0x0f; // 32 × 16
  assert.deepEqual(sniffImage(extended), { format: 'webp', mime: 'image/webp', extension: 'webp', width: 32, height: 16 });

  const avif = new Uint8Array(64);
  for (const [i, c] of [...'\0\0\0\x1cftypavif'].entries()) avif[i] = c.charCodeAt(0);
  for (const [i, c] of [...'ispe'].entries()) avif[40 + i] = c.charCodeAt(0);
  avif[51] = 64; avif[55] = 48;
  assert.deepEqual(sniffImage(avif), { format: 'avif', mime: 'image/avif', extension: 'avif', width: 64, height: 48 });

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
  assert.deepEqual(sniffImage(jpeg), { format: 'jpeg', mime: 'image/jpeg', extension: 'jpg', width: 640, height: 480 });
  assert.equal(sniffImage(jpeg.subarray(0, 20))?.truncated, true, 'JPEG without EOI is flagged');
});

test('non-images: sniffOther names PDF/ZIP/gzip, isPlainText rejects control bytes', () => {
  assert.equal(sniffOther(new TextEncoder().encode('%PDF-1.7'))?.extension, 'pdf');
  assert.equal(sniffOther(new Uint8Array([0x1f, 0x8b, 8, 0]))?.extension, 'gz');
  assert.equal(sniffOther(sampleBytes), null);
  assert.equal(isPlainText(new TextEncoder().encode('hello\n\tworld')), true);
  assert.equal(isPlainText(sampleBytes), false);
  assert.equal(isPlainText(new Uint8Array(0)), false);
});

// ---- image → Base64 --------------------------------------------------------------

test('encodes the sample to raw Base64, a data URI, an <img> with dimensions and a CSS declaration', () => {
  const r = imageToBase64(sampleBytes);
  assert.ok(r.ok);
  const e = r.value;
  assert.equal(e.base64, SAMPLE_PNG_BASE64);
  assert.equal(e.dataUri, SAMPLE_PNG_DATA_URI);
  assert.equal(e.html, `<img src="${SAMPLE_PNG_DATA_URI}" alt="" width="32" height="32">`);
  assert.equal(e.css, `background-image: url("${SAMPLE_PNG_DATA_URI}");`);
  assert.equal(e.bytes, 157);
  assert.equal(e.base64Length, 212);
});

test('encoding uses the sniffed type, and refuses empty or non-image files with a reason', () => {
  const svg = imageToBase64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.ok(svg.ok && svg.value.dataUri.startsWith('data:image/svg+xml;base64,'));
  assert.ok(svg.ok && svg.value.html === `<img src="${svg.value.dataUri}" alt="">`, 'no width/height attributes when the size is unknown');
  assert.deepEqual(imageToBase64(new Uint8Array(0)), { ok: false, error: 'The file is empty.' });
  assert.deepEqual(imageToBase64(new TextEncoder().encode('%PDF-1.4')), { ok: false, error: 'This file is a PDF, so a browser would not display it.' });
  assert.deepEqual(imageToBase64(new TextEncoder().encode('hello')), { ok: false, error: 'This file is not a PNG, JPEG, GIF, WebP, SVG, BMP, ICO or AVIF image, so a browser would not display it.' });
});

test('round trip: encode → decode gives the original bytes, and multi-megabyte input stays fast', () => {
  const big = new Uint8Array(3 * 1024 * 1024);
  big.set(sampleBytes);
  const t0 = performance.now();
  const enc = imageToBase64(big);
  assert.ok(enc.ok);
  const dec = base64ToImage(enc.value.dataUri);
  assert.ok(dec.ok);
  assert.ok(performance.now() - t0 < 2000, 'encode + decode of 3 MB under 2 s');
  assert.equal(dec.value.bytes.length, big.length);
  assert.equal(dec.value.info.truncated, true, 'zero-padded past the IEND, so the trailer check trips — the header still reads as 32×32');
  assert.ok(base64ToBytes('A'.repeat(4 * 1024 * 1024)).ok);
});

test('formatBytes', () => {
  assert.equal(formatBytes(157), '157 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(20 * 1024), '20 KB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
});
