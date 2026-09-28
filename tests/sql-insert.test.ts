import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvToSql,
  quoteIdent,
  quoteTable,
  snakeCase,
  stringLiteral,
  sqlType,
  SAMPLE_CSV_SQL,
  INSERT_DIALECTS,
  SQLSERVER_MAX_ROWS,
  type InsertDialect,
  type CsvSqlOptions,
} from '../src/lib/sql-insert.ts';
import { tokenize, formatSql } from '../src/lib/sql-format.ts';

const DIALECTS = INSERT_DIALECTS.map((d) => d.value);
const BS = String.fromCharCode(92); // a backslash, spelled out so no tool can reinterpret it
const ok = (r: ReturnType<typeof csvToSql>) => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r as Extract<ReturnType<typeof csvToSql>, { ok: true }>;
};

/** A CSV line per RFC 4180: quote a cell that holds a comma, a quote or a line break. */
const csvLine = (cells: string[]) => cells.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');

/** A string literal from the formatter's tokenizer, decoded the way the database would read it. */
function decode(text: string, dialect: InsertDialect): string {
  let s = text;
  if (dialect === 'sqlserver' && s.startsWith('N')) s = s.slice(1);
  s = s.slice(1, -1);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (dialect === 'mysql' && s[i] === BS) { out += s[++i]; continue; }
    if (s[i] === "'" && s[i + 1] === "'") { out += "'"; i++; continue; }
    out += s[i];
  }
  return out;
}

/** Every string value in the INSERT statements, read back through the dialect's own tokenizer. */
function insertedStrings(sql: string, dialect: InsertDialect): string[] {
  const tokens = tokenize(sql, dialect);
  assert.ok(!tokens.some((t) => t.unterminated), `unterminated token in:\n${sql}`);
  const values: string[] = [];
  let inValues = false;
  for (const t of tokens) {
    if (t.type === 'word' && t.text.toUpperCase() === 'VALUES') inValues = true;
    else if (t.type === 'semicolon') inValues = false;
    else if (inValues && t.type === 'string') values.push(decode(t.text, dialect));
  }
  return values;
}

// ---- The worked example on the page ---------------------------------------------------------

test('sample: Standard SQL output the page shows', () => {
  const r = ok(csvToSql(SAMPLE_CSV_SQL));
  assert.equal(
    r.output,
    [
      'CREATE TABLE my_table (',
      '  id INTEGER,',
      '  name VARCHAR(12),',
      '  city VARCHAR(15),',
      '  zip VARCHAR(5),',
      '  signup_date DATE,',
      '  active BOOLEAN,',
      '  balance DECIMAL(6, 2)',
      ');',
      '',
      'INSERT INTO my_table (id, name, city, zip, signup_date, active, balance) VALUES',
      "  (1, 'Ada Lovelace', 'London', '01234', '2026-01-15', TRUE, 1250.50),",
      "  (2, 'Seán O''Brien', 'Dublin, Ireland', NULL, '2026-02-03', FALSE, 0),",
      "  (3, 'Grace Hopper', 'New York', '10001', '2026-03-21', TRUE, NULL);",
    ].join('\n'),
  );
  assert.equal(r.rows, 3);
  assert.equal(r.statements, 2);
  assert.deepEqual(r.notes, []);
});

test('every dialect: the generated SQL has no formatter warnings and the sample strings read back exactly', () => {
  for (const dialect of DIALECTS) {
    const r = ok(csvToSql(SAMPLE_CSV_SQL, { dialect }));
    assert.deepEqual(formatSql(r.output, { dialect }).issues, [], dialect);
    assert.deepEqual(
      insertedStrings(r.output, dialect).filter((s) => !/^\d{4}-/.test(s)),
      ['Ada Lovelace', 'London', '01234', "Seán O'Brien", 'Dublin, Ireland', 'Grace Hopper', 'New York', '10001'],
      dialect,
    );
  }
});

// ---- Real execution: the SQLite output runs in SQLite ----------------------------------------

async function sqlite() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(':memory:');
  } catch {
    return null;
  }
}

