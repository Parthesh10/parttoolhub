import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSql,
  minifySql,
  tokenize,
  SAMPLE_SQL,
  DIALECTS,
  type Dialect,
  type FormatOptions,
  type Token,
} from '../src/lib/sql-format.ts';

const ALL_DIALECTS = DIALECTS.map((d) => d.value);
const NBSP = String.fromCharCode(0xa0);

/** Tokens as a comparable list: words compared without case (keyword case may change), line
 *  comments without trailing spaces, everything else exactly. */
function canon(tokens: Token[], dropComments = false): string[] {
  return tokens
    .filter((t) => !dropComments || !(t.type === 'lineComment' || (t.type === 'blockComment' && !/^\/\*[!+]/.test(t.text))))
    .map((t) => `${t.type}:${t.type === 'word' ? t.text.toUpperCase() : t.text}`);
}

function assertPreserved(input: string, opts: Partial<FormatOptions>) {
  const d = opts.dialect ?? 'standard';
  const out = formatSql(input, opts).output;
  assert.deepEqual(canon(tokenize(out, d)), canon(tokenize(input, d)), `format changed tokens (${d})\nIN:  ${input}\nOUT: ${out}`);
  const again = formatSql(out, opts).output;
  assert.equal(again, out, `format is not idempotent (${d})\nIN:  ${input}`);
  const min = minifySql(input, opts).output;
  assert.deepEqual(canon(tokenize(min, d), true), canon(tokenize(input, d), true), `minify changed tokens (${d})\nIN:  ${input}\nOUT: ${min}`);
}

// ---- The worked example on the page ---------------------------------------------------------

test('sample: formats to the layout the page shows', () => {
  const r = formatSql(SAMPLE_SQL);
  assert.equal(
    r.output,
    [
      'SELECT',
      '  o.id,',
      '  c.name AS customer,',
      '  SUM(oi.quantity * oi.unit_price) AS total,',
      '  CASE',
      "    WHEN o.status = 'shipped' THEN 'done'",
      "    ELSE 'open'",
      '  END AS state',
      'FROM',
      '  orders o',
      '  JOIN customers c ON c.id = o.customer_id',
      '  LEFT JOIN order_items oi ON oi.order_id = o.id',
      'WHERE',
      "  o.created_at >= '2026-01-01'",
      "  AND c.country IN ('US', 'CA')",
      'GROUP BY',
      '  o.id,',
      '  c.name,',
      '  o.status',
      'HAVING',
      '  SUM(oi.quantity) > 2',
      'ORDER BY',
      '  total DESC',
      'LIMIT 20;',
    ].join('\n'),
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.statements, 1);
});

// ---- Guarantees: only whitespace and keyword case change; formatting is idempotent ------------

const CORPUS = [
  SAMPLE_SQL,
  "with recent as (select id from orders where created_at > now() - interval '7 days') select * from recent r where r.id in (select id from vip) and exists (select 1 from x where x.id = r.id);",
  "insert into users (id, email) values (1, 'a@x.com'), (2, 'b@x.com'); update users set email = 'c', name = null where id between 1 and 5; delete from t where id = 3;",
  'create table t (id int primary key, date date not null, body text, price decimal(10, 2) default 0, constraint fk foreign key (o) references orgs(id) on delete cascade);',
  'alter table t add column c int, drop column d; drop table if exists old;',
  'select id, row_number() over (partition by a order by b desc) rn, sum(x) over (partition by customer_id order by created_at rows between unbounded preceding and current row) s from p',
  "select case when a = 1 then case when b = 2 then 'x' else 'y' end else 'z' end v, coalesce(case when c then 1 end, 0) from t",
  "-- header\nselect a, -- first\n b /* inline */ from t\n-- before where\nwhere x = 1; -- done\n\n/* block\n   comment */\nselect 2",
  'select -1, a - 1, (-a), x * -1, - -1, +2, ~x from t where a <> b and c != d and e >= -f',
  'select 1 union all select 2 intersect select 3 except select 4',
  "select concat(first_name, ' ', middle_name, ' ', last_name, ' (', email_address, ')') as full_name from people",
  'select * from t where (status = 1 or status = 2 or status = 3 or status = 4 or status = 5) and region = 7',
  'select a from t order by a limit 10 offset 5; select a from t order by a offset 5 rows fetch next 10 rows only',
  "select cast(x as decimal(10, 2)), extract(year from d), x is not null, y not in (1), z like '%a%' escape '!' from t",
  'select distinct a, count(distinct b) from t group by rollup (a, b), grouping sets ((a), (b))',
  'select 1;;select 2;',
  'select a from t where id in (1, -- one\n 2)',
  'select naïve, x from café',
  'SELECT ((((((a))))))',
  'select',
  ')) select ((',
  "select 'unterminated",
];

