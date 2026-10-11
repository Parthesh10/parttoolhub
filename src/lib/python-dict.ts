/**
 * Convert a Python literal (dict / list / tuple / set / scalars, as printed by
 * repr() or written in source) into JSON. Pure, no DOM.
 *
 * Handles: single/double/triple-quoted strings with escapes and r/u/b/f
 * prefixes, adjacent string concatenation, True/False/None, ints with
 * underscores and 0x/0o/0b prefixes, floats, tuples and sets (→ arrays),
 * trailing commas, and # comments.
 *
 * Values are built as json-exact's JsonValue, never as JavaScript numbers and objects: a Python int
 * has no size limit (12345678901234567890 must come out with every digit), a float is written the way
 * Python's json.dumps writes it (1.0 stays 1.0, 1e16 is 1e+16), and object keys keep the order they
 * were written in (a plain JS object moves integer-like keys such as "2" to the front).
 */
import { parseJson, offsetToLineColumn } from './json-parse';
import { parseExact, type JsonValue } from './json-exact';

// `pos` is each token's starting character offset in the original source — needed so a parser
// error (which only knows a *token index*) can still report a real line/column, not a
// meaningless token count. Every PyError below carries a character offset, never a token index.
type Token =
  | { t: 'str'; v: string; pos: number }
  // An int keeps every digit as a BigInt; a float is a double, exactly as in Python.
  | { t: 'num'; int: bigint | null; f: number; pos: number }
  | { t: 'name'; v: string; pos: number }
  | { t: 'p'; v: string; pos: number }
  | { t: 'eof'; pos: number };

