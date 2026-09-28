/**
 * SQL formatter, minifier and lint checks. Pure, no DOM.
 *
 * Three stages:
 * 1. `tokenize` splits the text into tokens. This is the only dialect-aware part: it decides what
 *    counts as a string ('…', "…" in MySQL/BigQuery, $$…$$ in PostgreSQL), a quoted name ("…",
 *    `…`, […] in SQL Server/SQLite) or a comment (--, #, nested /* *\/).
 * 2. `classify` names each word by what it does in a statement (a clause that starts a line, a
 *    join, AND/OR, a function, a plain identifier) and merges multi-word keywords such as
 *    GROUP BY or LEFT OUTER JOIN into one item.
 * 3. `layout` (Format) or `compact` (Minify) writes the items back out.
 *
 * Only whitespace and the case of known keywords ever change: every other character of every token
 * is written back exactly as typed. tests/sql-format.test.ts checks that by re-tokenising the output,
 * and checks that formatting twice gives the same text as formatting once.
 */

import { offsetToLineColumn } from './json-parse';

export type Dialect = 'standard' | 'mysql' | 'postgresql' | 'sqlserver' | 'sqlite' | 'bigquery';

/** Order and labels as the Dialect select shows them. */
export const DIALECTS: { value: Dialect; label: string }[] = [
  { value: 'standard', label: 'Standard SQL' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlserver', label: 'SQL Server (T-SQL)' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'bigquery', label: 'BigQuery' },
];

export type KeywordCase = 'upper' | 'lower' | 'preserve';
export type CommaStyle = 'end' | 'start';

export interface FormatOptions {
  dialect: Dialect;
  keywordCase: KeywordCase;
  indent: 2 | 4 | 'tab';
  commas: CommaStyle;
}

export const DEFAULT_OPTIONS: FormatOptions = { dialect: 'standard', keywordCase: 'upper', indent: 2, commas: 'end' };

/** A bracketed group stays on one line when its flat text is at most this many characters. */
export const INLINE_WIDTH = 60;

// ---------------------------------------------------------------------------------------------
// 1. Tokenizer
// ---------------------------------------------------------------------------------------------

export type TokenType =
  | 'word'
  | 'quoted' // quoted identifier: "x", `x`, [x]
  | 'string' // string literal, including prefixes (N'', E'', b'', r'') and $$ bodies
  | 'number'
  | 'param' // ?, ?1, $1, :name, @name, @@name
  | 'operator'
  | 'open'
  | 'close'
  | 'openBracket' // [ as an array subscript (not SQL Server / SQLite names)
  | 'closeBracket'
  | 'comma'
  | 'semicolon'
  | 'dot'
  | 'lineComment'
  | 'blockComment';

export interface Token {
  type: TokenType;
  text: string;
  /** Character offset of the token's first character in the input. */
  pos: number;
  /** The whitespace before this token contained a line break. */
  nlBefore: boolean;
  /** There was any whitespace before this token. */
  spaceBefore: boolean;
  /** Set when the token runs to the end of the input without its closing delimiter. */
  unterminated?: 'string' | 'quoted' | 'comment' | 'dollar';
}

// Spaces a SQL engine treats as whitespace, plus the Unicode spaces that arrive in text copied
// from web pages, chat apps and documents (U+00A0 above all). Most databases reject those between
// keywords, so the formatter treats them as whitespace and writes an ordinary space instead.
function isWs(c: string): boolean {
  const k = c.charCodeAt(0);
  return (
    k === 32 || (k >= 9 && k <= 13) || k === 0xa0 || k === 0xfeff || k === 0x1680 ||
    (k >= 0x2000 && k <= 0x200a) || k === 0x2028 || k === 0x2029 || k === 0x202f || k === 0x205f || k === 0x3000
  );
}
function hasLineBreak(s: string, from: number, to: number): boolean {
  for (let j = from; j < to; j++) {
    const k = s.charCodeAt(j);
    if (k === 10 || k === 13 || k === 0x2028 || k === 0x2029) return true;
  }
  return false;
}
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
function isIdentStart(c: string | undefined): boolean {
  if (c === undefined) return false;
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || (c > '\u007f' && !isWs(c));
}
function isIdentPart(c: string | undefined): boolean {
  return isIdentStart(c) || isDigit(c) || c === '$';
}

// Longest first, so '->>' wins over '->' and '<>' over '<'.
const OPERATORS = [
  '->>', '#>>', '<=>', '!~*',
  '<>', '!=', '<=', '>=', '||', '::', '->', '#>', '@>', '<@', '=>', ':=', '&&', '<<', '>>', '~*', '!~',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '!<', '!>',
];

/** Scan a delimited literal starting at `i` (the opening delimiter, `openLen` characters long). */
function scanDelimited(
  sql: string,
  i: number,
  openLen: number,
  close: string,
  doubled: boolean,
  backslash: boolean,
): { end: number; closed: boolean } {
  const n = sql.length;
  let j = i + openLen;
  while (j < n) {
    const c = sql[j];
    if (backslash && c === '\\') { j += 2; continue; }
    if (sql.startsWith(close, j)) {
      if (doubled && close.length === 1 && sql[j + 1] === close) { j += 2; continue; }
      return { end: j + close.length, closed: true };
    }
    j++;
  }
  return { end: n, closed: false };
}

/** String prefixes each dialect understands (the letters directly before a quote). */
function stringPrefixLength(sql: string, i: number, dialect: Dialect): number {
  const two = sql.slice(i, i + 2);
  const one = sql[i];
  if (dialect === 'bigquery') {
    // r'', b'', rb'', br'' (and the same with " or triple quotes)
    if (/^(?:rb|br)$/i.test(two) && (sql[i + 2] === "'" || sql[i + 2] === '"')) return 2;
    if (/^[rb]$/i.test(one) && (sql[i + 1] === "'" || sql[i + 1] === '"')) return 1;
    return 0;
  }
  if (dialect === 'postgresql' && /^u&$/i.test(two) && (sql[i + 2] === "'" || sql[i + 2] === '"')) return 2;
  const letters: Record<Dialect, string> = {
    standard: 'nNbBxX',
    mysql: 'nNbBxX',
    postgresql: 'eEbBxXnN',
    sqlserver: 'nN',
    sqlite: 'xX',
    bigquery: '',
  };
  return letters[dialect].includes(one) && sql[i + 1] === "'" ? 1 : 0;
}

export function tokenize(sql: string, dialect: Dialect = 'standard'): Token[] {
  const out: Token[] = [];
  const n = sql.length;
  const backslashStrings = dialect === 'mysql' || dialect === 'bigquery';
  let i = 0;
  while (i < n) {
    const wsStart = i;
    while (i < n && isWs(sql[i])) i++;
    if (i >= n) break;
    const spaceBefore = i > wsStart;
    const nlBefore = spaceBefore && hasLineBreak(sql, wsStart, i);
    const start = i;
    const c = sql[i];
    const c1 = sql[i + 1];
    let type: TokenType;
    let end: number;
    let unterminated: Token['unterminated'];

    const lineComment = () => {
      let e = sql.indexOf('\n', i);
      if (e < 0) e = n;
      // Trailing spaces (and a CR) belong to the line break, not the comment.
      while (e > i && (sql[e - 1] === ' ' || sql[e - 1] === '\t' || sql[e - 1] === '\r')) e--;
      type = 'lineComment';
      end = e;
    };

    if (c === '-' && c1 === '-' && (dialect !== 'mysql' || i + 2 >= n || sql.charCodeAt(i + 2) <= 32)) {
      // MySQL only starts a comment when whitespace or a control character follows the two
      // dashes, so `balance--1` stays arithmetic there (MySQL manual 1.6.2.4).
      lineComment();
    } else if (c === '#' && (dialect === 'mysql' || dialect === 'bigquery')) {
      lineComment();
    } else if (c === '/' && c1 === '*') {
      const nests = dialect === 'postgresql' || dialect === 'sqlserver';
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; continue; }
        if (nests && sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue; }
        j++;
      }
      type = 'blockComment';
      end = depth === 0 ? j : n;
      if (depth > 0) unterminated = 'comment';
    } else if (stringPrefixLength(sql, i, dialect) > 0) {
      const p = stringPrefixLength(sql, i, dialect);
      const q = sql[i + p];
      const escapes = backslashStrings || /^[eE]$/.test(sql.slice(i, i + p));
      const triple = dialect === 'bigquery' && sql.startsWith(q.repeat(3), i + p);
      const r = triple
        ? scanDelimited(sql, i + p, 3, q.repeat(3), false, true)
        : scanDelimited(sql, i + p, 1, q, true, escapes);
      type = q === '"' && dialect === 'postgresql' ? 'quoted' : 'string';
      end = r.end;
      if (!r.closed) unterminated = type === 'quoted' ? 'quoted' : 'string';
    } else if (c === "'") {
      const triple = dialect === 'bigquery' && sql.startsWith("'''", i);
      const r = triple ? scanDelimited(sql, i, 3, "'''", false, true) : scanDelimited(sql, i, 1, "'", true, backslashStrings);
      type = 'string';
      end = r.end;
      if (!r.closed) unterminated = 'string';
    } else if (c === '"') {
      if (backslashStrings) {
        const triple = dialect === 'bigquery' && sql.startsWith('"""', i);
        const r = triple ? scanDelimited(sql, i, 3, '"""', false, true) : scanDelimited(sql, i, 1, '"', true, true);
        type = 'string';
        end = r.end;
        if (!r.closed) unterminated = 'string';
      } else {
        const r = scanDelimited(sql, i, 1, '"', true, false);
        type = 'quoted';
        end = r.end;
        if (!r.closed) unterminated = 'quoted';
      }
    } else if (c === '`') {
      const r = scanDelimited(sql, i, 1, '`', true, dialect === 'bigquery');
      type = 'quoted';
      end = r.end;
      if (!r.closed) unterminated = 'quoted';
    } else if (c === '[' && (dialect === 'sqlserver' || dialect === 'sqlite')) {
      const r = scanDelimited(sql, i, 1, ']', true, false);
      type = 'quoted';
      end = r.end;
      if (!r.closed) unterminated = 'quoted';
    } else if (c === '[') {
      type = 'openBracket';
      end = i + 1;
    } else if (c === ']') {
      type = 'closeBracket';
      end = i + 1;
    } else if (c === '$' && dialect === 'postgresql' && isDigit(c1)) {
      let j = i + 1;
      while (isDigit(sql[j])) j++;
      type = 'param';
      end = j;
    } else if (c === '$' && dialect === 'postgresql' && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 66))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 66))![0];
      const close = sql.indexOf(tag, i + tag.length);
      type = 'string';
      end = close < 0 ? n : close + tag.length;
      if (close < 0) unterminated = 'dollar';
    } else if (c === '$' && isIdentStart(c1)) {
      let j = i + 1;
      while (isIdentPart(sql[j])) j++;
      type = 'param';
      end = j;
    } else if (isDigit(c) || (c === '.' && isDigit(c1) && !(isQualifier(out[out.length - 1]) && !spaceBefore))) {
      let j = i;
      const hex = /^0[xX][0-9a-fA-F]+/.exec(sql.slice(i, i + 64));
      const bin = /^0[bB][01]+/.exec(sql.slice(i, i + 64));
      if (hex && !isIdentPart(sql[i + hex[0].length])) j = i + hex[0].length;
      else if (bin && !isIdentPart(sql[i + bin[0].length])) j = i + bin[0].length;
      else {
        while (isDigit(sql[j])) j++;
        if (sql[j] === '.' && (isDigit(sql[j + 1]) || !isIdentStart(sql[j + 1]))) {
          j++;
          while (isDigit(sql[j])) j++;
        }
        if ((sql[j] === 'e' || sql[j] === 'E') && (isDigit(sql[j + 1]) || ((sql[j + 1] === '+' || sql[j + 1] === '-') && isDigit(sql[j + 2])))) {
          j += 2;
          while (isDigit(sql[j])) j++;
        }
      }
      if (/^[0-9]+$/.test(sql.slice(i, j)) && isIdentStart(sql[j])) {
        // MySQL allows names that start with digits (1st_quarter); keep them one word so the
        // formatter never splits them with a space. Only plain digits: .5x and 1.5x are a number
        // followed by a name.
        while (isIdentPart(sql[j])) j++;
        type = 'word';
      } else type = 'number';
      end = j;
    } else if (c === '#' && dialect === 'sqlserver' && (c1 === '#' || isIdentStart(c1))) {
      // #temp and ##global temp tables
      let j = i + 1;
      if (sql[j] === '#') j++;
      while (isIdentPart(sql[j])) j++;
      type = 'word';
      end = j;
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (isIdentPart(sql[j])) j++;
      type = 'word';
      end = j;
    } else if (c === '@' && dialect !== 'postgresql' && (isIdentStart(c1) || (c1 === '@' && isIdentStart(sql[i + 2])))) {
      let j = i + (c1 === '@' ? 2 : 1);
      while (isIdentPart(sql[j])) j++;
      type = 'param';
      end = j;
    } else if (c === '?' && dialect === 'postgresql' && (c1 === '|' || c1 === '&')) {
      type = 'operator';
      end = i + 2;
    } else if (c === '?') {
      let j = i + 1;
      while (isDigit(sql[j])) j++;
      type = 'param';
      end = j;
    } else if (c === ':' && isIdentStart(c1)) {
      let j = i + 1;
      while (isIdentPart(sql[j])) j++;
      type = 'param';
      end = j;
    } else if (c === '(') { type = 'open'; end = i + 1; }
    else if (c === ')') { type = 'close'; end = i + 1; }
    else if (c === ',') { type = 'comma'; end = i + 1; }
    else if (c === ';') { type = 'semicolon'; end = i + 1; }
    else if (c === '.') { type = 'dot'; end = i + 1; }
    else {
      const op = OPERATORS.find((o) => sql.startsWith(o, i));
      type = 'operator';
      end = i + (op ? op.length : 1);
    }

    out.push({ type: type!, text: sql.slice(start, end!), pos: start, nlBefore, spaceBefore, ...(unterminated ? { unterminated } : {}) });
    i = end!;
  }
  return out;
}

