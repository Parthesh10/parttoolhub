/**
 * The Remove Duplicate Lines page publishes a Python script (src/lib/python/remove_duplicate_lines.py)
 * that claims to do what the tool does. This runs the script and the engine on the same inputs
 * (the unit cases, the page's examples and seeded random lists under random option combinations)
 * and fails on any difference in the output or the three counts.
 *
 * Where Python can answer by itself, the script is held to that as well: with the default
 * comparison and no sorting, the result must equal `list(dict.fromkeys(lines))`.
 *
 * Sorting is compared on inputs of ASCII, accented Latin letters and ß. The tool sorts with the
 * browser's Intl.Collator, whose order for other alphabets depends on the locale, so that is
 * outside what a script can promise (and outside what the page claims).
 *
 * Skipped when there is no Python 3 on PATH.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { dedupeLines, SAMPLE_INPUT, type DedupeOptions } from '../src/lib/dedupe-lines.ts';

const SCRIPT = resolve('src/lib/python/remove_duplicate_lines.py');
const GENERATED = 1500;

function findPython(): string | null {
  for (const cmd of ['python3', 'python', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}

// Loads the published script as a module and runs dedupe_lines over a JSON batch on stdin.
const DRIVER = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("remove_duplicate_lines", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
cases = json.loads(sys.stdin.buffer.read().decode("utf-8"))
out = []
for c in cases:
    r = m.dedupe_lines(c["input"], **c["opts"])
    o = c["opts"]
    oracle = None
    if not o["ignore_case"] and o["keep"] == "first" and o["sort"] == "none" and not o["only_duplicates"] and c["input"]:
        lines = m.LINE_BREAK.split(c["input"])
        if o["trim"]:
            lines = [l.strip(m.JS_WHITESPACE) for l in lines]
        if o["remove_blank"]:
            lines = [l for l in lines if l.strip(m.JS_WHITESPACE)]
        oracle = "\\n".join(dict.fromkeys(lines))
    out.append({"output": r.output, "total": r.total, "unique": r.unique, "removed": r.removed, "oracle": oracle})
sys.stdout.write(json.dumps(out))
`;

const toPython = (o: DedupeOptions) => ({
  ignore_case: o.ignoreCase,
  trim: o.trim,
  remove_blank: o.removeBlank,
  keep: o.keep,
  sort: o.sort,
  only_duplicates: o.onlyDuplicates,
});

const FIXED = [
  SAMPLE_INPUT, // the page's worked example
  '',
  '\n',
  '\n\n\n',
  'a',
  'a\nb\na\nc',
  'a\nb\na\nc\nc',
  'a\n a \na',
  'a\r\nb\rb\na\r\n',
  'apple\nApple\nAPPLE',
  'x10\nx2\nx02\nX1\nx0\nx\nx00',
  'a b\na1\nab\nA B',
  'b\n\n  \n\t\nb',
  '﻿foo\nfoo \nfoo',
  '\u001cx\nx\u0085\nx',
  'ß\nss\nSS\nst\nsu',
  'é\ne\nE\nf\nä\na',
  'İ\ni\nI\nΣ\nσ\nς',
  'K\nk\nK',
  'z10\nz9\nz1e5\nz007\nz7',
  '1\n10\n2\n02\n100',
  'Banana\napple\nCherry\napple \nbanana',
];

// Words repeated often enough that a random list is full of duplicates.
const WORDS = ['apple', 'Apple', 'APPLE', 'banana', 'cherry', 'x2', 'x10', 'x02', 'X1', '7', '007', 'a b', 'a-b', 'a_b', 'ab', 'a1', 'a10', 'z', 'Z'];
const PADDING = ['', '', '', ' ', '  ', '\t', ' ', '﻿', '　'];
const BLANKS = ['', '', '  ', '\t', ' '];
const BREAKS = ['\n', '\n', '\n', '\r\n', '\r'];
// Sorting is only compared on these (see the note at the top).
const SORTABLE = ['é', 'e', 'E', 'ä', 'ü', 'u', 'ß', 'ss', 'st', 'ñ', 'n', 'o', '_', '-', '.', ',', '(', '#', '$', '~', '0', '00', '42', '9', 'x ', ' x'];
// Not compared when sorting: other alphabets and symbols sort by locale.
const WIDE = ['İ', 'i', 'Σ', 'σ', 'ς', 'K', 'k', '日本', '😀', 'ǅ', 'ǆ', 'Ǆ'];

// mulberry32: a seeded PRNG, so a failure reproduces on every run.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['first', 'last'] as const;
const SORTS = ['none', 'az', 'za'] as const;

function buildCases(): { input: string; opts: DedupeOptions }[] {
  const cases: { input: string; opts: DedupeOptions }[] = [];
  for (const input of FIXED) {
    for (const keep of KEYS) {
      for (const sort of SORTS) {
        cases.push({ input, opts: { ignoreCase: false, trim: true, removeBlank: true, keep, sort, onlyDuplicates: false } });
        cases.push({ input, opts: { ignoreCase: true, trim: false, removeBlank: false, keep, sort, onlyDuplicates: false } });
      }
    }
    cases.push({ input, opts: { ignoreCase: false, trim: true, removeBlank: true, keep: 'first', sort: 'none', onlyDuplicates: true } });
    cases.push({ input, opts: { ignoreCase: true, trim: true, removeBlank: false, keep: 'last', sort: 'az', onlyDuplicates: true } });
  }
  const r = rng(20261017);
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  for (let i = 0; i < GENERATED; i++) {
    const sorting = r() < 0.4;
    const pool = sorting ? [...WORDS, ...SORTABLE] : [...WORDS, ...SORTABLE, ...WIDE];
    const n = Math.floor(r() * 40);
    let input = '';
    for (let j = 0; j < n; j++) {
      const word = r() < 0.12 ? pick(BLANKS) : pick(PADDING) + pick(pool) + pick(PADDING);
      input += word + (j < n - 1 || r() < 0.5 ? pick(BREAKS) : '');
    }
    const opts: DedupeOptions = {
      ignoreCase: r() < 0.5,
      trim: r() < 0.7,
      removeBlank: r() < 0.7,
      keep: pick(KEYS),
      sort: sorting ? pick(['az', 'za'] as const) : 'none',
      onlyDuplicates: r() < 0.2,
    };
    cases.push({ input, opts });
  }
  return cases;
}

const python = findPython();

test('the Python script on the Remove Duplicate Lines page gives the same output and counts as the tool', { skip: python ? false : 'no Python 3 on PATH' }, () => {
  const cases = buildCases();
  // The fixed cases include non-ASCII sorts that the tool and the script need not agree on:
  // only the generated ones restrict themselves to what the page promises, so for the fixed
  // ones with sorting on, accents and ß are in scope but İ, Σ, Kelvin sign are not used.
  const r = spawnSync(python!, ['-c', DRIVER, SCRIPT], {
    input: JSON.stringify(cases.map((c) => ({ input: c.input, opts: toPython(c.opts) }))),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as { output: string; total: number; unique: number; removed: number; oracle: string | null }[];
  let oracleChecked = 0;
  cases.forEach((c, i) => {
    const want = dedupeLines(c.input, c.opts);
    const label = `case ${i}: ${JSON.stringify(c.input)} with ${JSON.stringify(c.opts)}`;
    assert.equal(out[i].output, want.output, label);
    assert.equal(out[i].total, want.total, `${label} (total)`);
    assert.equal(out[i].unique, want.unique, `${label} (unique)`);
    assert.equal(out[i].removed, want.removed, `${label} (removed)`);
    if (out[i].oracle !== null) {
      oracleChecked++;
      assert.equal(out[i].output, out[i].oracle, `${label} (dict.fromkeys)`);
    }
  });
  assert.ok(oracleChecked > 100, `the dict.fromkeys check ran on ${oracleChecked} cases`);
});
