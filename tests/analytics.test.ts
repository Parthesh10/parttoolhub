/**
 * Analytics guardrails (docs/ANALYTICS.md).
 *
 * Source-level checks, so they run without a build:
 *  - every registered tool's client script is instrumented (tool_use via
 *    trackRun; copy/download/reset where the widget has those buttons);
 *  - no `track(...)` call can carry visitor text — a static PII guard;
 *  - GA4 is initialised once, in Base.astro only, and only in production;
 *  - every event name used in code is documented, and vice versa.
 * Build-level checks (skipped until `npm run build`):
 *  - tool pages expose data-tool-slug/category on <body> for the scripts;
 *  - exactly one gtag config per page, never two loaders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { TOOLS, toolPath } from '../src/data/tools.ts';
import { CATEGORIES } from '../src/data/categories.ts';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const dist = resolve(root, 'dist');
const skip = existsSync(dist) ? false : 'dist/ not found — run `npm run build` first';

/** page file → the component it renders → that component's client script path. */
function clientScriptFor(slug: string): { component: string; client: string } {
  const page = read(`src/pages/tools/${slug}.astro`);
  const m = page.match(/import \w+ from '(\.\.\/\.\.\/components\/[^']+\.astro)'/);
  assert.ok(m, `${slug}: page does not import a tool component`);
  const component = resolve(root, 'src/pages/tools', m[1]);
  const html = readFileSync(component, 'utf8');
  const s = html.match(/<script src="(\.\/[^"]+\.client\.ts)"><\/script>/);
  assert.ok(s, `${slug}: component has no <script src="./*.client.ts">`);
  return { component: html, client: resolve(dirname(component), s[1]) };
}

/** Every `track(...)` / `trackRun(...)` call expression, with balanced parentheses. */
function trackCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /\b(track|trackRun)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(m.index, i + 1));
  }
  return calls;
}

/**
 * Strip string literals and regex `.test(...)` probes, leaving only the identifiers that flow into
 * the call. Template literals keep their `${...}` interpolations — those are code, not text.
 */