export class PyError extends Error {
  constructor(message: string, public position: number) {
    super(message);
  }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v',
  '\\': '\\', "'": "'", '"': '"', a: '\x07',
};

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const tokenStart = i;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }

    // String, optionally prefixed (r, b, u, f, rb, br…)
    const prefix = src.slice(i).match(/^([rRbBuUfF]{0,2})(['"])/);
    if (prefix) {
      const raw = /[rR]/.test(prefix[1]);
      const bytes = /[bB]/.test(prefix[1]);
      i += prefix[1].length;
      const q = src[i];
      const triple = src.startsWith(q.repeat(3), i);
      const closer = triple ? q.repeat(3) : q;
      i += closer.length;
      let out = '';
      const start = i;
      for (;;) {
        if (i >= n) throw new PyError('Unterminated string.', start);
        if (src.startsWith(closer, i)) { i += closer.length; break; }
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) {
          const next = src[i + 1];
          if (raw) { out += ch + next; i += 2; continue; }
          if (next === '\n') { i += 2; continue; } // line continuation
          // \x, \u and \U take exactly 2, 4 and 8 hex digits, as Python requires (it rejects '\xZZ';
          // this used to turn it into a NUL). A bytes literal has no \u or \U: there they stay as written.
          const hexLen = next === 'x' ? 2 : bytes ? 0 : next === 'u' ? 4 : next === 'U' ? 8 : 0;
          if (hexLen) {
            const hex = src.slice(i + 2, i + 2 + hexLen);
            if (hex.length !== hexLen || /[^0-9a-fA-F]/.test(hex)) throw new PyError(`A \\${next} escape needs exactly ${hexLen} hex digits.`, i);
            const code = parseInt(hex, 16);
            if (code > 0x10ffff) throw new PyError('A \\U escape cannot go past 0010FFFF, the last Unicode code point.', i);
            out += String.fromCodePoint(code); i += 2 + hexLen; continue;
          }
          // Octal: one to three digits, so '\012' is a newline and '\0' a NUL.
          const octal = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4));
          if (octal) { out += String.fromCharCode(parseInt(octal[0], 8)); i += 1 + octal[0].length; continue; }
          if (next in SIMPLE_ESCAPES) { out += SIMPLE_ESCAPES[next]; i += 2; continue; }
          out += ch + next; i += 2; continue;
        }
        if (!triple && ch === '\n') throw new PyError('Unterminated string (newline inside quotes).', start);
        out += ch; i++;
      }
      toks.push({ t: 'str', v: out, pos: tokenStart });
      continue;
    }

    // Number
    const num = src.slice(i).match(/^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?j?)/);
    if (num && /^[\d.]/.test(num[0])) {
      const text = num[0].replace(/_/g, '');
      if (/j$/.test(text)) throw new PyError('Complex numbers have no JSON equivalent.', i);
      if (/^0[xXoObB].|^\d+$/.test(text)) toks.push({ t: 'num', int: BigInt(text), f: 0, pos: tokenStart });
      else if (/^0[xXoObB]$/.test(text)) throw new PyError('A number prefix with no digits after it.', i);
      else toks.push({ t: 'num', int: null, f: Number(text), pos: tokenStart });
      i += num[0].length;
      continue;
    }

    const name = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (name) { toks.push({ t: 'name', v: name[0], pos: tokenStart }); i += name[0].length; continue; }

    if ('{}[](),:-+'.includes(c)) { toks.push({ t: 'p', v: c, pos: tokenStart }); i++; continue; }

    // The whole character: src[i] alone would be half of an emoji's surrogate pair, shown as "�".
    throw new PyError(`Unexpected character "${String.fromCodePoint(src.codePointAt(i)!)}".`, i);
  }
  toks.push({ t: 'eof', pos: n });
  return toks;
}

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}

  private peek(): Token { return this.toks[this.i]; }
  /** Never steps past the end-of-input token, so "float(" reports a missing ")" instead of crashing. */
  private next(): Token {
    const t = this.toks[this.i];
    if (t.t !== 'eof') this.i++;
    return t;
  }
  private isP(v: string): boolean { const t = this.peek(); return t.t === 'p' && t.v === v; }
  /** The current token's real character offset in the source — `this.i` is only a token index,
   *  which would be a meaningless "line/column" if fed straight into offsetToLineColumn. */
  private pos(): number { return this.peek().pos; }
  private expectP(v: string) {
    if (!this.isP(v)) throw new PyError(`Expected "${v}".`, this.pos());
    this.i++;
  }

  parseTop(): JsonValue {
    const v = this.parseValue();
    if (this.peek().t !== 'eof') throw new PyError('Unexpected content after the end of the value.', this.pos());
    return v;
  }

  private parseValue(): JsonValue {
    const t = this.peek();
    if (t.t === 'p') {
      if (t.v === '{') return this.parseBraces();
      if (t.v === '[') { this.next(); return this.parseSequence(']'); }
      if (t.v === '(') { this.next(); return this.parseSequence(')'); }
      if (t.v === '-' || t.v === '+') {
        this.next();
        const n = this.next();
        if (n.t !== 'num') throw new PyError('Expected a number after the sign.', n.pos);
        const neg = t.v === '-';
        return n.int !== null ? intValue(neg ? -n.int : n.int) : floatValue(neg ? -n.f : n.f);
      }
    }
    if (t.t === 'str') {
      // Adjacent literals concatenate: 'a' 'b' → 'ab'
      let s = '';
      while (this.peek().t === 'str') s += (this.next() as { v: string }).v;
      return { t: 'string', v: s };
    }
    if (t.t === 'num') { this.next(); return t.int !== null ? intValue(t.int) : floatValue(t.f); }
    if (t.t === 'name') {
      this.next();
      switch (t.v) {
        case 'True': return { t: 'boolean', v: true };
        case 'False': return { t: 'boolean', v: false };
        case 'None': return NULL;
        case 'nan': case 'inf': return NULL;
        case 'float': {
          // float('inf') / float('nan') → null
          this.expectP('('); this.next(); this.expectP(')');
          return NULL;
        }
        case 'set': case 'frozenset': case 'list': case 'tuple': case 'dict': {
          this.expectP('(');
          const inner: JsonValue = this.isP(')') ? (t.v === 'dict' ? { t: 'object', v: new Map() } : { t: 'array', v: [] }) : this.parseValue();
          this.expectP(')');
          return inner;
        }
        case 'OrderedDict': case 'defaultdict': case 'Counter': {
          this.expectP('(');
          let inner: JsonValue = { t: 'object', v: new Map() };
          while (!this.isP(')')) {
            const v = this.parseValue();
            if (v.t === 'object') inner = v;
            // OrderedDict's repr is a list of (key, value) pairs, not a dict:
            // OrderedDict([('a', 1), ('b', 2)]) — rebuild the object from them.
            else if (v.t === 'array' && v.v.every((p) => p.t === 'array' && p.v.length === 2)) {
              const obj = new Map<string, JsonValue>();
              for (const p of v.v as { t: 'array'; v: [JsonValue, JsonValue] }[]) obj.set(keyToString(p.v[0], this.pos()), p.v[1]);
              inner = { t: 'object', v: obj };
            }
            if (this.isP(',')) this.next();
          }
          this.expectP(')');
          return inner;
        }
        default:
          throw new PyError(`"${t.v}" is a variable or unsupported name; JSON can only hold literal values.`, t.pos);
      }
    }
    if (t.t === 'eof') throw new PyError('Unexpected end of input.', t.pos);
    throw new PyError(`Unexpected "${(t as { v: string }).v}".`, t.pos);
  }

  private parseSequence(closer: string): JsonValue {
    const out: JsonValue[] = [];
    let comma = false;
    while (!this.isP(closer)) {
      out.push(this.parseValue());
      if (this.isP(',')) { this.next(); comma = true; continue; }
      if (!this.isP(closer)) throw new PyError(`Expected "," or "${closer}".`, this.pos());
    }
    this.next();
    // In Python (1) is just 1 in brackets; only (1,) is a one-item tuple.
    if (closer === ')' && out.length === 1 && !comma) return out[0];
    return { t: 'array', v: out };
  }

  private parseBraces(): JsonValue {
    this.expectP('{');
    if (this.isP('}')) { this.next(); return { t: 'object', v: new Map() }; }
    const first = this.parseValue();
    if (this.isP(':')) {
      // dict. A repeated key keeps its first position and its last value, as a Python dict does.
      this.next();
      const obj = new Map<string, JsonValue>();
      obj.set(keyToString(first, this.pos()), this.parseValue());
      while (this.isP(',')) {
        this.next();
        if (this.isP('}')) break;
        const k = this.parseValue();
        this.expectP(':');
        obj.set(keyToString(k, this.pos()), this.parseValue());
      }
      this.expectP('}');
      return { t: 'object', v: obj };
    }
    // set → array
    const arr = [first];
    while (this.isP(',')) {
      this.next();
      if (this.isP('}')) break;
      arr.push(this.parseValue());
    }
    this.expectP('}');
    return { t: 'array', v: arr };
  }
}

