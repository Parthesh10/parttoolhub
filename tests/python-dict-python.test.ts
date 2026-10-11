/**
 * The Python Dict to JSON page publishes a Python script (src/lib/python/python_dict_to_json.py)
 * that claims to give the same JSON as the tool. This runs the script and the engine on the same
 * inputs (the unit tests' cases, the page's examples, and seeded generated literals: nested dicts,
 * lists, tuples and sets of big ints in four bases, floats written six ways, strings in every quote
 * style with every kind of escape, comments and trailing commas, plus damaged copies of them for
 * the error path) under random options, and fails on any difference in output or error message.
 *
 * It also holds both to Python itself: wherever ast.literal_eval reads the input and the value is
 * plain JSON material (str keys, no sets, no NaN, no bytes), the output must equal json.dumps of
 * it. That catches a mistake the engine and the port share, which parity alone cannot.
 *
 * Skipped when there is no Python 3 on PATH.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pythonToJson, type PyToJsonOptions } from '../src/lib/python-dict.ts';

const SCRIPT = resolve('src/lib/python/python_dict_to_json.py');
const GENERATED = 700;
const MUTATED = 300;

function findPython(): string | null {
  for (const cmd of ['python3', 'python', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}

// Loads the published script as a module; for each case returns the script's answer and, where
// Python's own literal_eval + json.dumps can answer too, that ("oracle").
const DRIVER = `
import ast, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("python_dict_to_json", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def plain(v):
    if isinstance(v, dict):
        return all(isinstance(k, str) for k in v) and all(plain(x) for x in v.values())
    if isinstance(v, (list, tuple)):
        return all(plain(x) for x in v)
    if isinstance(v, float):
        return v == v and v not in (float("inf"), float("-inf"))
    return v is None or isinstance(v, (str, int, bool))

def oracle(src, indent, sort_keys):
    try:
        v = ast.literal_eval(src)
    except Exception:
        return None
    if not plain(v):
        return None
    # A surrogate pair written as two escapes is two code points to Python but one character to
    # JSON (its escapes are UTF-16). A JSON round trip joins them the way any JSON reader would.
    v = json.loads(json.dumps(v))
    if indent == 0:
        out = json.dumps(v, ensure_ascii=False, sort_keys=sort_keys, separators=(",", ":"))
    else:
        out = json.dumps(v, ensure_ascii=False, sort_keys=sort_keys, indent="\\t" if indent == "tab" else indent)
    return m.SURROGATE.sub(lambda x: "\\\\u%04x" % ord(x.group()), out)

res = []
for c in json.loads(sys.stdin.buffer.read().decode("utf-8")):
    r = {"oracle": oracle(c["src"], c["indent"], c["sortKeys"])}
    try:
        r["ok"] = True
        r["out"] = m.python_to_json(c["src"], indent=c["indent"], sort_keys=c["sortKeys"])
    except m.PyLiteralError as e:
        r = {"ok": False, "error": e.message, "pos": e.position, "oracle": r["oracle"]}
    except Exception as e:
        r = {"ok": False, "error": "PYTHON CRASH " + repr(e), "pos": -1, "oracle": r["oracle"]}
    res.append(r)
sys.stdout.write(json.dumps(res))
`;

// --- Seeded generator -----------------------------------------------------------------------
let seed = 0x5eed2b8f;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const cp = String.fromCodePoint;
const BS = String.fromCharCode(92);
const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

const LONE = 'LONE'; // marker: a lone surrogate, only writable as an escape
const CHARS = ['a', 'b', 'Z', 'q', '0', '7', ' ', "'", '"', BS, cp(10), cp(9), cp(13), cp(0), cp(7), cp(0x7f),
  cp(0xe9), cp(0xff), cp(0x4e2d), cp(0x1f600), cp(0x2028), '{', ':', ',', '#', LONE];

function escapeChar(ch: string, allowU: boolean): string {
  const code = ch.codePointAt(0)!;
  const options: string[] = [];
  if (code <= 0xff) options.push(BS + 'x' + hex(code, 2));
  if (code <= 0o777 && chance(0.5)) options.push(BS + code.toString(8).padStart(3, '0'));
  if (allowU && code <= 0xffff) options.push(BS + 'u' + hex(code, 4));
  if (allowU) options.push(BS + 'U' + hex(code, 8));
  if (allowU && code > 0xffff) {
    const s = cp(code);
    options.push(BS + 'u' + hex(s.charCodeAt(0), 4) + BS + 'u' + hex(s.charCodeAt(1), 4));
  }
  const simple: Record<number, string> = { 10: 'n', 9: 't', 13: 'r', 7: 'a', 92: BS, 39: "'", 34: '"' };
  if (simple[code]) options.push(BS + simple[code]);
  return pick(options);
}

function pyString(): string {
  if (chance(0.08)) {
    // raw string: backslashes always followed by a letter, no quotes, no newlines
    const body = Array.from({ length: Math.floor(rnd() * 6) }, () => pick(['a', ' ', BS + 'n', BS + 'd', 'x'])).join('');
    const rq = pick(["'", '"']);
    return pick(['r', 'R', 'rb', 'Rb']) + rq + body + rq;
  }
  const prefix = pick(['', '', '', 'u', 'b', 'f']);
  const allowU = prefix !== 'b';
  const q = pick(["'", '"']);
  const triple = chance(0.12);
  const len = Math.floor(rnd() * 8);
  let body = '';
  for (let k = 0; k < len; k++) {
    let ch = pick(CHARS);
    if (ch === LONE) {
      if (!allowU) continue;
      body += BS + 'u' + hex(0xd800 + Math.floor(rnd() * 0x800), 4);
      continue;
    }
    if (prefix === 'f' && (ch === '{' || ch === '}')) ch = 'a';
    const code = ch.codePointAt(0)!;
    const mustEscape = ch === q || ch === BS || code === 13 || (code < 0x20 && !(triple && code === 10)) || code === 0x7f;
    body += mustEscape || chance(0.2) ? escapeChar(ch, allowU) : ch;
  }
  const quote = triple ? q.repeat(3) : q;
  return prefix + quote + body + quote;
}

function pyInt(): string {
  const digits = pick([1, 3, 9, 16, 20, 25, 40]);
  let n = BigInt(Math.floor(rnd() * 9) + 1);
  for (let k = 1; k < digits; k++) n = n * 10n + BigInt(Math.floor(rnd() * 10));
  if (chance(0.15)) n = BigInt(Math.floor(rnd() * 3));
  const under = (s: string) => (chance(0.3) ? s.replace(/(\w)(?=(\w{3})+$)/g, '$1_') : s);
  switch (pick(['dec', 'dec', 'dec', 'hex', 'oct', 'bin'])) {
    case 'hex': return '0' + pick(['x', 'X']) + under(chance(0.5) ? n.toString(16) : n.toString(16).toUpperCase());
    case 'oct': return '0' + pick(['o', 'O']) + under(n.toString(8));
    case 'bin': return '0b' + under((n % 100000n).toString(2));
    default: return under(n.toString());
  }
}

function randomDouble(): number {
  switch (pick(['bits', 'decimal', 'whole', 'edge'])) {
    case 'bits': {
      const view = new DataView(new ArrayBuffer(8));
      view.setUint32(0, Math.floor(rnd() * 2 ** 32) & 0x7fefffff);
      view.setUint32(4, Math.floor(rnd() * 2 ** 32));
      return view.getFloat64(0);
    }
    case 'decimal': return Number((rnd() * 10 ** Math.floor(rnd() * 8)).toFixed(Math.floor(rnd() * 6)));
    case 'whole': return Math.floor(rnd() * 10 ** Math.floor(rnd() * 20));
    default: return pick([0, 1e15, 1e16, 1e17, 1e-4, 1e-5, 0.0001, 0.00001, 5e-324, 1.7976931348623157e308, 0.1, 100, 1e22, 123456789012345680]);
  }
}

function pyFloat(): string {
  const x = randomDouble();
  const ensureFloat = (s: string) => (/[.eE]/.test(s) ? s : s + '.0');
  switch (pick(['str', 'exp', 'exp-k', 'fixed', 'dot', 'under'])) {
    case 'exp': return x.toExponential();
    case 'exp-k': return x.toExponential(Math.floor(rnd() * 5)).replace('e', pick(['e', 'E']));
    case 'fixed': return x < 1e20 ? ensureFloat(x.toFixed(1 + Math.floor(rnd() * 4))) : x.toExponential();
    case 'dot': { const s = ensureFloat(String(x)); return s.startsWith('0.') ? s.slice(1) : s; }
    case 'under': { const s = ensureFloat(String(x)); return s.replace(/^(\d)(\d)/, '$1_$2'); }
    default: return ensureFloat(String(x));
  }
}

const ws = () => pick(['', '', ' ', ' ', '  ', '\n', '\n    ', '\t', ' # note, with a , and } in it\n']);

function pyScalar(): string {
  switch (pick(['str', 'str', 'str', 'int', 'int', 'float', 'float', 'const', 'special', 'concat'])) {
    case 'int': return (chance(0.2) ? '-' : chance(0.05) ? '+' : '') + pyInt();
    case 'float': return (chance(0.2) ? '-' : '') + pyFloat();
    case 'const': return pick(['True', 'False', 'None']);
    case 'special': return pick(['nan', 'inf', "float('nan')", "float('inf')", "float('-inf')", 'set()', 'dict()', '()', '[]', '{}']);
    case 'concat': return pyString() + pick([' ', '', '\n']) + pyString();
    default: return pyString();
  }
}

function pyKey(used: string[]): string {
  if (used.length && chance(0.08)) return pick(used); // a repeated key
  const k = chance(0.85) ? pyString() : chance(0.5) ? pyInt() : pick(['True', 'None', '2.5', '1.0', '-3']);
  used.push(k);
  return k;
}

function pyValue(depth: number): string {
  if (depth > 3 || chance(0.35)) return pyScalar();
  const n = Math.floor(rnd() * 5);
  const items = <T,>(gen: () => T): T[] => Array.from({ length: n }, gen);
  const trailing = () => (chance(0.3) ? ',' : '');
  switch (pick(['dict', 'dict', 'list', 'tuple', 'set', 'call', 'odict'])) {
    case 'list': return '[' + ws() + items(() => pyValue(depth + 1)).join(',' + ws()) + (n ? trailing() : '') + ws() + ']';
    case 'tuple': {
      if (n === 1) return '(' + pyValue(depth + 1) + ',)';
      return '(' + items(() => pyValue(depth + 1)).join(', ') + (n > 1 ? trailing() : '') + ')';
    }
    case 'set': return n ? '{' + items(() => pyScalar()).join(', ') + trailing() + '}' : 'set()';
    case 'call': return pick(['set', 'frozenset', 'list', 'tuple']) + '([' + items(() => pyScalar()).join(', ') + '])';
    case 'odict': {
      const used: string[] = [];
      const pairs = items(() => [pyKey(used), pyValue(depth + 1)]);
      return chance(0.5)
        ? 'OrderedDict([' + pairs.map(([k, v]) => `(${k}, ${v})`).join(', ') + '])'
        : pick(['Counter', 'OrderedDict']) + '({' + pairs.map(([k, v]) => `${k}: ${v}`).join(', ') + '})';
    }
    default: {
      const used: string[] = [];
      return '{' + ws() + items(() => pyKey(used) + ':' + pick([' ', '', '  ']) + pyValue(depth + 1)).join(',' + ws()) + (n ? trailing() : '') + ws() + '}';
    }
  }
}

function mutate(src: string): string {
  const at = Math.floor(rnd() * (src.length + 1));
  switch (pick(['cut', 'insert', 'delete'])) {
    case 'cut': return src.slice(0, at);
    case 'insert': return src.slice(0, at) + pick(['@', '$', '<', '!', '=', 'xyz', ':', ',,', ')', "'", BS, '0x', '1j', '.']) + src.slice(at);
    default: return src.slice(0, at) + src.slice(at + 1);
  }
}

// --- Cases ----------------------------------------------------------------------------------
const FIXED = [
  // tests/python-dict.test.ts
  "{'name': 'Ada', 'active': True, 'manager': None}",
  "{'a': [1, (2, 3), {4, 5}], 'b': {'c': None}}",
  "{'a': 1,  # comment\n 'b': [1, 2,],}",
  "{'s': 'it\\'s', 'u': u'x', 'r': r'a\\nb', 't': '''multi\nline''', 'c': 'ab' 'cd'}",
  '[1_000, 0xff, 0b101, 3.5, -2, .5, 1e3]',
  "{1: 'a', True: 'b', None: 'c'}",
  "{'s': set([1, 2]), 'd': dict(), 'i': float('inf'), 'o': OrderedDict({'k': 1})}",
  "{'b': 1, 'a': 2}",
  "OrderedDict([('a', 1), ('b', 2)])",
  "OrderedDict([(1, 'x'), (None, 'y')])",
  "{'id': 12345678901234567890, 'neg': -98765432109876543210, 'hex': 0xFFFFFFFFFFFFFFFFFF}",
  '-0',
  "{'b': 1, '2': 2, 'a': 3, 1: 4}",
  "{'a': 1, 'b': 2, 'a': 3}",
  '[1.0, -0.0, 0.1, 1e16, 1e15, 123456789012345678.0, 0.0001, 0.00001, 1.5e-7, 2.5e300, 5e-324, 1_0.2_5, 1e999]',
  "{1.0: 'a', 2.5: 'b'}",
  '[0x_]',
  "['" + BS + "012', '" + BS + "0', '" + BS + "1234', '" + BS + 'x41' + BS + 'u00e9' + BS + "U0001F600']",
  "b'" + BS + 'u00e9' + BS + "x41'",
  "'" + BS + "xZZ'", "'" + BS + "x4'", "'" + BS + "u12'", "'" + BS + "U00110000'",
  "'" + BS + 'ud83d' + BS + "ude00'", "'" + BS + "ud83d'", "{'" + BS + "udc00': 1, 'z': 2}",
  'float(', 'set(', 'OrderedDict(', '{1:', '-', '(1)', '((1, 2))', '(1,)', '()',
  "some_var", "{'a': 1} extra", '{"a": true}', "{(1, 2): 'a'}", '1+2j', "'unterminated", "'new\nline'",
  "{'d': datetime.datetime(2024, 1, 1)}", "{'d': Decimal('1.5')}", "defaultdict(<class 'list'>, {})",
  "Counter({'a': 2, 'b': 1})", "frozenset({'x'})", "{'f': f'hi {x}'}", '   ', '',
  // the page's worked example and option examples
  "{'id': 7, 'active': True, 'ref': None, 'tags': ('a', 'b')}",
  "{1: 'a', 2.5: 'b', True: 'c', None: 'd'}",
  "{'id': 12345678901234567890}",
  '[1.0, 1e16, 0.00001]',
];

const OPTIONS: PyToJsonOptions[] = [
  { indent: 2, sortKeys: false }, { indent: 4, sortKeys: true }, { indent: 'tab', sortKeys: false }, { indent: 0, sortKeys: false }, { indent: 0, sortKeys: true },
];

type Case = { src: string; indent: PyToJsonOptions['indent']; sortKeys: boolean };
const cases: Case[] = [];
for (const src of FIXED) for (const o of OPTIONS) cases.push({ src, ...o });
const generated: string[] = [];
for (let k = 0; k < GENERATED; k++) {
  const src = ws() + pyValue(0) + ws();
  generated.push(src);
  cases.push({ src, ...pick(OPTIONS) });
}
for (let k = 0; k < MUTATED; k++) cases.push({ src: mutate(pick(generated)), ...pick(OPTIONS) });

const python = findPython();

test('the published Python script gives the same JSON (or the same error) as the tool, and matches Python itself', { skip: python ? false : 'no Python 3 on PATH' }, () => {
  const run = spawnSync(python!, ['-c', DRIVER, SCRIPT], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const results = JSON.parse(run.stdout) as { ok: boolean; out?: string; error?: string; pos?: number; oracle: string | null }[];
  assert.equal(results.length, cases.length);

  let oracleChecked = 0;
  let failures = 0;
  const report: string[] = [];
  results.forEach((py, k) => {
    const c = cases[k];
    const js = pythonToJson(c.src, { indent: c.indent, sortKeys: c.sortKeys });
    const where = `case ${k} ${JSON.stringify(c)}`;
    let problem = '';
    if (js.ok !== py.ok) problem = `tool ${js.ok ? 'converted it' : `failed: ${(js as { error: string }).error}`}, script ${py.ok ? 'converted it' : `failed: ${py.error}`}`;
    else if (js.ok && js.output !== py.out) problem = `different JSON\n  tool:   ${js.output}\n  script: ${py.out}`;
    else if (!js.ok && js.error !== py.error) problem = `different errors\n  tool:   ${js.error}\n  script: ${py.error}`;
    // Positions are UTF-16 offsets in JavaScript and code points in Python: compare them when they mean the same.
    else if (!js.ok && [...c.src].length === c.src.length && js.position !== undefined && js.position !== py.pos) problem = `error at ${js.position} in the tool, ${py.pos} in the script`;
    else if (js.ok && py.oracle !== null) {
      oracleChecked++;
      if (js.output !== py.oracle) problem = `differs from Python's own json.dumps(ast.literal_eval(...))\n  tool:   ${js.output}\n  Python: ${py.oracle}`;
    }
    if (problem) {
      failures++;
      if (report.length < 8) report.push(`${where}\n  ${problem}`);
    }
  });
  assert.equal(failures, 0, `${failures} of ${cases.length} cases differ:\n${report.join('\n')}`);
  // The generator must keep producing inputs Python itself can check, or the oracle half is idle.
  assert.ok(oracleChecked > 250, `only ${oracleChecked} cases were checked against Python itself`);
});