test('SQLite: the sample runs and every value reads back with the right type', async (t) => {
  const db = await sqlite();
  if (!db) return t.skip('node:sqlite is not available in this Node version');
  db.exec(ok(csvToSql(SAMPLE_CSV_SQL, { dialect: 'sqlite' })).output);
  const rows = db.prepare('SELECT * FROM my_table ORDER BY id').all() as Record<string, unknown>[];
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { id: 1, name: 'Ada Lovelace', city: 'London', zip: '01234', signup_date: '2026-01-15', active: 1, balance: 1250.5 },
      { id: 2, name: "Seán O'Brien", city: 'Dublin, Ireland', zip: null, signup_date: '2026-02-03', active: 0, balance: 0 },
      { id: 3, name: 'Grace Hopper', city: 'New York', zip: '10001', signup_date: '2026-03-21', active: 1, balance: null },
    ],
  );
});

// ---- Fuzz: hostile text survives every dialect's escaping ------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PIECES = [
  'a', 'Z', '0', '7', ' ', "'", "''", '"', BS, BS + BS, BS + "'", BS + 'n', ',', ';', '\n', '\t', '%', '_',
  '--', '/*', '*/', '#', '$$', '[', ']', '`', 'é', '名', '😀', 'N', 'O', '?', ':x', '@v',
];

test('fuzz: 1,000 random CSVs per dialect, text cells read back byte for byte through the tokenizer', () => {
  const rand = mulberry32(20260928);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  for (const dialect of DIALECTS) {
    for (let n = 0; n < 1000; n++) {
      const width = 1 + Math.floor(rand() * 4);
      const rows: string[][] = [];
      for (let r = 0; r < 1 + Math.floor(rand() * 4); r++) {
        const row: string[] = [];
        for (let c = 0; c < width; c++) {
          let cell = 'v'; // never empty and never a number, so every cell is a text literal
          for (let k = Math.floor(rand() * 6); k > 0; k--) cell += pick(PIECES);
          row.push(cell);
        }
        rows.push(row);
      }
      const header = Array.from({ length: width }, (_, i) => `c${i}`);
      const csv = [header, ...rows].map(csvLine).join('\n');
      const r = ok(csvToSql(csv, { dialect, detectTypes: false, batchSize: pick([1, 2, 0]) }));
      assert.deepEqual(insertedStrings(r.output, dialect), rows.flat(), `${dialect}\nCSV: ${JSON.stringify(csv)}\nSQL: ${r.output}`);
    }
  }
});

test('fuzz: the same hostile text inserted into real SQLite comes back unchanged', async (t) => {
  const db = await sqlite();
  if (!db) return t.skip('node:sqlite is not available in this Node version');
  const rand = mulberry32(7);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  for (let n = 0; n < 300; n++) {
    const rows = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => {
        let cell = 'v';
        for (let k = Math.floor(rand() * 8); k > 0; k--) cell += pick(PIECES);
        return cell;
      }),
    );
    const csv = [['a', 'b', 'c'], ...rows].map(csvLine).join('\n');
    const r = ok(csvToSql(csv, { dialect: 'sqlite', tableName: `t${n}`, detectTypes: false }));
    db.exec(r.output);
    const back: string[][] = (db.prepare(`SELECT a, b, c FROM t${n} ORDER BY rowid`).all() as Record<string, string>[]).map((x) => [x.a, x.b, x.c]);
    assert.deepEqual(back, rows, `CSV: ${JSON.stringify(csv)}`);
  }
});

// ---- Types ------------------------------------------------------------------------------------

const typesOf = (csv: string, opts: Partial<CsvSqlOptions> = {}) => ok(csvToSql(csv, opts)).columns.map((c) => c.type);

test('types: the narrowest type every value fits', () => {
  assert.deepEqual(typesOf('a,b,c,d\n1,1.5,true,2026-01-31\n-2,10,FALSE,2026-02-28'), ['integer', 'decimal', 'boolean', 'date']);
  assert.deepEqual(typesOf('big\n3000000000'), ['bigint']);
  assert.deepEqual(typesOf('huge\n92233720368547758070'), ['decimal']);
  assert.deepEqual(typesOf('ts\n2026-01-31 23:59:59\n2026-02-01'), ['datetime']);
  assert.deepEqual(typesOf('mixed\n1\nabc'), ['text']);
  assert.deepEqual(typesOf('blank,x\n,1\n,2'), ['empty', 'integer']);
});