/** A `.` directly after a name (no space) is a qualifier: t.5 is not the number .5, but t .5 is. */
function isQualifier(prev: Token | undefined): boolean {
  return !!prev && (prev.type === 'word' || prev.type === 'quoted' || prev.type === 'close' || prev.type === 'closeBracket');
}

// ---------------------------------------------------------------------------------------------
// 2. Classification
// ---------------------------------------------------------------------------------------------

type Kind =
  | 'clause' // starts a line; its content goes on the lines below, indented (SELECT, FROM, WHERE …)
  | 'inlineClause' // starts a line; its content stays on the same line (LIMIT, INSERT INTO, UPDATE …)
  | 'setop' // UNION, INTERSECT, EXCEPT: a line of its own between two queries
  | 'join'
  | 'logical' // AND, OR
  | 'between' // BETWEEN, whose AND must not start a new line
  | 'case' | 'when' | 'then' | 'else' | 'end'
  | 'alterAction' // ADD / DROP COLUMN … inside ALTER TABLE
  | 'go' // SQL Server batch separator
  | 'keyword' | 'function' | 'ident'
  | 'quoted' | 'string' | 'number' | 'param' | 'operator'
  | 'open' | 'close' | 'openBracket' | 'closeBracket' | 'comma' | 'semicolon' | 'dot'
  | 'lineComment' | 'blockComment';

