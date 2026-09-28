import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonToSql, sqlType, SAMPLE_JSON_SQL, INSERT_DIALECTS, type InsertDialect, type JsonSqlOptions } from '../src/lib/sql-insert.ts';
import { parseExact, stringifyExact, type JsonValue } from '../src/lib/json-exact.ts';
import { tokenize, formatSql } from '../src/lib/sql-format.ts';

const DIALECTS = INSERT_DIALECTS.map((d) => d.value);
const BS = String.fromCharCode(92);
const ok = (r: ReturnType<typeof jsonToSql>) => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r as Extract<ReturnType<typeof jsonToSql>, { ok: true }>;
};
const run = (json: string, opts: Partial<JsonSqlOptions> = {}) => ok(jsonToSql(json, opts));

/** Same read-back as tests/sql-insert.test.ts: each string literal decoded as the database would. */
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

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- The exact JSON reader --------------------------------------------------------------------

/** A JsonValue as a plain JS value, numbers through Number(), to compare with JSON.parse. */
function toPlain(v: JsonValue): unknown {
  switch (v.t) {
    case 'number':
      return Number(v.v);
    case 'null':
      return null;
    case 'array':
      return v.v.map(toPlain);
    case 'object':
      return Object.fromEntries([...v.v].map(([k, x]) => [k, toPlain(x)]));
    default:
      return v.v;
  }
}

// The expected value is built by the generator itself, not by JSON.parse: V8's JSON.parse (Node 24,
// Chrome/Edge 154) decodes an escaped object key wrongly once it has seen an object of the same
// shape with a lone-backslash key there (see the next test), so it cannot be the oracle.
test('parseExact reads 2,000 random documents to exactly the values they were generated from', () => {
  const rand = mulberry32(42);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const STR = ['', 'a', 'é', '名', '😀', '"', BS, '\n', 'x y', String.fromCharCode(0x2028), '\t'];
  const NUM = ['0', '-0', '1', '-12', '3.25', '1e3', '-2.5E-7', '9007199254740993', '12345678901234567890'];
  const gen = (depth: number): { text: string; value: unknown } => {
    const r = rand();
    if (depth > 3 || r < 0.35) {
      const kind = Math.floor(rand() * 3);
      if (kind === 0) {
        const s = pick(STR) + pick(STR);
        return { text: JSON.stringify(s), value: s };
      }
      if (kind === 1) {
        const n = pick(NUM);
        return { text: n, value: Number(n) };
      }
      const lit = pick(['true', 'false', 'null']);
      return { text: lit, value: lit === 'null' ? null : lit === 'true' };
    }
    const ws = () => pick(['', ' ', '\n  ', '\t']);
    const count = Math.floor(rand() * 4);
    if (r < 0.65) {
      const items = Array.from({ length: count }, () => gen(depth + 1));
      return { text: `[${ws()}${items.map((x) => x.text).join(`,${ws()}`)}${ws()}]`, value: items.map((x) => x.value) };
    }
    const value: Record<string, unknown> = {};
    const parts: string[] = [];
    for (let k = 0; k < count; k++) {
      const key = pick(STR) + pick(['k', 'id', '']);
      const child = gen(depth + 1);
      value[key] = child.value; // a repeated key keeps its first position and its last value
      parts.push(`${JSON.stringify(key)}${ws()}:${ws()}${child.text}`);
    }
    return { text: `{${ws()}${parts.join(`,${ws()}`)}${ws()}}`, value };
  };
  for (let n = 0; n < 2000; n++) {
    const { text, value } = gen(0);
    const exact = parseExact(text);
    assert.deepEqual(toPlain(exact), value, text);
    // Compact re-serialisation reads back to the same value, numbers untouched.
    assert.deepEqual(toPlain(parseExact(stringifyExact(exact))), value, text);
  }
  assert.equal(stringifyExact(parseExact('{"id": 9007199254740993, "x": 1.50}')), '{"id":9007199254740993,"x":1.50}');
});

test('parseExact is not affected by the V8 JSON.parse escaped-key bug', () => {
  const Q = '"';
  const shape = `{${Q}k${Q}:1,${Q}${BS}${BS}${Q}:2}`; // {"k": 1, "\\": 2}: a lone-backslash key
  const next = `{${Q}k${Q}:1,${Q}${BS}n${Q}:2}`; // {"k": 1, "\n": 2}: the key is a newline
  JSON.parse(shape);
  parseExact(shape);
  const key = [...(parseExact(next) as Extract<JsonValue, { t: 'object' }>).v.keys()][1];
  assert.equal(key, '\n');
});