const NULL: JsonValue = { t: 'null' };
const intValue = (n: bigint): JsonValue => ({ t: 'number', v: n.toString() });
/** A float as json.dumps writes it; NaN and ±Infinity have no JSON form and become null. */
const floatValue = (f: number): JsonValue => (Number.isFinite(f) ? { t: 'number', v: pyFloatRepr(f) } : NULL);

/**
 * Python's repr() of a float, which is what json.dumps writes: the shortest digits that read back
 * as the same double (JavaScript picks the same digits), in fixed notation while the decimal point
 * sits between 10^-4 and 10^16 and in exponent notation (at least two exponent digits) outside it.
 * Fixed notation always has a fractional part: 1.0, not 1.
 */
export function pyFloatRepr(f: number): string {
  if (f === 0) return Object.is(f, -0) ? '-0.0' : '0.0';
  const sign = f < 0 ? '-' : '';
  const [mantissa, exponent] = Math.abs(f).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exp = Number(exponent);
  const point = exp + 1; // digits before the decimal point
  if (point > -4 && point <= 16) {
    if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
    if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const lead = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${lead}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
}

/** Mirror json.dumps: str keys as-is, numbers/bools/None stringified. */
function keyToString(k: JsonValue, pos: number): string {
  if (k.t === 'string' || k.t === 'number') return k.v;
  if (k.t === 'boolean') return k.v ? 'true' : 'false';
  if (k.t === 'null') return 'null';
  throw new PyError('Dictionary keys must be strings, numbers, booleans or None to become JSON.', pos);
}

/** Code-point order, as Python's sorted() compares str. JavaScript's default sort compares UTF-16
 *  units instead, which puts an emoji (a surrogate pair) before U+E000–U+FFFF. */
function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x - y;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

function sortDeep(value: JsonValue): JsonValue {
  if (value.t === 'array') return { t: 'array', v: value.v.map(sortDeep) };
  if (value.t === 'object') {
    const keys = [...value.v.keys()].sort(compareCodePoints);
    return { t: 'object', v: new Map(keys.map((k) => [k, sortDeep(value.v.get(k)!)])) };
  }
  return value;
}

/** JSON text laid out exactly as JSON.stringify(value, null, unit) would, with numbers as written. */
function stringify(value: JsonValue, unit: string, depth = 0): string {
  switch (value.t) {
    case 'string': return JSON.stringify(value.v);
    case 'number': return value.v;
    case 'boolean': return String(value.v);
    case 'null': return 'null';
    case 'array': {
      if (!value.v.length) return '[]';
      if (!unit) return `[${value.v.map((x) => stringify(x, unit)).join(',')}]`;
      const pad = unit.repeat(depth + 1);
      return `[\n${value.v.map((x) => pad + stringify(x, unit, depth + 1)).join(',\n')}\n${unit.repeat(depth)}]`;
    }
    case 'object': {
      if (!value.v.size) return '{}';
      const sep = unit ? ': ' : ':';
      const items = [...value.v].map(([k, x]) => `${JSON.stringify(k)}${sep}${stringify(x, unit, depth + 1)}`);
      if (!unit) return `{${items.join(',')}}`;
      const pad = unit.repeat(depth + 1);
      return `{\n${items.map((s) => pad + s).join(',\n')}\n${unit.repeat(depth)}}`;
    }
  }
}

export interface PyToJsonOptions {
  indent: 2 | 4 | 'tab' | 0;
  sortKeys: boolean;
}

export type PyToJsonResult =
  | { ok: true; output: string }
  | { ok: false; error: string; position?: number; line?: number; column?: number };

const indentUnit = (indent: 2 | 4 | 'tab' | 0) => (indent === 'tab' ? '\t' : ' '.repeat(indent));

export function pythonToJson(src: string, opts: Partial<PyToJsonOptions> = {}): PyToJsonResult {
  const o: PyToJsonOptions = { indent: 2, sortKeys: false, ...opts };
  if (!src.trim()) return { ok: false, error: 'Paste a Python dict, list or other literal.' };
  try {
    let value = new Parser(tokenize(src)).parseTop();
    if (o.sortKeys) value = sortDeep(value);
    return { ok: true, output: stringify(value, indentUnit(o.indent)) };
  } catch (e) {
    if (e instanceof PyError) return { ok: false, error: e.message, position: e.position, ...offsetToLineColumn(src, e.position) };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface JsonToPyOptions {
  indent: 2 | 4 | 'tab' | 0;
  sortKeys: boolean;
}

export type JsonToPyResult = { ok: true; output: string } | { ok: false; error: string; line?: number; column?: number };

/**
 * The reverse direction: JSON text → Python literal source. `indent: 0` writes
 * a single line (still valid Python, just not pretty-printed) rather than a
 * byte-minified one — there is no equivalent of JSON minification for source code.
 */
export function jsonToPython(src: string, opts: Partial<JsonToPyOptions> = {}): JsonToPyResult {
  const o: JsonToPyOptions = { indent: 4, sortKeys: false, ...opts };
  const parsed = parseJson(src, 'Paste JSON to convert.');
  if (!parsed.ok) return parsed;
  // The exact tree, not parsed.value: keys keep their written order and numbers every digit
  // (a JSON number is already a valid Python literal, so its text is used as it stands).
  let value = parseExact(src);
  if (o.sortKeys) value = sortDeep(value);
  const compact = o.indent === 0;
  const unit = o.indent === 'tab' ? '\t' : ' '.repeat(compact ? 0 : o.indent);
  const pad = (d: number) => unit.repeat(d);
  const str = (s: string) =>
    `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
      // Any other control character written raw would break the literal (a NUL is not even allowed in source).
      .replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}'`;
  const repr = (v: JsonValue, d: number): string => {
    if (v.t === 'null') return 'None';
    if (v.t === 'boolean') return v.v ? 'True' : 'False';
    if (v.t === 'number') return v.v;
    if (v.t === 'string') return str(v.v);
    if (v.t === 'array') {
      if (!v.v.length) return '[]';
      if (compact) return `[${v.v.map((x) => repr(x, 0)).join(', ')}]`;
      return `[\n${v.v.map((x) => pad(d + 1) + repr(x, d + 1)).join(',\n')}\n${pad(d)}]`;
    }
    const entries = [...v.v].map(([k, x]): [JsonValue, JsonValue] => [{ t: 'string', v: k }, x]);
    if (!entries.length) return '{}';
    if (compact) return `{${entries.map(([k, x]) => `${repr(k, 0)}: ${repr(x, 0)}`).join(', ')}}`;
    return `{\n${entries.map(([k, x]) => `${pad(d + 1)}${repr(k, d + 1)}: ${repr(x, d + 1)}`).join(',\n')}\n${pad(d)}}`;
  };
  return { ok: true, output: repr(value, 0) };
}
