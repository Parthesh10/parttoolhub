/**
 * CSV <-> JSON conversion. Pure, no DOM.
 *
 * CSV parsing follows RFC 4180's quoting rule: a field wrapped in double
 * quotes may contain the delimiter, a line break, or a literal quote written
 * as `""`. Everything else (bare CR, mixed line endings) is normalised
 * rather than rejected, since real-world CSV exports are inconsistent about it.
 */

export type Delimiter = ',' | ';' | '\t';

export type Result = { ok: true; output: string } | { ok: false; error: string };

/** Parse CSV text into raw rows of strings — no header handling, no type inference. */
export function parseCsv(text: string, delimiter: Delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; } // CRLF and bare CR both collapse to the LF that follows (or end of input)
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export interface CsvToJsonOptions {
  delimiter: Delimiter;
  hasHeader: boolean;
  /** "123" -> 123, "true"/"false" -> booleans, "" -> null. Leading-zero numerics ("007") are kept as text. */
  inferTypes: boolean;
  indent: 2 | 4 | 0;
}

const INT_RE = /^-?(0|[1-9]\d*)$/;
const FLOAT_RE = /^-?(0|[1-9]\d*)\.\d+$/;

function coerce(v: string, inferTypes: boolean): unknown {
  if (!inferTypes) return v;
  if (v === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (INT_RE.test(v) || FLOAT_RE.test(v)) return Number(v);
  return v;
}

export function csvToJson(text: string, opts: Partial<CsvToJsonOptions> = {}): Result {
  const o: CsvToJsonOptions = { delimiter: ',', hasHeader: true, inferTypes: true, indent: 2, ...opts };
  if (!text.trim()) return { ok: false, error: 'Paste CSV to convert.' };
  const rows = parseCsv(text, o.delimiter).filter((r) => !(r.length === 1 && r[0] === ''));
  if (!rows.length) return { ok: false, error: 'No rows found.' };

  let value: unknown;
  if (o.hasHeader) {
    const [header, ...dataRows] = rows;
    value = dataRows.map((r) => {
      const obj: Record<string, unknown> = {};
      header.forEach((h, i) => { obj[h] = coerce(r[i] ?? '', o.inferTypes); });
      return obj;
    });
  } else {
    value = rows.map((r) => r.map((cell) => coerce(cell, o.inferTypes)));
  }
  const indent = o.indent === 0 ? undefined : o.indent;
  return { ok: true, output: JSON.stringify(value, null, indent) };
}

export interface JsonToCsvOptions {
  delimiter: Delimiter;
}

function needsQuoting(s: string, delimiter: string): boolean {
  return s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r');
}

function csvCell(v: unknown, delimiter: string): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return needsQuoting(s, delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function jsonToCsv(text: string, opts: Partial<JsonToCsvOptions> = {}): Result {
  const o: JsonToCsvOptions = { delimiter: ',', ...opts };
  if (!text.trim()) return { ok: false, error: 'Paste JSON to convert.' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!Array.isArray(value)) return { ok: false, error: 'The top level must be a JSON array — of objects, or of arrays.' };
  if (!value.length) return { ok: true, output: '' };

  const rows: string[] = [];
  if (value.every((r) => Array.isArray(r))) {
    for (const r of value as unknown[][]) rows.push(r.map((c) => csvCell(c, o.delimiter)).join(o.delimiter));
  } else if (value.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
    const keys: string[] = [];
    for (const obj of value as Record<string, unknown>[]) {
      for (const k of Object.keys(obj)) if (!keys.includes(k)) keys.push(k);
    }
    rows.push(keys.map((k) => csvCell(k, o.delimiter)).join(o.delimiter));
    for (const obj of value as Record<string, unknown>[]) {
      rows.push(keys.map((k) => csvCell(obj[k], o.delimiter)).join(o.delimiter));
    }
  } else {
    return { ok: false, error: 'Every item must be the same shape — all objects, or all arrays, not a mix.' };
  }
  return { ok: true, output: rows.join('\r\n') };
}

export const SAMPLE_CSV = 'name,age,city\nAda Lovelace,28,London\n"Grace Hopper, PhD",85,"New York, NY"';
export const SAMPLE_JSON = JSON.stringify(
  [
    { name: 'Ada Lovelace', age: 28, city: 'London' },
    { name: 'Grace Hopper, PhD', age: 85, city: 'New York, NY' },
  ],
  null,
  2,
);