const DIALECT_CORPUS: Record<Dialect, string[]> = {
  standard: ['select a--comment\nfrom t', "select N'x', X'ff', B'01' from t"],
  mysql: [
    "SELECT balance--1, COUNT (*), `weird``name` FROM `acc` WHERE note = 'it\\'s' AND x = \"dq\" # hash\n AND y = 1",
    'insert into t (id, x) values (1, 2) on duplicate key update x = values(x), y = y + 1',
    'select /*!40001 SQL_NO_CACHE */ /*+ BKA(t) */ a from t',
    'select 1st_col, a---1, a--\n1 from t',
  ],
  postgresql: [
    "SELECT data->>'name', x::int, arr[1:2], $1, E'a\\'b', U&'d0' FROM t WHERE tags @> ARRAY['a'] AND tags ?| array['b'] AND body = $$it's$$ AND f = $fn$x$fn$;",
    'select distinct on (customer_id) customer_id from orders order by customer_id',
    'insert into t (id) values (1) on conflict (id) do update set x = excluded.x returning id',
    '/* outer /* nested */ still comment */ select 1',
  ],
  sqlserver: [
    'SELECT TOP (10) PERCENT WITH TIES [id], [a]]b] FROM [dbo].[users] WITH (NOLOCK) WHERE #t.id = @id AND @@ROWCOUNT > 0\nGO\nSELECT 1',
    "merge into t using s on t.id = s.id when matched then update set t.x = s.x when not matched then insert (id, x) values (s.id, N's');",
    'select datediff(day, a, b) from ##global',
  ],
  sqlite: ['select [a], `b`, "c", $x, :y, ?1, @z from t', "select X'00' from t"],
  bigquery: [
    "SELECT a, b, FROM `proj.ds.tbl` # c\nWHERE x = r'\\d+' AND y = '''multi\nline''' AND z = \"\"\"q\"\"\" AND w = b'x'",
    'select @param, ? from t qualify row_number() over (partition by a order by b) = 1',
  ],
};

for (const d of ALL_DIALECTS) {
  test(`corpus (${d}): tokens preserved and output idempotent for every option combination`, () => {
    for (const sql of [...CORPUS, ...DIALECT_CORPUS[d]]) {
      for (const keywordCase of ['upper', 'lower', 'preserve'] as const) {
        for (const commas of ['end', 'start'] as const) {
          for (const indent of [2, 'tab'] as const) {
            assertPreserved(sql, { dialect: d, keywordCase, commas, indent });
          }
        }
      }
    }
  });
}

// A seeded fuzzer: random soups of SQL fragments joined by random whitespace. Most of the output
// is nonsense SQL, which is the point: it hunts for spacing decisions that glue two tokens into a
// different one (- - into --, 1 . 5 into 1.5, $ $ into $$) and for layout that depends on input
// whitespace.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Every fragment here earned its place: each of the rarer ones once produced a real bug (U& glued
// into a PostgreSQL Unicode string, [w] ] into [w]], < @v into <@, a name called go left alone on
// a line where SQL Server would read it as a batch separator).
const FRAGMENTS = [
  '-', '+', '*', '/', '%', '<', '>', '=', '!', '~', ':', '::', '|', '&', '^', '#', '@', '$', '?', '\\', '{', '}',
  '(', ')', '[', ']', ',', ';', '.', '.5', '1', '1.5', '1e3', '0x1F', '12ab', 'x', 'e', 'N', 'rb', 'a$', 'U&',
  "'s'", "'", '"q"', '"', '`b`', '`', '[w]', "N'n'", "e'y'", '$$d$$', '$t$x$t$', '$1', ':p', '@v', '@@r', '?2', '#t',
  "'''tq'''", "r'raw'", "'e\\'x'",
  'select', 'from', 'where', 'and', 'or', 'between', 'case', 'when', 'then', 'else', 'end', 'in', 'not',
  'values', 'set', 'update', 'join', 'left join', 'on', 'group by', 'order by', 'limit', 'union all', 'top',
  'with', 'as', 'create table', 'alter table', 'add', 'insert into', 'count', 'date', 'extract', 'go', 'GO', 'distinct on',
  '-- c\n', '--\n', '/* b */', '/* multi\nline */', '/*+ h */', '/*! x */', '# h\n',
];
const SPACES = ['', '', '', ' ', ' ', '  ', '\n', '\n', '\t', NBSP, '\r\n'];