interface Item {
  kind: Kind;
  /** Output text (keywords already in the chosen case). */
  text: string;
  /** Upper-case keyword or phrase, words joined by one space; '' for anything that is not a word. */
  upper: string;
  pos: number;
  nlBefore: boolean;
  spaceBefore: boolean;
  unterminated?: Token['unterminated'];
}

const words = (s: string) => new Set(s.trim().split(/\s+/));

/** Recased whenever they appear on their own. Deliberately excludes words that are common column
 *  names (name, type, status, value, user, date, time, text …): see FUNCTIONS. */
const KEYWORDS = words(`
  ADD ALL ALTER ANALYZE AND ANY APPLY ARRAY AS ASC AUTO_INCREMENT AUTOINCREMENT BEGIN BETWEEN BY
  CASCADE CASE CHECK CLUSTERED COLLATE COLUMN COMMIT CONSTRAINT CREATE CROSS CURRENT_DATE CURRENT_TIME
  CURRENT_TIMESTAMP CURRENT_USER DATABASE DECLARE DEFAULT DELETE DESC DESCRIBE DISTINCT DIV DO DROP ELSE
  END ESCAPE EXCEPT EXEC EXECUTE EXISTS EXPLAIN FALSE FETCH FOR FOREIGN FROM FULL FUNCTION GRANT GROUP
  HAVING IDENTITY IF IGNORE ILIKE IN INDEX INNER INSERT INTERSECT INTERVAL INTO IS JOIN LATERAL LEFT LIKE
  LIMIT LOCALTIME LOCALTIMESTAMP MATERIALIZED MERGE MINUS NATURAL NONCLUSTERED NOT NULL OFFSET ON OR ORDER
  OUTER OVER PARTITION PERCENT PRIMARY PROCEDURE QUALIFY RECURSIVE REFERENCES REGEXP RENAME REPLACE
  RESTRICT RETURN RETURNING RETURNS REVOKE RIGHT RLIKE ROLLBACK SCHEMA SELECT SET SIMILAR SOME TABLE
  TEMPORARY THEN TO TOP TRANSACTION TRIGGER TRUE TRUNCATE UNION UNIQUE UNSIGNED UPDATE USE USING VALUES
  VIEW WHEN WHERE WINDOW WITH XOR ZEROFILL
`);

/** Data types that are never column names in practice. Recased like keywords; written with no
 *  space before a ( so VARCHAR(255) stays VARCHAR(255). */
const TYPES = words(`
  BIGINT BIGNUMERIC BIGSERIAL BINARY BLOB BOOL BOOLEAN BYTEA CHAR CLOB DATETIME DATETIME2 DATETIMEOFFSET
  DECIMAL DOUBLE FLOAT FLOAT64 INT INT64 INTEGER JSONB LONGBLOB LONGTEXT MEDIUMBLOB MEDIUMINT MEDIUMTEXT
  NCHAR NUMERIC NVARCHAR NVARCHAR2 REAL SERIAL SMALLDATETIME SMALLINT SMALLSERIAL TIMESTAMPTZ TINYBLOB
  TINYINT TINYTEXT UNIQUEIDENTIFIER VARBINARY VARCHAR VARCHAR2
`);

/** Recased only when called, i.e. followed directly by (. On their own these are often column
 *  names (date, year, count, text, json), which the formatter leaves exactly as typed. */
const FUNCTIONS = words(`
  ABS ACOS ADDDATE ARRAY_AGG ARRAY_LENGTH ASCII ASIN ATAN AVG BIT BIT_AND BIT_LENGTH BIT_OR BIT_XOR
  CARDINALITY CAST CEIL CEILING CHAR_LENGTH CHARACTER_LENGTH CHARINDEX COALESCE CONCAT CONCAT_WS CONVERT
  COS COUNT COUNT_BIG CUME_DIST CURDATE CURTIME DATE DATE_ADD DATE_DIFF DATE_FORMAT DATE_PART DATE_SUB
  DATE_TRUNC DATEADD DATEDIFF DATENAME DATEPART DAY DAYOFWEEK DECODE DENSE_RANK EOMONTH EXP EXTRACT
  FIRST_VALUE FLOOR FORMAT FORMAT_DATE GENERATE_SERIES GETDATE GETUTCDATE GREATEST GROUP_CONCAT GROUPING
  HASHBYTES HOUR IFNULL IIF INITCAP INSTR ISNULL JSON JSON_AGG JSON_ARRAY JSON_ARRAYAGG JSON_BUILD_OBJECT
  JSON_EXTRACT JSON_EXTRACT_SCALAR JSON_OBJECT JSON_OBJECTAGG JSON_QUERY JSON_UNQUOTE JSON_VALUE JSONB_AGG
  JSONB_BUILD_OBJECT LAG LAST_DAY LAST_VALUE LCASE LEAD LEAST LEN LENGTH LN LOCATE LOG LOG10 LOWER LPAD
  LTRIM MAX MD5 MID MIN MINUTE MOD MONEY MONTH NEWID NOW NTH_VALUE NTILE NULLIF NUMBER NVL NVL2
  PERCENT_RANK PERCENTILE_CONT PERCENTILE_DISC POSITION POWER QUOTENAME RAND RANDOM RANK REGEXP_CONTAINS
  REGEXP_EXTRACT REGEXP_LIKE REGEXP_REPLACE REGEXP_SUBSTR REPEAT REPLICATE REVERSE ROUND ROW ROW_NUMBER
  RPAD RTRIM SAFE_CAST SAFE_DIVIDE SECOND SESSION_USER SHA1 SHA2 SIGN SIN SPACE SPLIT SPLIT_PART SQRT STD
  STDDEV STDDEV_POP STDDEV_SAMP STR_TO_DATE STRFTIME STRING STRING_AGG STRING_SPLIT STUFF SUBDATE SUBSTR
  SUBSTRING SUM SYSDATE SYSDATETIME SYSTEM_USER TAN TEXT TIME TIMESTAMP TIMESTAMP_DIFF TIMESTAMPDIFF
  TO_CHAR TO_DATE TO_JSON TO_NUMBER TO_TIMESTAMP TRANSLATE TRIM TRUNC TRY_CAST TRY_CONVERT UCASE
  UNIX_TIMESTAMP UNNEST UPPER UUID VAR_POP VAR_SAMP VARIANCE WEEK YEAR
`);