test('parseExact: repeated keys keep the first position and the last value, like JSON.parse', () => {
  assert.equal(stringifyExact(parseExact('{"a": 1, "b": 2, "a": 3}')), '{"a":3,"b":2}');
  assert.deepEqual(Object.keys(JSON.parse('{"a": 1, "b": 2, "a": 3}')), ['a', 'b']);
});

test('parseExact: deep nesting does not overflow the call stack', () => {
  const deep = '['.repeat(20000) + ']'.repeat(20000);
  assert.equal(parseExact(deep).t, 'array');
});

// ---- The worked example on the page ---------------------------------------------------------

test('sample: Standard SQL output the page shows', () => {
  const r = run(SAMPLE_JSON_SQL);
  assert.equal(
    r.output,
    [
      'CREATE TABLE my_table (',
      '  id INTEGER,',
      '  name VARCHAR(12),',
      '  email VARCHAR(15),',
      '  active BOOLEAN,',
      '  signup DATE,',
      '  address VARCHAR(31),',
      '  tags VARCHAR(16)',
      ');',
      '',
      'INSERT INTO my_table (id, name, email, active, signup, address, tags) VALUES',
      `  (1, 'Ada Lovelace', 'ada@example.com', TRUE, '2026-01-15', '{"city":"London","zip":"01234"}', '["admin","beta"]'),`,
      `  (2, 'Seán O''Brien', NULL, FALSE, '2026-02-03', '{"city":"Dublin","zip":null}', '[]');`,
    ].join('\n'),
  );
  assert.deepEqual(r.notes, []);
});

test('sample: every dialect has no formatter warnings; flatten gives parent_child columns', () => {
  for (const dialect of DIALECTS) assert.deepEqual(formatSql(run(SAMPLE_JSON_SQL, { dialect }).output, { dialect }).issues, [], dialect);
  const flat = run(SAMPLE_JSON_SQL, { dialect: 'postgresql', flatten: true });
  assert.deepEqual(
    flat.columns.map((c) => `${c.name} ${sqlType(c, 'postgresql')}`),
    ['id INTEGER', 'name TEXT', 'email TEXT', 'active BOOLEAN', 'signup DATE', 'address_city TEXT', 'address_zip TEXT', 'tags JSONB'],
  );
});

// ---- JSON types ------------------------------------------------------------------------------

test('JSON types are respected: a string "42" stays text, null is NULL, "" is an empty string', () => {
  const r = run('[{"n": 42, "s": "42", "z": null, "e": ""}]');
  assert.deepEqual(r.columns.map((c) => c.type), ['integer', 'text', 'empty', 'text']);
  assert.match(r.output, /\(42, '42', NULL, ''\);$/);
});

test('numbers: exact digits past 2^53, exponents become a floating-point column', () => {
  const r = run('[{"id": 9007199254740993, "ratio": 1.5e3}, {"id": 1, "ratio": 2}]');
  assert.deepEqual(r.columns.map((c) => c.type), ['bigint', 'float']);
  assert.match(r.output, /\(9007199254740993, 1\.5e3\)/);
  assert.deepEqual(DIALECTS.map((d) => sqlType(r.columns[1], d)), ['DOUBLE PRECISION', 'DOUBLE', 'DOUBLE PRECISION', 'FLOAT', 'REAL']);
});

test('nested values: JSON column types per dialect', () => {
  const r = run('[{"meta": {"a": 1}}]');
  assert.deepEqual(DIALECTS.map((d) => sqlType(r.columns[0], d)), ['VARCHAR(7)', 'JSON', 'JSONB', 'NVARCHAR(MAX)', 'TEXT']);
});

test('dates are only recognised in strings; Detect types off makes every value text', () => {
  assert.equal(run('[{"d": "2026-01-15"}]').columns[0].type, 'date');
  const off = run('[{"n": 1, "b": true, "o": {"x": 1}, "z": null}]', { detectTypes: false, createTable: false });
  assert.match(off.output, /\('1', 'true', '\{"x":1\}', NULL\);$/);
});

// ---- Shapes ----------------------------------------------------------------------------------

