/**
 * A minimal, dependency-free ZIP writer — just enough to produce a valid
 * .docx (which is a ZIP archive of XML parts). Store-only (no compression):
 * every OOXML reader accepts an uncompressed ZIP member just as readily as a
 * deflated one, and skipping DEFLATE keeps this a few hundred honest lines
 * instead of an unmaintained third-party dependency for a format the site's
 * own rules say to avoid. Pure, no DOM — works identically in the browser
 * and in Node (tests run it there).
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. "word/document.xml". */
  name: string;
  /** UTF-8 text or raw bytes for this entry. */
  data: string | Uint8Array;
}

// ---- CRC-32 (ISO 3309 / ITU-T V.42, the ZIP/PNG/gzip polynomial) ----------

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function toUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** MS-DOS date/time packing ZIP's local/central headers expect (2-second resolution). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

class ByteWriter {
  chunks: Uint8Array[] = [];
  length = 0;
  push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  u16(n: number) {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }
  u32(n: number) {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

/** Builds a valid, store-only ZIP archive from a flat list of entries. */
export function createZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(when);
  const out = new ByteWriter();
  const central = new ByteWriter();
  const offsets: number[] = [];

  for (const entry of entries) {
    const nameBytes = toUtf8(entry.name);
    const data = typeof entry.data === 'string' ? toUtf8(entry.data) : entry.data;
    const crc = crc32(data);

    offsets.push(out.length);
    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed
    out.u16(0x0800); // general purpose flag: UTF-8 filename/comment
    out.u16(0); // compression: store
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(data.length); // compressed size == uncompressed size (store)
    out.u32(data.length);
    out.u16(nameBytes.length);
    out.u16(0); // extra field length
    out.push(nameBytes);
    out.push(data);
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameBytes = toUtf8(entry.name);
    const data = typeof entry.data === 'string' ? toUtf8(entry.data) : entry.data;
    const crc = crc32(data);

    central.u32(0x02014b50); // central directory header signature
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0x0800);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra field length
    central.u16(0); // comment length
    central.u16(0); // disk number start
    central.u16(0); // internal file attributes
    central.u32(0); // external file attributes
    central.u32(offsets[i]); // relative offset of local header
    central.push(nameBytes);
  }

  const centralOffset = out.length;
  const centralSize = central.length;

  const eocd = new ByteWriter();
  eocd.u32(0x06054b50); // end of central directory signature
  eocd.u16(0); // disk number
  eocd.u16(0); // disk with central directory
  eocd.u16(entries.length); // entries on this disk
  eocd.u16(entries.length); // total entries
  eocd.u32(centralSize);
  eocd.u32(centralOffset);
  eocd.u16(0); // comment length

  const final = new ByteWriter();
  final.push(out.toBytes());
  final.push(central.toBytes());
  final.push(eocd.toBytes());
  return final.toBytes();
}