/** Keywords that are also functions when a ( follows: LEFT(name, 3), REPLACE(s, 'a', 'b'), MySQL's
 *  IF(cond, a, b). MySQL's INSERT(str, pos, len, new) is handled in classify: elsewhere INSERT ( is
 *  the column list of MERGE … THEN INSERT (a, b). */
const KEYWORD_FUNCTIONS = words('LEFT RIGHT REPLACE IF TRUNCATE ARRAY ROLLUP CUBE');

/** Functions whose first argument is a date part written as a bare word: EXTRACT(YEAR FROM d),
 *  DATEADD(day, 1, d). That word is a keyword there, not a column. */
const DATE_PART_FUNCTIONS = words('EXTRACT DATEADD DATEDIFF DATEDIFF_BIG DATEPART DATENAME DATETRUNC TIMESTAMPADD TIMESTAMPDIFF');

/** Multi-word keywords and single words with a layout role. Longest match wins. */
const PHRASES: Record<string, Kind> = {};
const phrase = (kind: Kind, list: string) => {
  for (const p of list.split(',')) PHRASES[p.trim().replace(/\s+/g, ' ')] = kind;
};
phrase('clause', `SELECT, SELECT DISTINCT, SELECT ALL, SELECT DISTINCT ON, FROM, WHERE, GROUP BY, HAVING,
  ORDER BY, QUALIFY, WINDOW, WITH, WITH RECURSIVE, VALUES, SET, RETURNING, PARTITION BY,
  ON DUPLICATE KEY UPDATE, DO UPDATE SET`);
phrase('inlineClause', `LIMIT, OFFSET, FETCH FIRST, FETCH NEXT, INSERT, INSERT INTO, INSERT IGNORE INTO,
  INSERT OR REPLACE INTO, INSERT OR IGNORE INTO, REPLACE INTO, UPDATE, DELETE, DELETE FROM, MERGE, MERGE INTO,
  CREATE TABLE, CREATE TABLE IF NOT EXISTS, CREATE TEMPORARY TABLE, CREATE TEMPORARY TABLE IF NOT EXISTS,
  CREATE TEMP TABLE, CREATE OR REPLACE TABLE, CREATE VIEW, CREATE OR REPLACE VIEW, CREATE MATERIALIZED VIEW,
  CREATE INDEX, CREATE UNIQUE INDEX, ALTER TABLE, DROP TABLE, DROP TABLE IF EXISTS, DROP VIEW,
  DROP VIEW IF EXISTS, TRUNCATE TABLE, ON CONFLICT, DO NOTHING, FOR UPDATE, FOR SHARE, WHEN MATCHED THEN,
  WHEN NOT MATCHED THEN, WHEN NOT MATCHED BY TARGET THEN, WHEN NOT MATCHED BY SOURCE THEN`);
phrase('setop', `UNION, UNION ALL, UNION DISTINCT, INTERSECT, INTERSECT ALL, INTERSECT DISTINCT, EXCEPT,
  EXCEPT ALL, EXCEPT DISTINCT, MINUS`);
phrase('join', `JOIN, INNER JOIN, LEFT JOIN, LEFT OUTER JOIN, RIGHT JOIN, RIGHT OUTER JOIN, FULL JOIN,
  FULL OUTER JOIN, CROSS JOIN, NATURAL JOIN, NATURAL LEFT JOIN, NATURAL RIGHT JOIN, NATURAL INNER JOIN,
  NATURAL LEFT OUTER JOIN, NATURAL RIGHT OUTER JOIN, NATURAL FULL JOIN, NATURAL FULL OUTER JOIN,
  LEFT SEMI JOIN, LEFT ANTI JOIN, CROSS APPLY, OUTER APPLY, STRAIGHT_JOIN, JOIN LATERAL, LEFT JOIN LATERAL,
  INNER JOIN LATERAL, CROSS JOIN LATERAL`);
phrase('logical', 'AND, OR, XOR');
phrase('between', 'BETWEEN, NOT BETWEEN, ROWS BETWEEN, RANGE BETWEEN, GROUPS BETWEEN');
phrase('case', 'CASE');
phrase('when', 'WHEN');
phrase('then', 'THEN');
phrase('else', 'ELSE');
phrase('end', 'END');
phrase('alterAction', `ADD, ADD COLUMN, ADD CONSTRAINT, DROP, DROP COLUMN, DROP CONSTRAINT, ALTER COLUMN,
  MODIFY, MODIFY COLUMN, CHANGE, CHANGE COLUMN, RENAME TO, RENAME COLUMN`);
phrase('keyword', `NULLS FIRST, NULLS LAST, ROWS ONLY, ROW ONLY, WITH TIES, WITH ROLLUP, PRIMARY KEY,
  FOREIGN KEY, UNIQUE KEY, CHARACTER SET, ON DELETE, ON UPDATE, SET NULL, SET DEFAULT, NO ACTION,
  IS DISTINCT FROM, IS NOT DISTINCT FROM, UNBOUNDED PRECEDING, UNBOUNDED FOLLOWING, CURRENT ROW,
  WITHIN GROUP, IF EXISTS, IF NOT EXISTS, DOUBLE PRECISION, CHARACTER VARYING, WITH TIME ZONE,
  WITHOUT TIME ZONE, AT TIME ZONE, SKIP LOCKED, WITH CHECK OPTION, GROUPING SETS`);
const MAX_PHRASE_WORDS = 7;
const TYPE_PHRASES = new Set(['DOUBLE PRECISION', 'CHARACTER VARYING']);

/** Keywords that are values, so a - after them is subtraction, not a sign. */
const VALUE_KEYWORDS = words('NULL TRUE FALSE CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER LOCALTIME LOCALTIMESTAMP');

/** Clauses whose items go one per line (a comma ends the line). */
const LIST_CLAUSES = new Set([
  'SELECT', 'SELECT DISTINCT', 'SELECT ALL', 'SELECT DISTINCT ON', 'FROM', 'JOIN', 'GROUP BY', 'ORDER BY',
  'PARTITION BY', 'SET', 'VALUES', 'WITH', 'WITH RECURSIVE', 'RETURNING', 'WINDOW', 'ON DUPLICATE KEY UPDATE',
  'DO UPDATE SET', 'ALTER TABLE',
]);

function recase(word: string, mode: KeywordCase): string {
  return mode === 'upper' ? word.toUpperCase() : mode === 'lower' ? word.toLowerCase() : word;
}