test('types: values that look numeric but are not numbers stay text', () => {
  // leading zero (ZIP codes, phone numbers), thousands separator, exponent, plus sign
  for (const v of ['01234', '1,234', '1e5', '+5', ' 42']) assert.deepEqual(typesOf(`x\n${csvLine([v])}`), ['text'], v);
  // not a real calendar date
  assert.deepEqual(typesOf('d\n2026-02-30'), ['text']);
  assert.deepEqual(typesOf('d\n2026-13-01'), ['text']);
});

test('types: DECIMAL precision and scale cover every value', () => {
  const r = ok(csvToSql('p\n1234.5\n0.125\n-99'));
  assert.equal(sqlType(r.columns[0], 'standard'), 'DECIMAL(7, 3)');
  assert.equal(sqlType(r.columns[0], 'postgresql'), 'NUMERIC(7, 3)');
  assert.equal(sqlType(r.columns[0], 'sqlite'), 'NUMERIC');
});

test('integers past 2^53 are written digit for digit (no float rounding)', () => {
  const r = ok(csvToSql('id\n9007199254740993', { createTable: false }));
  assert.match(r.output, /\(9007199254740993\)/);
});

test('type names per dialect', () => {
  const r = ok(csvToSql('b,t,s\ntrue,2026-01-01 10:00:00,hello'));
  const [b, t, s] = r.columns;
  assert.deepEqual(DIALECTS.map((d) => sqlType(b, d)), ['BOOLEAN', 'BOOLEAN', 'BOOLEAN', 'BIT', 'INTEGER']);
  assert.deepEqual(DIALECTS.map((d) => sqlType(t, d)), ['TIMESTAMP', 'DATETIME', 'TIMESTAMP', 'DATETIME2', 'TEXT']);
  assert.deepEqual(DIALECTS.map((d) => sqlType(s, d)), ['VARCHAR(5)', 'VARCHAR(5)', 'TEXT', 'NVARCHAR(5)', 'TEXT']);
});

test('text length: SQL Server counts UTF-16 units, the others count characters', () => {
  const csv = 'e\nab😀';
  assert.equal(sqlType(ok(csvToSql(csv, { dialect: 'sqlserver' })).columns[0], 'sqlserver'), 'NVARCHAR(4)');
  assert.equal(sqlType(ok(csvToSql(csv, { dialect: 'mysql' })).columns[0], 'mysql'), 'VARCHAR(3)');
});

test('Detect types off: every value is quoted text', () => {
  const r = ok(csvToSql('n,b\n1,true', { detectTypes: false, createTable: false }));
  assert.match(r.output, /\('1', 'true'\);$/);
});

// ---- Values and escaping ----------------------------------------------------------------------

test('string literals: quote doubling everywhere, backslash doubling in MySQL only, N prefix in SQL Server', () => {
  const v = `C:${BS}temp it's`;
  assert.equal(stringLiteral(v, 'mysql'), `'C:${BS}${BS}temp it''s'`);
  assert.equal(stringLiteral(v, 'postgresql'), `'C:${BS}temp it''s'`);
  assert.equal(stringLiteral(v, 'sqlserver'), `N'C:${BS}temp it''s'`);
});

test('booleans: TRUE/FALSE, or 1/0 in SQL Server and SQLite', () => {
  const out = (d: InsertDialect) => ok(csvToSql('b\nTrue\nfalse', { dialect: d, createTable: false })).output;
  assert.match(out('postgresql'), /\(TRUE\),\n  \(FALSE\);/);
  assert.match(out('sqlserver'), /\(1\),\n  \(0\);/);
  assert.match(out('sqlite'), /\(1\),\n  \(0\);/);
});

test('empty cells: NULL by default; the empty-text option only affects text columns', () => {
  const csv = 'name,n\n,\nx,1';
  assert.match(ok(csvToSql(csv, { createTable: false })).output, /\(NULL, NULL\)/);
  assert.match(ok(csvToSql(csv, { createTable: false, emptyAs: 'empty' })).output, /\('', NULL\)/);
  // A column that is empty in every row is created as text, so the option applies to it as well.
  assert.match(ok(csvToSql('blank,n\n,1', { createTable: false, emptyAs: 'empty' })).output, /\('', 1\)/);
});

// ---- Names ----------------------------------------------------------------------------------