test('shapes: a single object, a wrapper object, arrays of arrays, JSON Lines', () => {
  assert.equal(run('{"a": 1}').rows, 1);
  const wrapped = run('{"page": 1, "results": [{"a": 1}, {"a": 2}]}');
  assert.equal(wrapped.rows, 2);
  assert.match(wrapped.notes[0], /"results" array/);
  const arrays = run('[[1, "x"], [2]]', { createTable: false });
  assert.match(arrays.output, /\(column_1, column_2\)[\s\S]*\(2, NULL\);$/);
  const lines = run('{"a": 1}\n\n{"a": 2}\n');
  assert.equal(lines.rows, 2);
  assert.match(lines.notes[0], /JSON Lines/);
});

test('columns: the union of keys in first-seen order, missing keys are NULL', () => {
  const r = run('[{"a": 1}, {"b": 2, "a": 3}]', { createTable: false });
  assert.match(r.output, /^INSERT INTO my_table \(a, b\) VALUES\n {2}\(1, NULL\),\n {2}\(3, 2\);$/);
});

test('flatten: nested paths joined with _, name clashes renamed, arrays stay JSON', () => {
  const r = run('[{"user": {"name": "x", "tags": [1]}, "user_name": "y"}]', { flatten: true, createTable: false });
  assert.deepEqual(r.columns.map((c) => c.name), ['user_name', 'user_tags', 'user_name_2']);
  assert.equal(r.notes.length, 1);
  assert.match(r.output, /\('x', '\[1\]', 'y'\);$/);
});

test('errors: invalid JSON with a position, empty array, scalar, mixed items', () => {
  const invalid = jsonToSql('[{"a": 1},]');
  assert.equal(invalid.ok, false);
  assert.equal((invalid as { line?: number }).line, 1);
  assert.deepEqual(jsonToSql('[]'), { ok: false, error: 'The array is empty, so there are no rows to insert.' });
  assert.match((jsonToSql('42') as { error: string }).error, /is a number, not an object/);
  assert.match((jsonToSql('[{"a": 1}, "x"]') as { error: string }).error, /^Item 2 is a string/);
  assert.deepEqual(jsonToSql(' '), { ok: false, error: 'Paste JSON to convert.' });
});

// ---- Escaping, fuzzed ---------------------------------------------------------------------

const PIECES = ['a', ' ', "'", '"', BS, BS + 'n', '\n', '%', '--', '/*', '$$', '`', ']', 'é', '😀', '?', '@v'];

test('fuzz: hostile strings, top-level and inside nested JSON, read back exactly in every dialect', () => {
  const rand = mulberry32(99);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const str = () => {
    let s = 'v';
    for (let k = Math.floor(rand() * 6); k > 0; k--) s += pick(PIECES);
    return s;
  };
  for (const dialect of DIALECTS) {
    for (let n = 0; n < 500; n++) {
      const rows = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ s: str(), nested: { k: str(), list: [str()] } }));
      const r = run(JSON.stringify(rows), { dialect, createTable: false, batchSize: pick([1, 0]) });
      const expected = rows.flatMap((row) => [row.s, JSON.stringify(row.nested)]);
      assert.deepEqual(insertedStrings(r.output, dialect), expected, `${dialect}\n${r.output}`);
    }
  }
});

test('SQLite: the sample and hostile nested JSON run and read back unchanged', async (t) => {
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(':memory:');
  } catch {
    return t.skip('node:sqlite is not available in this Node version');
  }
  db.exec(run(SAMPLE_JSON_SQL, { dialect: 'sqlite' }).output);
  const rows = (db.prepare('SELECT * FROM my_table ORDER BY id').all() as Record<string, unknown>[]).map((r) => ({ ...r }));
  assert.deepEqual(rows[1], { id: 2, name: "Seán O'Brien", email: null, active: 0, signup: '2026-02-03', address: '{"city":"Dublin","zip":null}', tags: '[]' });
  // JSON stored as text comes back as the same JSON.
  const value = { quote: "it's", slash: `C:${BS}temp`, nl: 'a\nb', emoji: '😀' };
  db.exec(run(JSON.stringify([{ id: 1, doc: value }]), { dialect: 'sqlite', tableName: 't2' }).output);
  const back = db.prepare('SELECT doc FROM t2').get() as { doc: string };
  assert.deepEqual(JSON.parse(back.doc), value);
});
