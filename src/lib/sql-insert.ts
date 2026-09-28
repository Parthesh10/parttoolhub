/**
 * CSV to SQL: a CREATE TABLE with inferred column types and INSERT statements. Pure, no DOM.
 *
 * The rows go through one builder (`buildSql`) that knows each database's rules, so a JSON front
 * end can reuse it. What differs per dialect:
 * - how a name is quoted when it has to be ("…", `…`, […]);
 * - string literals: ' is doubled everywhere; MySQL also doubles \ because it reads backslash
 *   escapes by default (MySQL manual 11.1.1), so C:\temp would otherwise arrive as C:<tab>emp;
 *   SQL Server text gets the N'…' prefix, without which characters outside the server's code page
 *   become ?;
 * - boolean literals (TRUE/FALSE, or 1/0 where there is no boolean type) and the column type names;
 * - SQL Server accepts at most 1,000 rows in one VALUES list (error 10738).
 */

import { parseCsv, type Delimiter } from './csv-json';
import { parseJson } from './json-parse';
import { parseExact, stringifyExact, type JsonValue } from './json-exact';

export type InsertDialect = 'standard' | 'mysql' | 'postgresql' | 'sqlserver' | 'sqlite';

/** Order and labels as the Dialect select shows them. */
export const INSERT_DIALECTS: { value: InsertDialect; label: string }[] = [
  { value: 'standard', label: 'Standard SQL' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlserver', label: 'SQL Server (T-SQL)' },
  { value: 'sqlite', label: 'SQLite' },
];

export type ColumnType = 'integer' | 'bigint' | 'decimal' | 'float' | 'boolean' | 'date' | 'datetime' | 'json' | 'text' | 'empty';

/**
 * A value whose type is known (from JSON): `v` is its text (a number's source digits, 'true' /
 * 'false', a nested object as compact JSON). A plain string is a CSV cell, whose type is guessed
 * from the text alone.
 */
export interface TypedCell {
  t: 'string' | 'number' | 'boolean' | 'null' | 'json';
  v: string;
}
export type Cell = string | TypedCell;
const cellText = (c: Cell) => (typeof c === 'string' ? c : c.v);

export interface Column {
  /** Name as written into the SQL (already cleaned, not yet quoted). */
  name: string;
  type: ColumnType;
  /** Longest value, in the unit the dialect counts (UTF-16 units for SQL Server, characters elsewhere). */
  maxLength: number;
  /** For decimal: total digits and digits after the point. */
  precision: number;
  scale: number;
}

export interface InsertOptions {
  dialect: InsertDialect;
  tableName: string;
  createTable: boolean;
  /** Rows per INSERT statement; 0 = all rows in one statement (SQL Server: at most 1,000). */
  batchSize: number;
  /** What an empty cell in a text column becomes. Empty cells in number, date and boolean columns are always NULL. */
  emptyAs: 'null' | 'empty';
  /** Detect numbers, booleans and dates; off = every column is text and every value is quoted. */
  detectTypes: boolean;
  /** Rewrite column names as snake_case (First Name -> first_name). */
  snakeCase: boolean;
}

export interface CsvSqlOptions extends InsertOptions {
  delimiter: Delimiter;
  hasHeader: boolean;
}

export const DEFAULT_TABLE = 'my_table';
export const SQLSERVER_MAX_ROWS = 1000;

export const DEFAULT_CSV_SQL: CsvSqlOptions = {
  dialect: 'standard',
  tableName: DEFAULT_TABLE,
  createTable: true,
  batchSize: 100,
  emptyAs: 'null',
  detectTypes: true,
  snakeCase: false,
  delimiter: ',',
  hasHeader: true,
};

export type InsertResult =
  | { ok: true; output: string; rows: number; columns: Column[]; statements: number; notes: string[] }
  | { ok: false; error: string; line?: number; column?: number };

// ---------------------------------------------------------------------------------------------
// Values and types
// ---------------------------------------------------------------------------------------------

const INT_RE = /^-?(0|[1-9]\d*)$/;
const DEC_RE = /^-?(0|[1-9]\d*)\.(\d+)$/;
const BOOL_RE = /^(true|false)$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/;

const INT32_MAX = 2147483647n;
const INT64_MAX = 9223372036854775807n;
/** Widest DECIMAL every supported database accepts (SQL Server's limit). */
const MAX_PRECISION = 38;

function validDate(y: string, m: string, d: string): boolean {
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1) return false;
  const days = new Date(Date.UTC(Number(y), mm, 0)).getUTCDate();
  return dd <= days;
}

