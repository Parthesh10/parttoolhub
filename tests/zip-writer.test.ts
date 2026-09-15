import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createZip } from '../src/lib/zip-writer.ts';

test('crc32 matches the standard ISO 3309 check values', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal(crc32(enc('')), 0x00000000);
  assert.equal(crc32(enc('123456789')), 0xcbf43926, 'the standard CRC-32 "check" string');
  assert.equal(crc32(enc('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

/**
 * A minimal store-only ZIP reader, used only here to prove createZip's output
 * round-trips through an independent implementation of the format rather than
 * just asserting on createZip's own byte layout (which would only prove the
 * writer agrees with itself, not that a real unzip tool could open the file).
 */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find the End Of Central Directory record by scanning backward for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'End Of Central Directory record not found');
  const total = dv.getUint16(eocd + 10, true);
  const centralOffset = dv.getUint32(eocd + 16, true);

  const out = new Map<string, Uint8Array>();
  let p = centralOffset;
  for (let i = 0; i < total; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, `central directory entry ${i} has a bad signature`);
    const method = dv.getUint16(p + 10, true);
    assert.equal(method, 0, 'entry is not stored (method 0)');
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const uncompSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    assert.equal(dv.getUint32(localOffset, true), 0x04034b50, `local header for "${name}" has a bad signature`);
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    assert.equal(data.length, uncompSize, `"${name}": compressed/uncompressed size mismatch (store mode)`);
    out.set(name, data);
  }
  return out;
}

test('createZip: a single small text entry round-trips byte-for-byte', () => {
  const zip = createZip([{ name: 'hello.txt', data: 'Hello, world!' }]);
  const read = readZip(zip);
  assert.equal(read.size, 1);
  assert.equal(new TextDecoder().decode(read.get('hello.txt')), 'Hello, world!');
});

test('createZip: multiple entries, including nested paths and binary data, all round-trip', () => {
  const binary = new Uint8Array([0, 1, 2, 255, 254, 253, 127, 128]);
  const zip = createZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: '<w:document>Héllo — “quoted” & <escaped></w:document>' },
    { name: 'word/media/blob.bin', data: binary },
  ]);
  const read = readZip(zip);
  assert.equal(read.size, 3);
  assert.equal(new TextDecoder().decode(read.get('[Content_Types].xml')), '<Types/>');
  assert.equal(
    new TextDecoder().decode(read.get('word/document.xml')),
    '<w:document>Héllo — “quoted” & <escaped></w:document>',
    'UTF-8 multi-byte characters survive intact',
  );
  assert.deepEqual([...read.get('word/media/blob.bin')!], [...binary]);
});

test('createZip: an empty file entry is valid (zero-length, not omitted)', () => {
  const zip = createZip([{ name: 'empty.txt', data: '' }]);
  const read = readZip(zip);
  assert.equal(read.get('empty.txt')!.length, 0);
});

test('createZip: entry order in the archive matches the order given', () => {
  const zip = createZip([
    { name: 'a.xml', data: 'A' },
    { name: 'b.xml', data: 'B' },
    { name: 'c.xml', data: 'C' },
  ]);
  const read = readZip(zip);
  assert.deepEqual([...read.keys()], ['a.xml', 'b.xml', 'c.xml']);
});