function classify(tokens: Token[], dialect: Dialect, mode: KeywordCase): Item[] {
  const items: Item[] = [];
  const n = tokens.length;
  const base = (t: Token, kind: Kind, text = t.text, upper = ''): Item => ({
    kind,
    text,
    upper,
    pos: t.pos,
    nlBefore: t.nlBefore,
    spaceBefore: t.spaceBefore,
    ...(t.unterminated ? { unterminated: t.unterminated } : {}),
  });
  /** Previous token that is not a comment. */
  const prevCode = (k: number) => {
    for (let j = k - 1; j >= 0; j--) if (tokens[j].type !== 'lineComment' && tokens[j].type !== 'blockComment') return tokens[j];
    return undefined;
  };

  for (let k = 0; k < n; k++) {
    const t = tokens[k];
    if (t.type !== 'word') {
      items.push(base(t, t.type as Kind));
      continue;
    }
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    // A word next to a dot is part of a qualified name (orders.date, public.order): never a keyword.
    if (prev?.type === 'dot' || next?.type === 'dot') {
      items.push(base(t, 'ident'));
      continue;
    }
    // Longest multi-word phrase starting here. Only plain whitespace may separate its words.
    let matched = 0;
    let matchedKind: Kind | undefined;
    const parts: string[] = [t.text.toUpperCase()];
    for (let m = 1; m < MAX_PHRASE_WORDS && k + m < n; m++) {
      const w = tokens[k + m];
      if (w.type !== 'word' || tokens[k + m + 1]?.type === 'dot') break;
      parts.push(w.text.toUpperCase());
      const kind = PHRASES[parts.join(' ')];
      if (kind) { matched = m; matchedKind = kind; }
    }
    if (matched > 0) {
      const upper = parts.slice(0, matched + 1).join(' ');
      const text = tokens.slice(k, k + matched + 1).map((w) => recase(w.text, mode)).join(' ');
      const kind = TYPE_PHRASES.has(upper) && tokens[k + matched + 1]?.type === 'open' ? 'function' : matchedKind!;
      items.push(base(t, kind, text, upper));
      k += matched;
      continue;
    }
    const upper = parts[0];
    const callsNext = next?.type === 'open';
    if (upper === 'VALUES') {
      // MySQL's VALUES(col) inside ON DUPLICATE KEY UPDATE a = VALUES(a) is a function, not a clause.
      const p = prevCode(k);
      if (p?.type === 'operator') {
        items.push(base(t, callsNext ? 'function' : 'keyword', recase(t.text, mode), upper));
        continue;
      }
    }
    const isFunction =
      FUNCTIONS.has(upper) || TYPES.has(upper) || KEYWORD_FUNCTIONS.has(upper) || (upper === 'INSERT' && dialect === 'mysql');
    if (callsNext && upper !== 'VALUES' && isFunction) {
      items.push(base(t, 'function', recase(t.text, mode), upper));
      continue;
    }
    // EXTRACT(YEAR FROM d), DATEADD(day, 1, d): the first argument is a date-part keyword. MySQL's
    // DATEDIFF(a, b) takes two dates instead, so there the first argument is left alone.
    const fn = tokens[k - 2]?.type === 'word' ? tokens[k - 2].text.toUpperCase() : '';
    const datePart =
      prev?.type === 'open' && DATE_PART_FUNCTIONS.has(fn) && !(fn === 'DATEDIFF' && dialect === 'mysql') &&
      (next?.type === 'comma' || next?.text.toUpperCase() === 'FROM');
    if (datePart) {
      items.push(base(t, 'keyword', recase(t.text, mode), upper));
      continue;
    }
    // OFFSET 5 ROWS, TOP 1 ROW: after a number these are keywords (on their own, often column names).
    if ((upper === 'ROWS' || upper === 'ROW') && (prev?.type === 'number' || prev?.type === 'param')) {
      items.push(base(t, 'keyword', recase(t.text, mode), upper));
      continue;
    }
    if (PHRASES[upper]) {
      items.push(base(t, PHRASES[upper], recase(t.text, mode), upper));
      continue;
    }
    if (KEYWORDS.has(upper) || TYPES.has(upper)) {
      items.push(base(t, 'keyword', recase(t.text, mode), upper));
      continue;
    }
    // GO is a batch separator only alone on its line (a comment may follow it).
    if (dialect === 'sqlserver' && upper === 'GO' && (k === 0 || t.nlBefore) && (!next || next.nlBefore || next.type === 'lineComment')) {
      items.push(base(t, 'go', recase(t.text, mode), upper));
      continue;
    }
    items.push(base(t, 'ident'));
  }
  return items;
}

const isComment = (it: Item | undefined) => !!it && (it.kind === 'lineComment' || it.kind === 'blockComment');

/** Index of the matching ) for every (, and vice versa; -1 when unmatched. A ; or GO closes
 *  everything still open, so one missing ) cannot swallow the statements after it. */
function matchParens(items: Item[]): Int32Array {
  const pair = new Int32Array(items.length).fill(-1);
  let stack: number[] = [];
  items.forEach((it, i) => {
    if (it.kind === 'open') stack.push(i);
    else if (it.kind === 'close' && stack.length) {
      const o = stack.pop()!;
      pair[o] = i;
      pair[i] = o;
    } else if (it.kind === 'semicolon' || it.kind === 'go') stack = [];
  });
  return pair;
}

// ---------------------------------------------------------------------------------------------
// 3a. Spacing between two items on one line
// ---------------------------------------------------------------------------------------------

const KEYWORDISH = new Set<Kind>([
  'clause', 'inlineClause', 'setop', 'join', 'logical', 'between', 'case', 'when', 'then', 'else',
  'alterAction', 'keyword', 'go',
]);

/** A - or + here is a sign (-1, +x), not subtraction. */
function signPosition(prev: Item | null): boolean {
  if (!prev) return true;
  if (prev.kind === 'keyword') return !VALUE_KEYWORDS.has(prev.upper);
  return KEYWORDISH.has(prev.kind) || prev.kind === 'operator' || prev.kind === 'open' || prev.kind === 'openBracket' || prev.kind === 'comma' || prev.kind === 'semicolon';
}
const isSign = (it: Item, prevCode: Item | null) =>
  it.kind === 'operator' && (it.text === '-' || it.text === '+' || it.text === '~' || it.text === '!') && signPosition(prevCode);

/** A dot followed by anything that starts with a digit (5, 1st_col) would read as the number .5;
 *  a number followed by a dot could absorb it (1 . 5). */
const dotMergeRisk = (a: Item, b: Item) =>
  (a.kind === 'dot' && b.text.charCodeAt(0) >= 48 && b.text.charCodeAt(0) <= 57) || (b.kind === 'dot' && a.kind === 'number');

/** A quoted name or string followed by its own closing character would read as an escaped quote:
 *  [w] ] as [w]], 'a' 'b' as 'a''b'. */
const quoteMergeRisk = (a: Item, b: Item) =>
  (a.kind === 'quoted' || a.kind === 'string') && b.text !== '' && a.text.endsWith(b.text[0]);

/** Format mode: should a space separate `a` and `b` when they sit on the same line? */
function spaceBetween(a: Item, b: Item, afterSign: boolean): boolean {
  if (isComment(a) || isComment(b) || quoteMergeRisk(a, b)) return true;
  // Two operators are never joined: - - would become a -- comment, < > would become <>.
  if (a.kind === 'operator' && b.kind === 'operator') return true;
  if (afterSign) return false;
  const ak = a.kind;
  const bk = b.kind;
  if (bk === 'comma' || bk === 'semicolon') return false;
  if (ak === 'comma') return true;
  // A dot next to a number keeps the input's spacing: 1 . 5 written as 1.5 would become one number.
  if (ak === 'dot' || bk === 'dot') return dotMergeRisk(a, b) ? b.spaceBefore : false;
  if (ak === 'open' || ak === 'openBracket') return false;
  if (bk === 'close' || bk === 'closeBracket') return false;
  if (a.text === '::' || b.text === '::') return (a.text === '::' && b.text.startsWith(':')) || (b.text === '::' && a.text.endsWith(':'));
  if (bk === 'openBracket') return ak === 'operator';
  if (bk === 'open') {
    // MySQL rejects COUNT (*) for its built-in functions, so a known function never gets a space.
    if (ak === 'function') return false;
    // A table or a user-defined function: keep whatever the input had.
    if (ak === 'ident' || ak === 'quoted' || ak === 'close' || ak === 'closeBracket') return b.spaceBefore;
    return true;
  }
  // Charset introducers (_utf8mb4'text') and similar prefixes: keep whatever the input had.
  if (ak === 'ident' && bk === 'string') return b.spaceBefore;
  return true;
}

