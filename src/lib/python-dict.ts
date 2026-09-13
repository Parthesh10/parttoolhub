/**
 * Convert a Python literal (dict / list / tuple / set / scalars, as printed by
 * repr() or written in source) into JSON. Pure, no DOM.
 *
 * Handles: single/double/triple-quoted strings with escapes and r/u/b/f
 * prefixes, adjacent string concatenation, True/False/None, ints with
 * underscores and 0x/0o/0b prefixes, floats, tuples and sets (→ arrays),
 * trailing commas, and # comments.
 */
type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'p'; v: string }
  | { t: 'eof' };

export class PyError extends Error {
  constructor(message: string, public position: number) {
    super(message);
  }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', f: '\f', v: '\v',
  '\\': '\\', "'": "'", '"': '"', a: '\x07',
};

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }

    // String, optionally prefixed (r, b, u, f, rb, br…)
    const prefix = src.slice(i).match(/^([rRbBuUfF]{0,2})(['"])/);
    if (prefix) {
      const raw = /[rR]/.test(prefix[1]);
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
          if (next === 'x') { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)); i += 4; continue; }
          if (next === 'u') { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
          if (next === 'U') { out += String.fromCodePoint(parseInt(src.slice(i + 2, i + 10), 16)); i += 10; continue; }
          if (next in SIMPLE_ESCAPES) { out += SIMPLE_ESCAPES[next]; i += 2; continue; }
          out += ch + next; i += 2; continue;
        }
        if (!triple && ch === '\n') throw new PyError('Unterminated string (newline inside quotes).', start);
        out += ch; i++;
      }
      toks.push({ t: 'str', v: out });
      continue;
    }

    // Number
    const num = src.slice(i).match(/^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?j?)/);
    if (num && /^[\d.]/.test(num[0])) {
      const text = num[0].replace(/_/g, '');
      if (/j$/.test(text)) throw new PyError('Complex numbers have no JSON equivalent.', i);
      let v: number;
      if (/^0[xX]/.test(text)) v = parseInt(text.slice(2), 16);
      else if (/^0[oO]/.test(text)) v = parseInt(text.slice(2), 8);
      else if (/^0[bB]/.test(text)) v = parseInt(text.slice(2), 2);
      else v = Number(text);
      toks.push({ t: 'num', v });
      i += num[0].length;
      continue;
    }

    const name = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (name) { toks.push({ t: 'name', v: name[0] }); i += name[0].length; continue; }

    if ('{}[](),:-+'.includes(c)) { toks.push({ t: 'p', v: c }); i++; continue; }

    throw new PyError(`Unexpected character "${c}".`, i);
  }
  toks.push({ t: 'eof' });
  return toks;
}

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}

  private peek(): Token { return this.toks[this.i]; }
  private next(): Token { return this.toks[this.i++]; }
  private isP(v: string): boolean { const t = this.peek(); return t.t === 'p' && t.v === v; }
  private expectP(v: string) {
    if (!this.isP(v)) throw new PyError(`Expected "${v}".`, this.i);
    this.i++;
  }

  parseTop(): unknown {
    const v = this.parseValue();
    if (this.peek().t !== 'eof') throw new PyError('Unexpected content after the end of the value.', this.i);
    return v;
  }

  private parseValue(): unknown {
    const t = this.peek();
    if (t.t === 'p') {
      if (t.v === '{') return this.parseBraces();
      if (t.v === '[') { this.next(); return this.parseSequence(']'); }
      if (t.v === '(') { this.next(); return this.parseSequence(')'); }
      if (t.v === '-' || t.v === '+') {
        this.next();
        const n = this.next();
        if (n.t !== 'num') throw new PyError('Expected a number after the sign.', this.i);
        return t.v === '-' ? -n.v : n.v;
      }
    }
    if (t.t === 'str') {
      // Adjacent literals concatenate: 'a' 'b' → 'ab'
      let s = '';
      while (this.peek().t === 'str') s += (this.next() as { v: string }).v;
      return s;
    }
    if (t.t === 'num') { this.next(); return t.v; }
    if (t.t === 'name') {
      this.next();
      switch (t.v) {
        case 'True': return true;
        case 'False': return false;
        case 'None': return null;
        case 'nan': case 'inf': return null;
        case 'float': {
          // float('inf') / float('nan') → null
          this.expectP('('); this.next(); this.expectP(')');
          return null;
        }
        case 'set': case 'frozenset': case 'list': case 'tuple': case 'dict': {
          this.expectP('(');
          const inner = this.isP(')') ? (t.v === 'dict' ? {} : []) : this.parseValue();
          this.expectP(')');
          return inner;
        }
        case 'OrderedDict': case 'defaultdict': case 'Counter': {
          this.expectP('(');
          let inner: unknown = {};
          while (!this.isP(')')) {
            const v = this.parseValue();
            if (v && typeof v === 'object' && !Array.isArray(v)) inner = v;
            // OrderedDict's repr is a list of (key, value) pairs, not a dict:
            // OrderedDict([('a', 1), ('b', 2)]) — rebuild the object from them.
            else if (Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2)) {
              const obj: Record<string, unknown> = {};
              for (const [k, val] of v as [unknown, unknown][]) obj[keyToString(k, this.i)] = val;
              inner = obj;
            }
            if (this.isP(',')) this.next();
          }
          this.expectP(')');
          return inner;
        }
        default:
          throw new PyError(`"${t.v}" is a variable or unsupported name — JSON can only hold literal values.`, this.i);
      }
    }
    if (t.t === 'eof') throw new PyError('Unexpected end of input.', this.i);
    throw new PyError(`Unexpected "${(t as { v: string }).v}".`, this.i);
  }

  private parseSequence(closer: string): unknown[] {
    const out: unknown[] = [];
    while (!this.isP(closer)) {
      out.push(this.parseValue());
      if (this.isP(',')) { this.next(); continue; }
      if (!this.isP(closer)) throw new PyError(`Expected "," or "${closer}".`, this.i);
    }
    this.next();
    return out;
  }

  private parseBraces(): unknown {
    this.expectP('{');
    if (this.isP('}')) { this.next(); return {}; }
    const first = this.parseValue();
    if (this.isP(':')) {
      // dict
      this.next();
      const obj: Record<string, unknown> = {};
      obj[keyToString(first, this.i)] = this.parseValue();
      while (this.isP(',')) {
        this.next();
        if (this.isP('}')) break;
        const k = this.parseValue();
        this.expectP(':');
        obj[keyToString(k, this.i)] = this.parseValue();
      }
      this.expectP('}');
      return obj;
    }
    // set → array
    const arr = [first];
    while (this.isP(',')) {
      this.next();
      if (this.isP('}')) break;
      arr.push(this.parseValue());
    }
    this.expectP('}');
    return arr;
  }
}