type CellKind = 'empty' | 'null' | 'integer' | 'bigint' | 'decimal' | 'float' | 'boolean' | 'date' | 'datetime' | 'json' | 'text';

/** What one cell looks like. Leading zeros (007, 01234) are text: turning them into numbers
 *  would drop real digits from ZIP codes, phone numbers and IDs. */
function cellKind(v: string): { kind: CellKind; intDigits: number; scale: number } {
  if (v === '') return { kind: 'empty', intDigits: 0, scale: 0 };
  if (INT_RE.test(v)) {
    const n = BigInt(v);
    const abs = n < 0n ? -n : n;
    const digits = v.replace('-', '').length;
    if (abs <= INT32_MAX) return { kind: 'integer', intDigits: digits, scale: 0 };
    if (abs <= INT64_MAX) return { kind: 'bigint', intDigits: digits, scale: 0 };
    return { kind: 'decimal', intDigits: digits, scale: 0 };
  }
  const dec = DEC_RE.exec(v);
  if (dec) return { kind: 'decimal', intDigits: dec[1].length, scale: dec[2].length };
  if (BOOL_RE.test(v)) return { kind: 'boolean', intDigits: 0, scale: 0 };
  const d = DATE_RE.exec(v);
  if (d && validDate(d[1], d[2], d[3])) return { kind: 'date', intDigits: 0, scale: 0 };
  const t = DATETIME_RE.exec(v);
  if (t && validDate(t[1], t[2], t[3]) && Number(t[4]) < 24 && Number(t[5]) < 60 && Number(t[6] ?? 0) < 60) {
    return { kind: 'datetime', intDigits: 0, scale: 0 };
  }
  return { kind: 'text', intDigits: 0, scale: 0 };
}

const NONE = { intDigits: 0, scale: 0 };

/** The kind of a CSV cell (guessed from its text) or of a JSON value (its own type, except that a
 *  JSON string is only ever read as a date: "42" in JSON was written as a string on purpose). */
function kindOf(c: Cell, detect: boolean): { kind: CellKind; intDigits: number; scale: number } {
  if (typeof c === 'string') return detect ? cellKind(c) : { kind: c === '' ? 'empty' : 'text', ...NONE };
  if (c.t === 'null') return { kind: 'null', ...NONE };
  if (!detect) return { kind: 'text', ...NONE };
  if (c.t === 'number') {
    const k = cellKind(c.v);
    return k.kind === 'text' ? { kind: 'float', ...NONE } : k; // 1.5e10: an exponent means floating point
  }
  if (c.t === 'boolean') return { kind: 'boolean', ...NONE };
  if (c.t === 'json') return { kind: 'json', ...NONE };
  const k = cellKind(c.v);
  return k.kind === 'date' || k.kind === 'datetime' ? k : { kind: 'text', ...NONE };
}

const NUMERIC_KINDS = new Set<CellKind>(['integer', 'bigint', 'decimal', 'float']);

/** Length the way each database measures VARCHAR / NVARCHAR: SQL Server counts UTF-16 code units,
 *  the others count characters. */
function valueLength(v: string, dialect: InsertDialect): number {
  return dialect === 'sqlserver' ? v.length : [...v].length;
}