test('names are quoted only when they need it, in each dialect style', () => {
  assert.equal(quoteIdent('email', 'mysql'), 'email');
  assert.equal(quoteIdent('First Name', 'mysql'), '`First Name`');
  assert.equal(quoteIdent('order', 'postgresql'), '"order"');
  assert.equal(quoteIdent('a]b', 'sqlserver'), '[a]]b]');
  assert.equal(quoteIdent('say "hi"', 'standard'), '"say ""hi"""');
  assert.equal(quoteIdent('2024_sales', 'sqlite'), '"2024_sales"');
  assert.equal(quoteTable('dbo.user', 'sqlserver'), 'dbo.[user]');
  assert.equal(quoteTable('  ', 'standard'), 'my_table');
  assert.equal(quoteTable('"My Table"', 'postgresql'), '"My Table"');
});

test('snake_case column names', () => {
  assert.equal(snakeCase('First Name'), 'first_name');
  assert.equal(snakeCase('E-mail Address '), 'e_mail_address');
  assert.equal(snakeCase('Seán'), 'sean');
  assert.equal(snakeCase('createdAt'), 'created_at');
  assert.equal(snakeCase('名前'), '名前');
});

test('missing and duplicate header names are filled in and reported', () => {
  const r = ok(csvToSql('email,,Email\na,b,c', { createTable: false }));
  assert.equal(r.columns.map((c) => c.name).join(','), 'email,column_2,Email_2');
  assert.equal(r.notes.length, 2);
});

test('a UTF-8 byte order mark from Excel does not end up in the first column name', () => {
  const r = ok(csvToSql(String.fromCharCode(0xfeff) + 'id\n1'));
  assert.equal(r.columns[0].name, 'id');
});

test('no header row: columns are column_1, column_2 …', () => {
  const r = ok(csvToSql('1,x\n2,y', { hasHeader: false, createTable: false }));
  assert.match(r.output, /^INSERT INTO my_table \(column_1, column_2\) VALUES/);
  assert.equal(r.rows, 2);
});

// ---- Rows and statements ----------------------------------------------------------------------

test('rows per INSERT: one statement per row, batches, or all rows', () => {
  const csv = 'n\n' + Array.from({ length: 5 }, (_, k) => k).join('\n');
  assert.equal(ok(csvToSql(csv, { createTable: false, batchSize: 1 })).statements, 5);
  assert.equal(ok(csvToSql(csv, { createTable: false, batchSize: 2 })).statements, 3);
  assert.equal(ok(csvToSql(csv, { createTable: false, batchSize: 0 })).statements, 1);
  assert.match(ok(csvToSql(csv, { createTable: false, batchSize: 1 })).output, /^INSERT INTO my_table \(n\) VALUES \(0\);\nINSERT/);
});

test('SQL Server: never more than 1,000 rows in one INSERT, with a note', () => {
  const csv = 'n\n' + Array.from({ length: 2500 }, (_, k) => k).join('\n');
  const r = ok(csvToSql(csv, { dialect: 'sqlserver', createTable: false, batchSize: 0 }));
  assert.equal(r.statements, 3);
  assert.equal(r.notes.length, 1);
  const rowsPerStatement = r.output.split(';').filter((s) => s.trim()).map((s) => s.split('\n').filter((l) => l.startsWith('  (')).length);
  assert.deepEqual(rowsPerStatement, [SQLSERVER_MAX_ROWS, SQLSERVER_MAX_ROWS, 500]);
  assert.equal(ok(csvToSql(csv, { dialect: 'postgresql', createTable: false, batchSize: 0 })).statements, 1);
});

test('ragged rows: short rows get NULL, extra values are dropped and reported', () => {
  const r = ok(csvToSql('a,b\n1\n2,3,4\n5,6,7', { createTable: false }));
  assert.match(r.output, /\(1, NULL\)/);
  assert.match(r.output, /\(2, 3\)/);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /2 rows \(the first is row 3\)/);
});

test('errors: empty input, header only', () => {
  assert.deepEqual(csvToSql('  '), { ok: false, error: 'Paste CSV to convert.' });
  assert.deepEqual(csvToSql('a,b', { createTable: false }), { ok: false, error: 'There is a header row but no data rows to insert.' });
  const headerOnly = ok(csvToSql('a,b'));
  assert.match(headerOnly.output, /^CREATE TABLE/);
  assert.equal(headerOnly.statements, 1);
});