// ---------------------------------------------------------------------------------------------
// 3b. Format
// ---------------------------------------------------------------------------------------------

interface Frame {
  type: 'root' | 'paren' | 'case';
  /** Indent level of this frame's clause keywords (and of the ) that closes a paren frame, minus one). */
  base: number;
  /** Current clause ('' before the first one). */
  clause: string;
  /** First clause of the statement in this frame (INSERT INTO, UPDATE, ALTER TABLE …). */
  stmt: string;
  subquery: boolean;
  /** Saw BETWEEN; the next AND belongs to it. */
  betweenAnd: boolean;
  /** The column list of a CREATE TABLE. */
  ddl: boolean;
  /** Items written since this frame's last comma or its opening bracket. */
  itemIndex: number;
}

const newFrame = (type: Frame['type'], base: number, subquery = false, ddl = false): Frame => ({
  type,
  base,
  clause: '',
  stmt: '',
  subquery,
  betweenAnd: false,
  ddl,
  itemIndex: 0,
});

/** Line-based writer. Multi-line tokens (block comments, strings) are written verbatim. */
class Writer {
  lines: { indent: number; text: string }[] = [];
  cur = { indent: 0, text: '' };
  last: Item | null = null;
  afterSign = false;

  newline(indent: number) {
    if (this.cur.text !== '') this.lines.push(this.cur);
    this.cur = { indent, text: '' };
    this.last = null;
    this.afterSign = false;
  }
  blankLine() {
    if (this.cur.text !== '') this.lines.push(this.cur);
    if (this.lines.length) this.lines.push({ indent: 0, text: '' });
    this.cur = { indent: 0, text: '' };
    this.last = null;
    this.afterSign = false;
  }
  put(it: Item, text = it.text) {
    if (this.cur.text !== '' && this.last && spaceBetween(this.last, it, this.afterSign)) this.cur.text += ' ';
    this.cur.text += text;
    this.last = it;
    this.afterSign = false;
  }
  finish(unit: string): string {
    if (this.cur.text !== '') this.lines.push(this.cur);
    return this.lines.map((l) => (l.text === '' ? '' : unit.repeat(l.indent) + l.text)).join('\n');
  }
}

/** Items i..j (a bracketed group) written on one line. */
function flatText(items: Item[], i: number, j: number, prevCode: Item | null): string {
  let out = '';
  let last: Item | null = null;
  let afterSign = false;
  let pc = prevCode;
  for (let k = i; k <= j; k++) {
    const it = items[k];
    if (last && spaceBetween(last, it, afterSign)) out += ' ';
    out += it.text;
    afterSign = isSign(it, pc);
    last = it;
    pc = it;
  }
  return out;
}

/** True when the group i..j can be written on one line of at most INLINE_WIDTH characters.
 *  Stops reading as soon as the answer is known, so long groups cost almost nothing. */
function fitsInline(items: Item[], i: number, j: number, prevCode: Item | null): boolean {
  let len = 0;
  let last: Item | null = null;
  let afterSign = false;
  let pc = prevCode;
  for (let k = i; k <= j; k++) {
    const it = items[k];
    if (isComment(it) || it.kind === 'semicolon') return false;
    if (it.kind === 'open' && isSubqueryStart(items[k + 1])) return false;
    if (last && spaceBetween(last, it, afterSign)) len++;
    len += it.text.length;
    if (len > INLINE_WIDTH) return false;
    afterSign = isSign(it, pc);
    last = it;
    pc = it;
  }
  return true;
}

/** Only literals and commas inside: an IN list or a VALUES row. Stays on one line at any length. */
function isValueList(items: Item[], i: number, j: number): boolean {
  for (let k = i + 1; k < j; k++) {
    const it = items[k];
    const ok =
      it.kind === 'number' || it.kind === 'string' || it.kind === 'param' || it.kind === 'comma' ||
      (it.kind === 'operator' && (it.text === '-' || it.text === '+')) ||
      (it.kind === 'keyword' && (it.upper === 'NULL' || it.upper === 'TRUE' || it.upper === 'FALSE' || it.upper === 'DEFAULT'));
    if (!ok) return false;
  }
  return true;
}

function isSubqueryStart(it: Item | undefined): boolean {
  if (!it) return false;
  return (it.kind === 'clause' && (it.upper.startsWith('SELECT') || it.upper === 'WITH' || it.upper === 'WITH RECURSIVE' || it.upper === 'VALUES'));
}

function hasComment(items: Item[], i: number, j: number): boolean {
  for (let k = i; k <= j; k++) if (isComment(items[k])) return true;
  return false;
}