/** Mirror json.dumps: str keys as-is, numbers/bools/None stringified. */
function keyToString(k: unknown, pos: number): string {
  if (typeof k === 'string') return k;
  if (typeof k === 'number') return String(k);
  if (typeof k === 'boolean') return k ? 'true' : 'false';
  if (k === null) return 'null';
  throw new PyError('Dictionary keys must be strings, numbers, booleans or None to become JSON.', pos);
}

export interface PyToJsonOptions {
  indent: 2 | 4 | 'tab' | 0;
  sortKeys: boolean;
}

export type PyToJsonResult = { ok: true; output: string; value: unknown } | { ok: false; error: string; position?: number };

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function pythonToJson(src: string, opts: Partial<PyToJsonOptions> = {}): PyToJsonResult {
  const o: PyToJsonOptions = { indent: 2, sortKeys: false, ...opts };
  if (!src.trim()) return { ok: false, error: 'Paste a Python dict, list or other literal.' };
  try {
    let value = new Parser(tokenize(src)).parseTop();
    if (o.sortKeys) value = sortDeep(value);
    const indent = o.indent === 'tab' ? '\t' : o.indent === 0 ? undefined : o.indent;
    return { ok: true, output: JSON.stringify(value, null, indent), value };
  } catch (e) {
    if (e instanceof PyError) return { ok: false, error: e.message, position: e.position };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The reverse direction: JSON text → Python literal source. */
export function jsonToPython(src: string, indent: number = 4): { ok: true; output: string } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(src);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const pad = (d: number) => ' '.repeat(d * indent);
  const repr = (v: unknown, d: number): string => {
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
      const body = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      return `'${body}'`;
    }
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return `[\n${v.map((x) => pad(d + 1) + repr(x, d + 1)).join(',\n')}\n${pad(d)}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad(d + 1)}${repr(k, d + 1)}: ${repr(x, d + 1)}`).join(',\n')}\n${pad(d)}}`;
  };
  return { ok: true, output: repr(value, 0) };
}