/** One column's type from all its values: the narrowest type every non-empty value fits. */
function inferColumn(name: string, values: Cell[], opts: InsertOptions): Column {
  let maxLength = 0;
  for (const v of values) maxLength = Math.max(maxLength, valueLength(cellText(v), opts.dialect));
  const col: Column = { name, type: 'empty', maxLength, precision: 0, scale: 0 };
  const kinds = new Set<CellKind>();
  let intDigits = 0;
  let scale = 0;
  for (const v of values) {
    const k = kindOf(v, opts.detectTypes);
    if (k.kind === 'empty' || k.kind === 'null') continue;
    kinds.add(k.kind);
    intDigits = Math.max(intDigits, k.intDigits);
    scale = Math.max(scale, k.scale);
  }
  if (kinds.size === 0) return col;
  if ([...kinds].every((k) => NUMERIC_KINDS.has(k))) {
    if (kinds.has('float')) col.type = 'float';
    else if (kinds.has('decimal')) {
      const precision = Math.max(1, intDigits + scale);
      if (precision > MAX_PRECISION) {
        col.type = 'text';
        return col;
      }
      col.type = 'decimal';
      col.precision = precision;
      col.scale = scale;
    } else col.type = kinds.has('bigint') ? 'bigint' : 'integer';
    return col;
  }
  if (kinds.size === 1 && kinds.has('boolean')) col.type = 'boolean';
  else if (kinds.size === 1 && kinds.has('json')) col.type = 'json';
  else if ([...kinds].every((k) => k === 'date' || k === 'datetime')) col.type = kinds.has('datetime') ? 'datetime' : 'date';
  else col.type = 'text';
  return col;
}

export function sqlType(col: Column, dialect: InsertDialect): string {
  const n = Math.max(1, col.maxLength);
  switch (col.type) {
    case 'integer':
      return { standard: 'INTEGER', mysql: 'INT', postgresql: 'INTEGER', sqlserver: 'INT', sqlite: 'INTEGER' }[dialect];
    case 'bigint':
      return dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
    case 'decimal':
      if (dialect === 'sqlite') return 'NUMERIC';
      return `${dialect === 'postgresql' ? 'NUMERIC' : 'DECIMAL'}(${col.precision}, ${col.scale})`;
    case 'float':
      return { standard: 'DOUBLE PRECISION', mysql: 'DOUBLE', postgresql: 'DOUBLE PRECISION', sqlserver: 'FLOAT', sqlite: 'REAL' }[dialect];
    case 'json':
      if (dialect === 'mysql') return 'JSON';
      if (dialect === 'postgresql') return 'JSONB';
      if (dialect === 'sqlserver') return 'NVARCHAR(MAX)';
      if (dialect === 'sqlite') return 'TEXT';
      return `VARCHAR(${n})`;
    case 'boolean':
      return { standard: 'BOOLEAN', mysql: 'BOOLEAN', postgresql: 'BOOLEAN', sqlserver: 'BIT', sqlite: 'INTEGER' }[dialect];
    case 'date':
      return dialect === 'sqlite' ? 'TEXT' : 'DATE';
    case 'datetime':
      return { standard: 'TIMESTAMP', mysql: 'DATETIME', postgresql: 'TIMESTAMP', sqlserver: 'DATETIME2', sqlite: 'TEXT' }[dialect];
    case 'empty':
      return { standard: 'VARCHAR(255)', mysql: 'VARCHAR(255)', postgresql: 'TEXT', sqlserver: 'NVARCHAR(255)', sqlite: 'TEXT' }[dialect];
    case 'text':
      if (dialect === 'postgresql' || dialect === 'sqlite') return 'TEXT';
      if (dialect === 'sqlserver') return n <= 4000 ? `NVARCHAR(${n})` : 'NVARCHAR(MAX)';
      if (dialect === 'mysql') return n <= 2000 ? `VARCHAR(${n})` : n <= 16000 ? 'TEXT' : 'MEDIUMTEXT';
      return `VARCHAR(${n})`;
  }
}