const identifiersOnly = (call: string) =>
  call
    .replace(/`(?:[^`\\]|\\.)*`/g, (tpl) => [...tpl.matchAll(/\$\{([^}]*)\}/g)].map((m) => `(${m[1]})`).join(' '))
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\/[^/\n]+\/[gimsuy]*\.test\([^)]*\)/g, 'TEST');

/** Identifiers declared as <select> elements — their .value is an enumerated option, never typed text. */
const selectNames = (src: string) => new Set([...src.matchAll(/const (\w+) = \$<HTMLSelectElement>\(/g)].map((m) => m[1]));

for (const tool of TOOLS) {
  test(`${tool.slug}: client script is instrumented for the controls its widget has`, () => {
    const { component, client } = clientScriptFor(tool.slug);
    const src = readFileSync(client, 'utf8');
    assert.ok(src.includes('window.pth?.track('), 'uses the window.pth entry point (optional-chained)');
    assert.ok(/\btrackRun\(/.test(src.replace(/function trackRun[\s\S]*?\n}\n/, '')), 'calls trackRun (tool_use / tool_result / tool_error)');
    if (/id="btn-copy"|data-copy=/.test(component)) assert.ok(src.includes("track('copy_result'"), 'has a copy button → copy_result');
    if (/id="btn-download"/.test(component)) assert.ok(src.includes("track('download_result'"), 'has a download button → download_result');
    if (/id="btn-clear"/.test(component)) assert.ok(src.includes("track('reset_tool'"), 'has a clear button → reset_tool');
    if (/id="btn-sample"/.test(component)) assert.ok(src.includes("inputSource = 'sample'"), 'sample button marks input_source');
    if (/sendToTool\(/.test(src)) assert.ok(src.includes("link_placement: 'handoff'"), 'cross-tool handoff → navigation_click');
  });

  test(`${tool.slug}: no track() call can carry visitor text (PII guard)`, () => {
    const { client } = clientScriptFor(tool.slug);
    const src = readFileSync(client, 'utf8');
    const selects = selectNames(src);
    for (const call of trackCalls(src)) {
      const ids = identifiersOnly(call);
      for (const m of ids.matchAll(/\b(\w+)\.value\b(?!\.length)/g)) {
        assert.ok(selects.has(m[1]), `passes ${m[1]}.value, which is not a <select>: ${call}`);
      }
      for (const bad of [/\braw\b/, /\boutput\b/, /\btextContent\b/, /\.output\b/, /\berror\b/, /\bmessage\b/, /\bsrc\b/]) {
        assert.ok(!bad.test(ids), `passes ${bad}: ${call}`);
      }
    }
    // Free-text inputs must never report their value, only that they were touched.
    const optionFn = src.match(/function trackOption[\s\S]*?\n}\n/)?.[0] ?? '';
    assert.ok(optionFn.length > 0, 'trackOption helper present');
    assert.ok(!/\bel\.value\b/.test(optionFn), 'trackOption reads el.value — text inputs would leak');
  });
}

test('GA4 is initialised exactly once, in Base.astro, only in production builds', () => {
  const base = read('src/layouts/Base.astro');
  assert.equal((base.match(/gtag\('config'/g) ?? []).length, 1, 'one gtag config call');
  assert.equal((base.match(/googletagmanager\.com\/gtag\/js/g) ?? []).length, 1, 'one gtag.js loader');
  assert.ok(/import\.meta\.env\.PROD/.test(base), 'production gate present');
  assert.ok(base.includes("track('tool_view'"), 'fires tool_view');
  assert.ok(base.includes("'navigation_click'"), 'delegates navigation_click');
  // Nothing else on the site may start its own tracker.
  const srcFiles = walk(resolve(root, 'src')).filter((f) => !f.endsWith('Base.astro'));
  for (const f of srcFiles) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/gtag\(|googletagmanager|dataLayer/.test(s), `${f} touches GA directly — go through window.pth`);
  }
});

test('every event name in code is documented in docs/ANALYTICS.md, and vice versa', () => {
  const doc = read('docs/ANALYTICS.md');
  const inCode = new Set<string>();
  for (const f of walk(resolve(root, 'src'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\btrack\('([a-z_]+)'/g)) inCode.add(m[1]);
  }
  // trackRun emits these three by name inside the helper.
  for (const e of ['tool_use', 'tool_result', 'tool_error']) inCode.add(e);
  const inDoc = new Set([...doc.matchAll(/^\| `([a-z_]+)` +\|/gm)].map((m) => m[1]));
  for (const e of inCode) assert.ok(inDoc.has(e), `event "${e}" is used in code but missing from the docs/ANALYTICS.md table`);
  for (const e of inDoc) assert.ok(inCode.has(e), `event "${e}" is documented but no longer used in code`);
});

test('built tool pages expose the slug/category the scripts read, and no page double-initialises GA', { skip }, () => {
  for (const t of TOOLS) {
    const html = readFileSync(resolve(dist, `.${toolPath(t)}.html`), 'utf8');
    assert.ok(html.includes(`<body data-tool-slug="${t.slug}" data-tool-category="${t.category}"`), `${t.slug}: body data attributes`);
  }
  const pages = [
    ...readdirSync(dist).filter((f) => f.endsWith('.html')).map((f) => resolve(dist, f)),
    ...readdirSync(resolve(dist, 'tools')).map((f) => resolve(dist, 'tools', f)),
  ];
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    assert.ok((html.match(/gtag\('config'/g) ?? []).length <= 1, `${p}: more than one gtag config`);
    assert.ok((html.match(/googletagmanager\.com\/gtag\/js/g) ?? []).length <= 1, `${p}: more than one gtag loader`);
    assert.ok(html.includes('window.pth'), `${p}: analytics entry point missing`);
  }
  // Non-tool pages carry no tool attributes.
  const home = readFileSync(resolve(dist, 'index.html'), 'utf8');
  assert.ok(!/data-tool-slug=/.test(home), 'home page must not claim a tool slug');
  for (const c of CATEGORIES) {
    const hub = readFileSync(resolve(dist, `${c.slug}.html`), 'utf8');
    assert.ok(!/data-tool-slug=/.test(hub), `${c.slug}: hub must not claim a tool slug`);
  }
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|astro|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
