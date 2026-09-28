/**
 * The AI Text Cleaner page publishes a Python script (src/lib/python/ai_text_cleaner.py) that
 * claims to do what the tool does. This runs the script and the engine on the same inputs (the
 * unit tests' cases, the page's examples and seeded random mixes of the characters each step
 * handles, under random option combinations) and fails on any difference.
 *
 * Skipped when there is no Python 3 on PATH. Emoji cases also need `pip install regex`; without
 * it they are skipped with a note. U+2028/U+2029 are left out of the generated input on purpose:
 * JavaScript's ^ $ and . treat them as line breaks and Python's re does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cleanText, DEFAULT_CLEAN, type CleanOptions, type DashMode } from '../src/lib/text-clean.ts';

const SCRIPT = resolve('src/lib/python/ai_text_cleaner.py');
const GENERATED = 600;

function findPython(): string | null {
  for (const cmd of ['python3', 'python', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}

// Loads the published script as a module and runs clean_text over a JSON batch on stdin.
const DRIVER = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("ai_text_cleaner", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
try:
    import regex
    has_regex = True
except ImportError:
    has_regex = False
cases = json.loads(sys.stdin.buffer.read().decode("utf-8"))
out = [None if c["opts"]["emoji"] and not has_regex else m.clean_text(c["input"], **c["opts"]) for c in cases]
sys.stdout.write(json.dumps({"regex": has_regex, "out": out}))
`;

const toPython = (o: CleanOptions) => ({
  markdown: o.markdown,
  normalize_bullets: o.normalizeBullets,
  em_dash: o.emDash === 'remove' ? 'space' : o.emDash, // the UI calls it "Replace with space"
  straighten_quotes: o.straightenQuotes,
  invisible: o.invisible,
  emoji: o.emoji,
  citations: o.citations,
  ellipsis: o.ellipsis,
  whitespace: o.whitespace,
});

const FIXED = [
  // tests/text-clean.test.ts
  '## Title\n\nThis is **bold**, *italic*, `code` and a [link](https://x.y).',
  'Run:\n```bash\nnpm test\n```\nDone.',
  '* one\n+ two\n- [ ] three\n> quoted',
  'Fast — really fast — and cheap.',
  'From 2010–2020 and 5—6.',
  '“Hello,” she said… ‘yes’',
  'a\u200Bb\u00A0c\uFEFF',
  'Fact[1] and fact[2, 3] and 【4†source】 done[^5].',
  'Great 🚀🎉 work 👍🏽',
  'a   b  \n\n\n\nc ',
  '| A | B |\n|---|---|\n| 1 | 2 |',
  '**x** — y',
  'see [the docs, v2](https://x.y) now',
  '['.repeat(2000) + ']'.repeat(2000),
  // the examples and edge cases quoted on the tool page
  '## Summary\n\nThis is **really** important — so let’s be clear.\n\n* Point one[1]\n* See the docs[2, 3]…',
  'items[0] and arr[12]',
  '© 2024 ™ ★',
  '2010–2020 and A–B',
  '2 * 3 * 4 and a*b*c and snake_case_name',
  '[**x**](u) and ![alt text](img.png)',
  'Windows\r\nline\rendings\r\n',
  // case-insensitive matching differs between the languages outside ASCII (long s, Kelvin sign)
  'a[ſource]b[SOURCE]c[ſOURCE]d[Ref]e[citation Needed]f',
];

const TOKENS = [
  'word', 'Ab', 'x9', '9', '2010', ' ', '  ', '\t', '\n', '\n\n\n', '\r\n', '\r',
  '**', '*', '***', '__', '_', '~~', '`', '```js\n', '```\n', '#', '## ', '###### ', '> ', '- ', '* ', '+ ', '- [x] ', '- [ ] ',
  '|', '| ', '|---|', '|:--:|', '---', '***\n', '===', '[', ']', '(', ')', '!', '[1]', '[2, 3]', '[^4]', '[4–6]', '[7-8]',
  '【7†source】', '[citation needed]', '[Source]', '[REF]', '[link](http://a.b)', '![alt](i.png)',
  '—', '–', ' — ', ' – ', ',', '.', '?', ';', ':', '“', '”', '„', '‘', '’', '«', '»', '″', '′', '…',
  '\u00A0', '\u200B', '\u200D', '\u2060', '\uFEFF', '\u00AD', '\u180E', '\u3000', '\u2003', '\u202F', '\u1680',
  '\u001C', '\u0007', '\u000B', '\u000C', '\u0085', '\u202E',
  'é', 'ß', 'ſ', 'K', '٣', '🚀', '👍🏽', '👨\u200D💻', '🇬🇧', '1\uFE0F\u20E3', '#\u20E3', '©', '™', '★', '☺\uFE0F',
];
const DASH_MODES: DashMode[] = ['comma', 'hyphen', 'spaced-hyphen', 'remove', 'keep'];

// mulberry32: a seeded PRNG, so a failure reproduces on every run.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCases(): { input: string; opts: CleanOptions }[] {
  const cases: { input: string; opts: CleanOptions }[] = [];
  const allOff: CleanOptions = { markdown: false, normalizeBullets: false, emDash: 'keep', straightenQuotes: false, invisible: false, emoji: false, citations: false, ellipsis: false, whitespace: false };
  for (const input of FIXED) {
    cases.push({ input, opts: { ...DEFAULT_CLEAN } }, { input, opts: { ...DEFAULT_CLEAN, emoji: true } }, { input, opts: allOff });
    for (const emDash of DASH_MODES) cases.push({ input, opts: { ...DEFAULT_CLEAN, emDash } });
  }
  const r = rng(20260929);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  for (let i = 0; i < GENERATED; i++) {
    const input = Array.from({ length: 1 + Math.floor(r() * 30) }, () => pick(TOKENS)).join('');
    const opts: CleanOptions = {
      markdown: r() < 0.7, normalizeBullets: r() < 0.7, emDash: pick(DASH_MODES), straightenQuotes: r() < 0.7,
      invisible: r() < 0.6, emoji: r() < 0.3, citations: r() < 0.7, ellipsis: r() < 0.7, whitespace: r() < 0.7,
    };
    cases.push({ input, opts });
  }
  return cases;
}

const python = findPython();

test('the Python script on the AI Text Cleaner page gives the same output as the tool', { skip: python ? false : 'no Python 3 on PATH' }, () => {
  const cases = buildCases();
  const r = spawnSync(python!, ['-c', DRIVER, SCRIPT], {
    input: JSON.stringify(cases.map((c) => ({ input: c.input, opts: toPython(c.opts) }))),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  const { regex, out } = JSON.parse(r.stdout) as { regex: boolean; out: (string | null)[] };
  cases.forEach((c, i) => {
    if (out[i] === null) return;
    assert.equal(out[i], cleanText(c.input, c.opts).output, `case ${i}: ${JSON.stringify(c.input)} with ${JSON.stringify(c.opts)}`);
  });
  if (!regex) console.log('note: emoji cases skipped; pip install regex to include them');
});