/** A text value as a string literal in this dialect. */
export function stringLiteral(v: string, dialect: InsertDialect): string {
  let s = v;
  if (dialect === 'mysql') s = s.replace(/\\/g, '\\\\');
  s = s.replace(/'/g, "''");
  return dialect === 'sqlserver' ? `N'${s}'` : `'${s}'`;
}

function literal(c: Cell, col: Column, opts: InsertOptions): string {
  if (typeof c !== 'string') {
    // A JSON null is NULL; a JSON "" is a real empty string, whatever "Empty text cells" says.
    return c.t === 'null' ? 'NULL' : valueLiteral(c.v, col, opts);
  }
  // A column with no values at all is created as text, so the text rule applies to it too.
  if (c === '') return (col.type === 'text' || col.type === 'empty') && opts.emptyAs === 'empty' ? stringLiteral('', opts.dialect) : 'NULL';
  return valueLiteral(c, col, opts);
}

function valueLiteral(v: string, col: Column, opts: InsertOptions): string {
  switch (col.type) {
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
      return v; // the digits as written: no float rounding, even past 2^53
    case 'boolean': {
      const t = v.toLowerCase() === 'true';
      return opts.dialect === 'sqlserver' || opts.dialect === 'sqlite' ? (t ? '1' : '0') : t ? 'TRUE' : 'FALSE';
    }
    case 'date':
    case 'datetime':
      return `'${v}'`;
    default:
      return stringLiteral(v, opts.dialect);
  }
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** Words that must be quoted as a table or column name in at least one of the five databases. */
const RESERVED = new Set(
  `add all alter and any as asc between both by case cast check collate column constraint create cross
  current current_date current_time current_timestamp current_user database default delete desc distinct
  drop else end except exists false fetch for foreign from full function grant group having if in index
  inner insert intersect interval into is join key left like limit natural not null of offset on or order
  outer over partition percent primary procedure range references right row rows select session_user set
  some table then to top trigger true union unique update user using values view when where window with`
    .trim()
    .split(/\s+/),
);

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdent(name: string, dialect: InsertDialect): string {
  if (PLAIN_NAME.test(name) && !RESERVED.has(name.toLowerCase())) return name;
  if (dialect === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (dialect === 'sqlserver') return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

/** A table name as typed: schema.table is split on the dot; a part already in quotes is kept. */
export function quoteTable(raw: string, dialect: InsertDialect): string {
  const name = raw.trim() || DEFAULT_TABLE;
  if (/^["`[]/.test(name)) return name;
  return name
    .split('.')
    .map((p) => quoteIdent(p.trim(), dialect))
    .join('.');
}

export function snakeCase(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

/** Clean, fill in and de-duplicate column names; each change is reported in `notes`. */
function columnNames(header: string[], width: number, opts: InsertOptions, notes: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < width; i++) {
    let name = (header[i] ?? '').trim();
    if (opts.snakeCase) name = snakeCase(name);
    if (!name) {
      name = `column_${i + 1}`;
      if (header.length) notes.push(`Column ${i + 1} has no name; it is called ${name}.`);
    }
    let unique = name;
    for (let k = 2; seen.has(unique.toLowerCase()); k++) unique = `${name}_${k}`;
    if (unique !== name) notes.push(`Two columns are called ${name}; the later one is called ${unique}.`);
    seen.add(unique.toLowerCase());
    names.push(unique);
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

/** CREATE TABLE and INSERT statements for rows of text cells under the given column names. */
export function buildSql(names: string[], rows: Cell[][], opts: InsertOptions, notes: string[] = []): InsertResult {
  const table = quoteTable(opts.tableName, opts.dialect);
  const columns = names.map((name, i) =>
    inferColumn(
      name,
      rows.map((r) => r[i] ?? ''),
      opts,
    ),
  );
  const quoted = columns.map((c) => quoteIdent(c.name, opts.dialect));
  const parts: string[] = [];
  let statements = 0;

  if (opts.createTable) {
    const defs = columns.map((c, i) => `  ${quoted[i]} ${sqlType(c, opts.dialect)}`);
    parts.push(`CREATE TABLE ${table} (\n${defs.join(',\n')}\n);`);
    statements++;
  }

  let batch = opts.batchSize > 0 ? opts.batchSize : rows.length;
  if (opts.dialect === 'sqlserver' && batch > SQLSERVER_MAX_ROWS) {
    batch = SQLSERVER_MAX_ROWS;
    notes.push(`SQL Server accepts at most ${SQLSERVER_MAX_ROWS.toLocaleString('en-US')} rows in one INSERT, so the rows are split into statements of ${SQLSERVER_MAX_ROWS.toLocaleString('en-US')}.`);
  }
  const head = `INSERT INTO ${table} (${quoted.join(', ')}) VALUES`;
  const tuple = (r: Cell[]) => `(${columns.map((c, i) => literal(r[i] ?? '', c, opts)).join(', ')})`;
  const inserts: string[] = [];
  if (batch === 1) {
    for (const r of rows) inserts.push(`${head} ${tuple(r)};`);
    if (rows.length) parts.push(inserts.join('\n'));
  } else {
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch).map((r) => `  ${tuple(r)}`);
      inserts.push(`${head}\n${chunk.join(',\n')};`);
    }
    if (inserts.length) parts.push(inserts.join('\n\n'));
  }
  statements += inserts.length;
  return { ok: true, output: parts.join('\n\n'), rows: rows.length, columns, statements, notes };
}

const BOM = String.fromCharCode(0xfeff);

export function csvToSql(text: string, options: Partial<CsvSqlOptions> = {}): InsertResult {
  const o: CsvSqlOptions = { ...DEFAULT_CSV_SQL, ...options };
  if (!text.trim()) return { ok: false, error: 'Paste CSV to convert.' };
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  const all = parseCsv(clean, o.delimiter).filter((r) => !(r.length === 1 && r[0] === ''));
  if (!all.length) return { ok: false, error: 'No rows found.' };

  const header = o.hasHeader ? all[0] : [];
  const rows = o.hasHeader ? all.slice(1) : all;
  const width = o.hasHeader ? header.length : Math.max(...rows.map((r) => r.length));
  const notes: string[] = [];
  const names = columnNames(header, width, o, notes);

  const longer = rows.map((r, i) => (r.length > width ? i : -1)).filter((i) => i >= 0);
  if (longer.length) {
    const first = longer[0] + (o.hasHeader ? 2 : 1);
    notes.push(
      `${longer.length === 1 ? `Row ${first} has` : `${longer.length.toLocaleString('en-US')} rows (the first is row ${first}) have`} more values than there are columns; the extra values are left out.`,
    );
  }
  if (!rows.length) {
    if (!o.createTable) return { ok: false, error: 'There is a header row but no data rows to insert.' };
    notes.push('There is a header row but no data rows, so there is nothing to insert.');
  }
  return buildSql(names, rows, o, notes);
}

// ---------------------------------------------------------------------------------------------
// JSON front end
// ---------------------------------------------------------------------------------------------

export interface JsonSqlOptions extends InsertOptions {
  /** Expand nested objects into parent_child columns instead of storing them as JSON text. */
  flatten: boolean;
}

export const DEFAULT_JSON_SQL: JsonSqlOptions = {
  dialect: 'standard',
  tableName: DEFAULT_TABLE,
  createTable: true,
  batchSize: 100,
  emptyAs: 'null', // unused for JSON: null and "" are different values there
  detectTypes: true,
  snakeCase: false,
  flatten: false,
};

const NULL_CELL: TypedCell = { t: 'null', v: '' };

function toCell(v: JsonValue): TypedCell {
  switch (v.t) {
    case 'string':
      return { t: 'string', v: v.v };
    case 'number':
      return { t: 'number', v: v.v };
    case 'boolean':
      return { t: 'boolean', v: String(v.v) };
    case 'null':
      return NULL_CELL;
    default:
      return { t: 'json', v: stringifyExact(v) };
  }
}

function describe(v: JsonValue): string {
  return { string: 'a string', number: 'a number', boolean: 'true or false', null: 'null', array: 'an array', object: 'an object' }[v.t];
}

/**
 * JSON to SQL. Accepts an array of objects (one row each), an array of arrays, a single object, an
 * object that wraps the rows in an array property ({"data": [...]}), or JSON Lines.
 */
export function jsonToSql(text: string, options: Partial<JsonSqlOptions> = {}): InsertResult {
  const o: JsonSqlOptions = { ...DEFAULT_JSON_SQL, ...options };
  if (!text.trim()) return { ok: false, error: 'Paste JSON to convert.' };
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  const notes: string[] = [];
  try {
    let root: JsonValue;
    const parsed = parseJson(clean, 'Paste JSON to convert.');
    if (parsed.ok) root = parseExact(clean);
    else {
      const lines = clean.split('\n').filter((l) => l.trim());
      if (lines.length > 1 && lines.every((l) => parseJson(l, '').ok)) {
        root = { t: 'array', v: lines.map((l) => parseExact(l)) };
        notes.push('Read as JSON Lines: one JSON value per line.');
      } else return { ok: false, error: parsed.error, line: parsed.line, column: parsed.column };
    }

    let items: JsonValue[];
    if (root.t === 'array') items = root.v;
    else if (root.t === 'object') {
      const inner = [...root.v].find(([, v]) => v.t === 'array' && v.v.length > 0 && v.v.every((x) => x.t === 'object'));
      if (inner) {
        items = (inner[1] as Extract<JsonValue, { t: 'array' }>).v;
        notes.push(`The rows come from the "${inner[0]}" array inside the object.`);
      } else items = [root];
    } else return { ok: false, error: `The JSON is ${describe(root)}, not an object or an array of objects.` };

    if (!items.length) return { ok: false, error: 'The array is empty, so there are no rows to insert.' };

    if (items.every((x) => x.t === 'array')) {
      const arrays = items as Extract<JsonValue, { t: 'array' }>[];
      const width = Math.max(...arrays.map((a) => a.v.length));
      const names = columnNames([], width, o, notes);
      const rows = arrays.map((a) => Array.from({ length: width }, (_, i) => (a.v[i] ? toCell(a.v[i]) : NULL_CELL)));
      return buildSql(names, rows, o, notes);
    }
    const bad = items.findIndex((x) => x.t !== 'object');
    if (bad >= 0) {
      return {
        ok: false,
        error: `Item ${bad + 1} is ${describe(items[bad])}, not an object. Each item becomes one row, so every item must be an object (or every item an array).`,
      };
    }

    // Columns: every key path, in the order it first appears.
    const objects = items.map((x) => (x as Extract<JsonValue, { t: 'object' }>).v);
    const paths: string[][] = [];
    const seen = new Set<string>();
    const collect = (obj: Map<string, JsonValue>, prefix: string[]) => {
      for (const [k, v] of obj) {
        const path = [...prefix, k];
        if (o.flatten && v.t === 'object' && v.v.size > 0) collect(v.v, path);
        else {
          const key = JSON.stringify(path);
          if (!seen.has(key)) {
            seen.add(key);
            paths.push(path);
          }
        }
      }
    };
    for (const obj of objects) collect(obj, []);

    const cellAt = (obj: Map<string, JsonValue>, path: string[]): TypedCell => {
      let cur: JsonValue | undefined = { t: 'object', v: obj };
      for (const k of path) {
        if (cur?.t !== 'object') return NULL_CELL;
        cur = cur.v.get(k);
      }
      if (!cur) return NULL_CELL;
      // A flattened object's fields have their own columns.
      if (o.flatten && cur.t === 'object' && cur.v.size > 0) return NULL_CELL;
      return toCell(cur);
    };
    const names = columnNames(paths.map((p) => p.join('_')), paths.length, o, notes);
    const rows = objects.map((obj) => paths.map((p) => cellAt(obj, p)));
    return buildSql(names, rows, o, notes);
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: 'The JSON is nested too deeply to convert.' };
    throw e;
  }
}

/** What "Load sample" inserts on the JSON to SQL page, and its worked example. */
export const SAMPLE_JSON_SQL = `[
  {
    "id": 1,
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "active": true,
    "signup": "2026-01-15",
    "address": { "city": "London", "zip": "01234" },
    "tags": ["admin", "beta"]
  },
  {
    "id": 2,
    "name": "Seán O'Brien",
    "email": null,
    "active": false,
    "signup": "2026-02-03",
    "address": { "city": "Dublin", "zip": null },
    "tags": []
  }
]`;

/** What "Load sample" inserts, and the page's worked example. */
export const SAMPLE_CSV_SQL = [
  'id,name,city,zip,signup_date,active,balance',
  '1,Ada Lovelace,London,01234,2026-01-15,true,1250.50',
  `2,Seán O'Brien,"Dublin, Ireland",,2026-02-03,false,0`,
  '3,Grace Hopper,New York,10001,2026-03-21,true,',
].join('\n');