function layout(items: Item[], opts: FormatOptions): string {
  const unit = opts.indent === 'tab' ? '\t' : ' '.repeat(opts.indent);
  const pair = matchParens(items);
  const w = new Writer();
  let frames: Frame[] = [newFrame('root', 0)];
  const top = () => frames[frames.length - 1];
  const contentIndent = (f: Frame) => (f.type === 'case' ? f.base + 1 : f.clause ? f.base + 1 : f.base);
  let pending: number | null = null; // the next item starts a new line at this indent
  let pendingBlank = false; // …after an empty line (between statements)
  // Last non-comment item written. Assigned inside put()/putFlat(), which TypeScript's flow analysis
  // does not see from the loop below, hence the widening `as`.
  let prevCode = null as Item | null;

  // SQL Server reads GO alone on a line as a batch separator, so a column or alias that happens to
  // be called go must never end up alone on a line. It stays on the line before it; if a line
  // comment forces a break, whatever follows it is held on its line instead.
  let holdLine = false;
  const nameGo = (it: Item) => opts.dialect === 'sqlserver' && it.kind === 'ident' && it.text.toUpperCase() === 'GO';

  const startLine = (indent: number) => {
    if (holdLine) { holdLine = false; pending = null; pendingBlank = false; return; }
    if (pendingBlank) { w.blankLine(); pendingBlank = false; }
    w.newline(indent);
    pending = null;
  };
  const put = (it: Item) => {
    if (nameGo(it) && w.cur.text !== '' && w.last?.kind !== 'lineComment' && w.last?.kind !== 'go') {
      pending = null;
      pendingBlank = false;
    }
    if (pendingBlank || pending !== null) startLine(pending ?? 0);
    const holdAfter = nameGo(it) && w.cur.text === '';
    w.put(it);
    holdLine = holdAfter;
    if (!isComment(it)) {
      w.afterSign = isSign(it, prevCode);
      prevCode = it;
      top().itemIndex++;
    }
  };
  const nextCode = (i: number) => {
    for (let k = i + 1; k < items.length; k++) if (!isComment(items[k])) return items[k];
    return undefined;
  };
  /** Write the group i..pair[i] on the current line; returns its closing index. */
  const putFlat = (i: number) => {
    const j = pair[i];
    if (pendingBlank || pending !== null) startLine(pending ?? 0);
    const text = flatText(items, i, j, prevCode);
    w.put(items[i], text);
    holdLine = false;
    w.last = items[j];
    prevCode = items[j];
    top().itemIndex++;
    return j;
  };
  const resetStatement = () => { frames = [newFrame('root', 0)]; };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const f = top();
    // Inside a function call or a window spec only the window clauses keep their layout role;
    // FROM in EXTRACT(YEAR FROM d) is just a word.
    const plainParen = f.type === 'paren' && !f.subquery;
    const demote = (f.type === 'case') ||
      (plainParen && !(it.kind === 'clause' && (it.upper === 'PARTITION BY' || it.upper === 'ORDER BY')));

    switch (it.kind) {
      case 'lineComment':
      case 'blockComment': {
        const trailing = !it.nlBefore && w.cur.text !== '';
        if (trailing) {
          w.put(it); // stays on the line it followed, even if a new line was due
          holdLine = false;
        } else {
          const nx = nextCode(i);
          const beforeClause = nx && (nx.kind === 'clause' || nx.kind === 'inlineClause' || nx.kind === 'setop') && !(f.type === 'case' || plainParen);
          startLine(beforeClause ? f.base : pending ?? contentIndent(f));
          w.put(it);
        }
        if ((it.kind === 'lineComment' || !trailing) && pending === null && !pendingBlank) pending = contentIndent(top());
        break;
      }

      case 'clause': {
        let role = it.upper;
        let keywordOnly = demote;
        if (role === 'WITH' || role === 'WITH RECURSIVE') {
          const ok = !prevCode || prevCode.kind === 'semicolon' || prevCode.kind === 'open' || prevCode.kind === 'go' || prevCode.upper === 'AS';
          if (!ok) keywordOnly = true;
        }
        if (role === 'SET') {
          const ok = !prevCode || prevCode.kind === 'semicolon' || prevCode.kind === 'go' || f.stmt === 'UPDATE' || f.clause === 'UPDATE' || f.stmt.startsWith('MERGE') || f.clause.startsWith('WHEN ');
          if (!ok) keywordOnly = true;
        }
        if (keywordOnly) { put({ ...it, kind: 'keyword' }); break; }
        startLine(f.base);
        put(it);
        f.clause = role;
        if (!f.stmt) f.stmt = role;
        // Modifiers that belong on the SELECT line: TOP 10 / TOP (10) [PERCENT] [WITH TIES], DISTINCT ON (a)
        if (role.startsWith('SELECT') && items[i + 1]?.upper === 'TOP') {
          put(items[++i]);
          if (items[i + 1]?.kind === 'open' && pair[i + 1] > 0) i = putFlat(i + 1);
          else if (items[i + 1] && (items[i + 1].kind === 'number' || items[i + 1].kind === 'param')) put(items[++i]);
          if (items[i + 1]?.upper === 'PERCENT') put(items[++i]);
          if (items[i + 1]?.upper === 'WITH TIES') put(items[++i]);
        }
        if (role === 'SELECT DISTINCT ON' && items[i + 1]?.kind === 'open' && pair[i + 1] > 0) i = putFlat(i + 1);
        pending = f.base + 1;
        break;
      }

      case 'inlineClause': {
        if (demote) { put({ ...it, kind: 'keyword' }); break; }
        startLine(f.base);
        put(it);
        f.clause = it.upper;
        if (!f.stmt) f.stmt = it.upper;
        break;
      }

      case 'setop': {
        if (demote) { put({ ...it, kind: 'keyword' }); break; }
        startLine(f.base);
        put(it);
        f.clause = '';
        pending = f.base;
        break;
      }

      case 'join': {
        if (demote) { put({ ...it, kind: 'keyword' }); break; }
        startLine(f.base + 1);
        put(it);
        f.clause = 'JOIN';
        break;
      }

      case 'logical': {
        if (it.upper === 'AND' && f.betweenAnd) { f.betweenAnd = false; put(it); break; }
        if (f.type === 'case') { put(it); break; }
        startLine(contentIndent(f) + (f.clause === 'JOIN' ? 1 : 0));
        put(it);
        break;
      }

      case 'between':
        put(it);
        f.betweenAnd = true;
        break;

      case 'case': {
        put(it);
        frames.push(newFrame('case', w.cur.indent));
        break;
      }

      case 'when':
      case 'else':
        if (f.type === 'case') startLine(f.base + 1);
        put(it);
        break;

      case 'end': {
        if (f.type === 'case') {
          startLine(f.base);
          put(it);
          frames.pop();
        } else {
          // END of a BEGIN … END block
          startLine(f.base);
          put(it);
          f.clause = '';
        }
        break;
      }

      case 'alterAction': {
        if (f.stmt === 'ALTER TABLE' && !demote) startLine(f.base + 1);
        put(it);
        break;
      }

      case 'go': {
        resetStatement();
        if (w.cur.text !== '' || w.lines.length) pendingBlank = true;
        startLine(0);
        put(it);
        pendingBlank = true;
        break;
      }

      case 'open': {
        const j = pair[i];
        const sub = isSubqueryStart(nextCode(i));
        // CREATE TABLE t ( … ): the column list always gets one column per line.
        const ddl = /^CREATE .*TABLE/.test(f.clause) && (prevCode?.kind === 'ident' || prevCode?.kind === 'quoted') && !plainParen;
        if (j > 0 && !sub && !ddl && !hasComment(items, i, j)) {
          // VALUES rows and IN lists stay on one line at any length.
          const forceInline = f.clause === 'VALUES' || prevCode?.upper === 'IN';
          if (forceInline || fitsInline(items, i, j, prevCode) || isValueList(items, i, j)) {
            i = putFlat(i);
            break;
          }
        }
        put(it);
        frames.push(newFrame('paren', w.cur.indent + 1, sub, ddl));
        pending = w.cur.indent + 1;
        break;
      }

      case 'close': {
        if (pair[i] < 0 || !frames.some((fr) => fr.type === 'paren')) { put(it); break; }
        let fr = frames.pop()!;
        while (fr.type !== 'paren') fr = frames.pop()!;
        startLine(fr.base - 1);
        put(it);
        break;
      }

      case 'comma': {
        const listy = f.type === 'case' ? false : f.type === 'paren' && !f.clause ? true : LIST_CLAUSES.has(f.clause);
        if (!listy) { put(it); break; }
        if (opts.commas === 'start') {
          startLine(contentIndent(f));
          put(it);
        } else {
          put(it);
          pending = contentIndent(f);
        }
        f.itemIndex = 0;
        break;
      }

      case 'semicolon':
        put(it);
        resetStatement();
        pending = null;
        pendingBlank = true;
        break;

      default: {
        // In a CREATE TABLE column list the word after the column name is its type, so the
        // ambiguous type names (date, timestamp, text, json …) are recased there too.
        const up = it.text.toUpperCase();
        if (f.ddl && f.itemIndex === 1 && it.kind === 'ident' && FUNCTIONS.has(up)) {
          put({ ...it, kind: 'keyword', text: recase(it.text, opts.keywordCase), upper: up });
        } else put(it);
      }
    }
  }
  return w.finish(unit);
}

// ---------------------------------------------------------------------------------------------
// 3c. Minify
// ---------------------------------------------------------------------------------------------

const PUNCT = new Set<Kind>(['open', 'close', 'comma', 'semicolon', 'dot', 'openBracket', 'closeBracket']);