test('fuzz: 3,000 random soups per dialect keep their tokens and format idempotently', () => {
  const rand = mulberry32(20260928);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  for (const d of ALL_DIALECTS) {
    for (let n = 0; n < 3000; n++) {
      let sql = '';
      const len = 1 + Math.floor(rand() * 25);
      for (let k = 0; k < len; k++) sql += pick(FRAGMENTS) + pick(SPACES);
      const opts: Partial<FormatOptions> = {
        dialect: d,
        keywordCase: pick(['upper', 'lower', 'preserve'] as const),
        commas: pick(['end', 'start'] as const),
      };
      assertPreserved(sql, opts);
    }
  }
});

// ---- Dialect rules checked against the vendors' own documentation ---------------------------

test('MySQL: -- starts a comment only when whitespace follows, so balance--1 is arithmetic', () => {
  const my = formatSql('UPDATE account SET balance=balance--1 WHERE account_id=5752', { dialect: 'mysql' }).output;
  assert.match(my, /balance = balance - -1/);
  assert.match(my, /WHERE\n  account_id = 5752/);
  // In Standard SQL the same text is a comment that swallows the rest of the line.
  const std = formatSql('SELECT balance--1', { dialect: 'standard' }).output;
  assert.match(std, /balance --1$/);
});

test('MySQL: a known function never gets a space before its (, so COUNT (*) becomes COUNT(*)', () => {
  const out = formatSql('select count (*), sum (x), my_udf (y) from t', { dialect: 'mysql' }).output;
  assert.match(out, /COUNT\(\*\)/);
  assert.match(out, /SUM\(x\)/);
  // A name the tool does not know keeps the spacing it had.
  assert.match(out, /my_udf \(y\)/);
});

test('BigQuery accepts a trailing comma before FROM; other dialects get a warning', () => {
  const sql = 'SELECT a, b, FROM t';
  assert.deepEqual(formatSql(sql, { dialect: 'bigquery' }).issues, []);
  const std = formatSql(sql, { dialect: 'standard' }).issues;
  assert.equal(std.length, 1);
  assert.equal(std[0].code, 'trailing_comma');
  assert.equal(std[0].line, 1);
  assert.equal(std[0].column, 12);
  assert.match(std[0].message, /before FROM/);
});

test('# is a comment in MySQL and BigQuery, an operator in PostgreSQL, a temp table in SQL Server', () => {
  assert.equal(tokenize('# note', 'mysql')[0].type, 'lineComment');
  assert.equal(tokenize('# note', 'bigquery')[0].type, 'lineComment');
  assert.equal(tokenize('a # b', 'postgresql')[1].type, 'operator');
  assert.deepEqual(tokenize('#temp ##g', 'sqlserver').map((t) => t.type), ['word', 'word']);
});

test('quoting rules per dialect', () => {
  assert.equal(tokenize('"x"', 'mysql')[0].type, 'string');
  assert.equal(tokenize('"x"', 'postgresql')[0].type, 'quoted');
  assert.equal(tokenize('[a b]', 'sqlserver')[0].type, 'quoted');
  assert.equal(tokenize('[1]', 'postgresql')[0].type, 'openBracket');
  assert.equal(tokenize("'it\\'s'", 'mysql').length, 1);
  assert.equal(tokenize("E'it\\'s'", 'postgresql').length, 1);
  assert.equal(tokenize("'it''s'", 'standard').length, 1);
  assert.equal(tokenize('$tag$ a $$ b $tag$', 'postgresql').length, 1);
  assert.equal(tokenize('/* a /* b */ c */', 'postgresql').length, 1);
  assert.equal(tokenize('/* a /* b */ c */', 'mysql').length, 4); // comment, c, *, /
});