function minSpace(a: Item, b: Item): boolean {
  if (isComment(a) || isComment(b) || quoteMergeRisk(a, b)) return true;
  if (a.kind === 'operator' && b.kind === 'operator') return true;
  if (a.text === '::' || b.text === '::') return (a.text === '::' && b.text.startsWith(':')) || (b.text === '::' && a.text.endsWith(':'));
  // Same merge hazards as in format mode: 1 . 5 must not become 1.5, and ).5 would read as ) . 5.
  if (a.kind === 'dot' || b.kind === 'dot') return dotMergeRisk(a, b) ? b.spaceBefore : false;
  if (b.kind === 'number' && b.text.startsWith('.')) return true;
  // SUM(x) AS total, IN (…) GROUP BY: a keyword after ) keeps its space so the line stays readable.
  if (a.kind === 'close' && KEYWORDISH.has(b.kind)) return true;
  if (PUNCT.has(a.kind) || PUNCT.has(b.kind)) return false;
  if (a.kind === 'operator' || b.kind === 'operator') {
    // id=1, but SELECT * FROM keeps its spaces: an operator only sheds them next to a value.
    const op = a.kind === 'operator' ? a : b;
    const other = a.kind === 'operator' ? b : a;
    if (KEYWORDISH.has(other.kind)) return true;
    // Parameters start and end with operator-like characters: < @v would read as the <@ operator,
    // ? | as ?|. They always keep their spaces.
    if (other.kind === 'param') return true;
    // $ can continue a name (x$ y), and $ @ : # before a name start a parameter or a temp table
    // ($1, @x, :x, #t), so these operators keep their spaces.
    if (op.text.startsWith('$') || (op === a && /^[@:#]/.test(op.text))) return true;
    // U & 's' would become PostgreSQL's U&'s' (a Unicode-escape string).
    if (op === a && op.text === '&' && (b.kind === 'string' || b.kind === 'quoted')) return true;
    return false;
  }
  if (a.kind === 'ident' && b.kind === 'string') return b.spaceBefore;
  return true;
}

/** Comments that change what a query does: MySQL's executable comments and optimizer hints. */
const keepComment = (it: Item) => it.kind === 'blockComment' && (it.text.startsWith('/*!') || it.text.startsWith('/*+'));

function compact(items: Item[]): string {
  const lines: string[] = [];
  let line = '';
  let last: Item | null = null;
  let gap = false; // a removed comment separated this item from the last one, like a space
  const flush = () => { if (line) lines.push(line); line = ''; last = null; };
  for (const raw of items) {
    if (isComment(raw) && !keepComment(raw)) { gap = true; continue; }
    const it = gap && !raw.spaceBefore ? { ...raw, spaceBefore: true } : raw;
    gap = false;
    if (it.kind === 'go') { flush(); lines.push(it.text); continue; }
    if (last && minSpace(last, it)) line += ' ';
    line += it.text;
    last = it;
    if (it.kind === 'semicolon') flush();
  }
  flush();
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// 4. Lint: the mistakes that stop a statement from running in every dialect
// ---------------------------------------------------------------------------------------------

export type SqlIssueCode = 'unterminated' | 'unmatched_close' | 'unclosed_open' | 'trailing_comma' | 'double_comma';

export interface SqlIssue {
  code: SqlIssueCode;
  line: number;
  column: number;
  message: string;
}

const MAX_ISSUES = 20;

function lint(sql: string, items: Item[], dialect: Dialect): SqlIssue[] {
  const issues: SqlIssue[] = [];
  const add = (code: SqlIssueCode, pos: number, message: string) => {
    if (issues.length >= MAX_ISSUES) return;
    const { line, column } = offsetToLineColumn(sql, pos);
    issues.push({ code, line, column, message });
  };
  const code = items.filter((it) => !isComment(it));

  for (const it of items) {
    if (!it.unterminated) continue;
    const what = {
      string: 'This string is never closed.',
      quoted: 'This quoted name is never closed.',
      comment: 'This comment is never closed: there is no */ after it.',
      dollar: 'This $$ body is never closed: there is no matching tag after it.',
    }[it.unterminated];
    const hint =
      it.unterminated === 'string' && dialect !== 'mysql' && dialect !== 'bigquery' && sql.includes("\\'")
        ? " The query uses \\' inside a string: that is a MySQL/BigQuery escape; pick that dialect, or write '' instead."
        : '';
    add('unterminated', it.pos, what + hint);
  }

  let open: Item[] = [];
  const closeStatement = () => {
    for (const o of open) add('unclosed_open', o.pos, 'This ( is never closed.');
    open = [];
  };
  code.forEach((it, k) => {
    if (it.kind === 'open') open.push(it);
    else if (it.kind === 'close') {
      if (open.length) open.pop();
      else add('unmatched_close', it.pos, 'This ) has no ( to close.');
    } else if (it.kind === 'semicolon' || it.kind === 'go') closeStatement();
    else if (it.kind === 'comma') {
      const nx = code[k + 1];
      if (!nx || nx.kind === 'semicolon' || nx.kind === 'go') add('trailing_comma', it.pos, 'Comma at the end of the statement, with nothing after it.');
      else if (nx.kind === 'comma') add('double_comma', it.pos, 'Two commas in a row: an item is missing between them.');
      else if (nx.kind === 'close') add('trailing_comma', it.pos, 'Comma right before ): remove it, or add the missing item.');
      else if (nx.kind === 'clause' || nx.kind === 'inlineClause' || nx.kind === 'setop' || nx.kind === 'join') {
        // BigQuery accepts a trailing comma at the end of the SELECT list.
        if (!(dialect === 'bigquery' && nx.upper === 'FROM')) {
          add('trailing_comma', it.pos, `Comma right before ${nx.upper}: remove the comma after the last item.`);
        }
      }
    }
  });
  closeStatement();
  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export interface SqlResult {
  output: string;
  issues: SqlIssue[];
  /** Statements that contain any SQL (comments alone do not count). */
  statements: number;
}

function countStatements(items: Item[]): number {
  let count = 0;
  let hasCode = false;
  for (const it of items) {
    if (it.kind === 'semicolon' || it.kind === 'go') {
      if (hasCode) count++;
      hasCode = false;
    } else if (!isComment(it)) hasCode = true;
  }
  return count + (hasCode ? 1 : 0);
}

function run(sql: string, opts: Partial<FormatOptions>, mode: 'format' | 'minify'): SqlResult {
  const o: FormatOptions = { ...DEFAULT_OPTIONS, ...opts };
  if (!sql.trim()) return { output: '', issues: [], statements: 0 };
  const items = classify(tokenize(sql, o.dialect), o.dialect, o.keywordCase);
  return {
    output: mode === 'format' ? layout(items, o) : compact(items),
    issues: lint(sql, items, o.dialect),
    statements: countStatements(items),
  };
}

export function formatSql(sql: string, opts: Partial<FormatOptions> = {}): SqlResult {
  return run(sql, opts, 'format');
}

export function minifySql(sql: string, opts: Partial<FormatOptions> = {}): SqlResult {
  return run(sql, opts, 'minify');
}

/** What "Load sample" inserts, and the page's worked example. */
export const SAMPLE_SQL =
  "select o.id, c.name as customer, sum(oi.quantity * oi.unit_price) as total, case when o.status = 'shipped' then 'done' else 'open' end as state from orders o join customers c on c.id = o.customer_id left join order_items oi on oi.order_id = o.id where o.created_at >= '2026-01-01' and c.country in ('US', 'CA') group by o.id, c.name, o.status having sum(oi.quantity) > 2 order by total desc limit 20;";