// ---- Layout rules the page describes ---------------------------------------------------------

test('a PostgreSQL $$ function body is written back exactly as typed', () => {
  const body = '$$\nBEGIN\n    RETURN   1;\nEND;\n$$';
  const out = formatSql(`create function f() returns int as ${body} language plpgsql;`, { dialect: 'postgresql' }).output;
  assert.ok(out.includes(body));
});

test('column names are never recased; words that are also functions only when called', () => {
  const out = formatSql('select date, year, count, text, user, status from t where date(created) = current_date').output;
  assert.match(out, /^\s+date,$/m);
  assert.match(out, /^\s+year,$/m);
  assert.match(out, /^\s+count,$/m);
  assert.match(out, /DATE\(created\) = CURRENT_DATE/);
  // Qualified names are never keywords either.
  assert.match(formatSql('select o.order, o.select from o').output, /o\.order,\n  o\.select/);
});

test('CREATE TABLE: one column per line, and ambiguous types are recased in the type position', () => {
  const out = formatSql('create table t (id int, date date, note text)').output;
  assert.equal(out, 'CREATE TABLE t (\n  id INT,\n  date DATE,\n  note TEXT\n)');
});

test('IN lists and VALUES rows stay on one line at any length; long calls break one argument per line', () => {
  const ids = Array.from({ length: 50 }, (_, k) => k).join(', ');
  assert.match(formatSql(`select * from t where id in (${ids})`).output, new RegExp(`IN \\(${ids}\\)`));
  const long = formatSql("select concat(first_name, ' ', middle_name, ' ', last_name, ' ', suffix_text) from p").output;
  assert.match(long, /CONCAT\(\n    first_name,\n    ' ',/);
});

test('BETWEEN … AND stays on one line; the next AND starts a new one', () => {
  const out = formatSql('select * from t where a between 1 and 5 and b = 2').output;
  assert.match(out, /WHERE\n  a BETWEEN 1 AND 5\n  AND b = 2/);
});

test('leading commas option', () => {
  assert.equal(formatSql('select a, b from t', { commas: 'start' }).output, 'SELECT\n  a\n  , b\nFROM\n  t');
});

test('indent option: 4 spaces and tab', () => {
  assert.equal(formatSql('select a from t', { indent: 4 }).output, 'SELECT\n    a\nFROM\n    t');
  assert.equal(formatSql('select a from t', { indent: 'tab' }).output, 'SELECT\n\ta\nFROM\n\tt');
});

test('keyword case: upper, lower, and as typed', () => {
  assert.equal(formatSql('Select a From t', { keywordCase: 'upper' }).output, 'SELECT\n  a\nFROM\n  t');
  assert.equal(formatSql('Select a From t', { keywordCase: 'lower' }).output, 'select\n  a\nfrom\n  t');
  assert.equal(formatSql('Select a From t', { keywordCase: 'preserve' }).output, 'Select\n  a\nFrom\n  t');
});

test('statements are separated by one blank line; comments stay where they were', () => {
  const out = formatSql('select 1; -- one\nselect 2;').output;
  assert.equal(out, 'SELECT\n  1; -- one\n\nSELECT\n  2;');
});

test('SQL Server: GO stays on its own line between batches; TOP stays on the SELECT line', () => {
  const out = formatSql('select top 5 a from t\ngo\nselect 1', { dialect: 'sqlserver' }).output;
  assert.equal(out, 'SELECT TOP 5\n  a\nFROM\n  t\n\nGO\n\nSELECT\n  1');
  // GO followed by a comment is still a separator.
  assert.equal(formatSql('select 1\nGO -- end of batch\nselect 2', { dialect: 'sqlserver' }).output, 'SELECT\n  1\n\nGO -- end of batch\n\nSELECT\n  2');
});

test('SQL Server: a column or alias called go is never left alone on a line (SSMS would split the batch there)', () => {
  const alias = formatSql('select a -- note\ngo from t', { dialect: 'sqlserver' }).output;
  assert.ok(!/^\s*go\s*$/im.test(alias), alias);
  const column = formatSql('select go from t', { dialect: 'sqlserver' }).output;
  assert.ok(!/^\s*go\s*$/im.test(column), column);
  // Other dialects have no GO, so there it is laid out like any other name.
  assert.equal(formatSql('select go from t').output, 'SELECT\n  go\nFROM\n  t');
});

test('non-breaking spaces copied from web pages become ordinary spaces', () => {
  const out = formatSql(`select${NBSP}a${NBSP}from${NBSP}t`).output;
  assert.equal(out, 'SELECT\n  a\nFROM\n  t');
  assert.ok(!out.includes(NBSP));
});

// ---- Minify ---------------------------------------------------------------------------------

test('minify: one line per statement, comments removed except MySQL executable comments and hints', () => {
  const out = minifySql("select /*+ BKA(t) */ a, -- note\n b from t where x = 'a  b'; /* gone */ select /*!40001 SQL_NO_CACHE */ 1;", { dialect: 'mysql' }).output;
  assert.equal(out, "SELECT /*+ BKA(t) */ a,b FROM t WHERE x='a  b';\nSELECT /*!40001 SQL_NO_CACHE */ 1;");
});

test('minify: never joins two operators, so a - -1 stays safe', () => {
  assert.equal(minifySql('select a - -1, x = -1 from t').output, 'SELECT a- -1,x= -1 FROM t');
});

// ---- Lint -----------------------------------------------------------------------------------

test('lint: unclosed string, with a hint when the query uses a MySQL-style escape', () => {
  const [issue] = formatSql("select 'it\\'s' from t").issues;
  assert.equal(issue.code, 'unterminated');
  assert.match(issue.message, /MySQL\/BigQuery escape/);
  assert.deepEqual(formatSql("select 'it\\'s' from t", { dialect: 'mysql' }).issues, []);
});

test('lint: brackets, with line and column', () => {
  const issues = formatSql('select (a from t;\nselect b) from t').issues;
  assert.deepEqual(
    issues.map((i) => [i.code, i.line, i.column]),
    [['unclosed_open', 1, 8], ['unmatched_close', 2, 9]],
  );
});

test('lint: comma mistakes', () => {
  const codes = (sql: string) => formatSql(sql).issues.map((i) => i.code);
  assert.deepEqual(codes('select a,, b from t'), ['double_comma']);
  assert.deepEqual(codes('select f(a, ) from t'), ['trailing_comma']);
  assert.deepEqual(codes('select a from t order by a,'), ['trailing_comma']);
  assert.deepEqual(codes('with x as (select 1), select * from x'), ['trailing_comma']);
  assert.deepEqual(codes('select a, b from t where c in (1, 2)'), []);
});

test('lint: unclosed comment and $$ body', () => {
  assert.equal(formatSql('select 1 /* open').issues[0].code, 'unterminated');
  assert.match(formatSql('select $$ open', { dialect: 'postgresql' }).issues[0].message, /\$\$ body/);
});

// ---- Input handling -------------------------------------------------------------------------

test('empty and whitespace-only input', () => {
  assert.deepEqual(formatSql(''), { output: '', issues: [], statements: 0 });
  assert.deepEqual(formatSql('  \n\t '), { output: '', issues: [], statements: 0 });
  assert.equal(formatSql('-- only a comment').statements, 0);
});

test('statement count ignores empty statements', () => {
  assert.equal(formatSql('select 1;; select 2;').statements, 2);
});

test('deep nesting and a large input do not throw', () => {
  const deep = '('.repeat(3000) + '1' + ')'.repeat(3000);
  assert.ok(formatSql(`select ${deep}`).output.length > 6000);
  const big = Array.from({ length: 2000 }, (_, k) => `select a${k}, b from t${k} where c = ${k};`).join('\n');
  const r = formatSql(big);
  assert.equal(r.statements, 2000);
});
