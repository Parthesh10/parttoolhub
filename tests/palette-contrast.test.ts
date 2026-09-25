/**
 * Every palette (header colour picker) in both themes must keep every text/background pairing the
 * site actually uses at WCAG AA (4.5:1). Reads the real global.css, resolves each palette's full
 * token set the way the cascade does, and checks the pairs. Also checks that the duplicated dark
 * blocks (system-dark media query vs forced data-theme="dark") hold identical values, since plain
 * CSS cannot share them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PALETTES = ['tangerine', 'indigo', 'mint', 'cobalt'] as const;

/** Custom properties declared directly in the first block whose selector line matches exactly. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {\n');
  assert.ok(start >= 0, `selector not found in global.css: ${selector}`);
  const end = css.indexOf('}', start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const base = tokens(':root');
const sysDark = tokens('  :root:not([data-theme="light"])');
const forcedDark = tokens(':root[data-theme="dark"]');

function resolved(palette: (typeof PALETTES)[number], theme: 'light' | 'dark'): Record<string, string> {
  const layers = [base];
  if (theme === 'dark') layers.push(forcedDark);
  if (palette !== 'tangerine') {
    layers.push(tokens(`:root[data-palette="${palette}"]`));
    if (theme === 'dark') layers.push(tokens(`:root[data-palette="${palette}"][data-theme="dark"]`));
  }
  const t = Object.assign({}, ...layers) as Record<string, string>;
  const resolve = (v: string, depth = 0): string => {
    const m = v.match(/^var\(--([\w-]+)(?:,\s*([^)]+))?\)$/);
    if (!m || depth > 5) return v;
    return resolve(t[m[1]] ?? m[2] ?? v, depth + 1);
  };
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, resolve(v)]));
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** [foreground token, background token] pairs the site renders as text. */
const PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'surface-2'], ['accent', 'accent-soft'],
  ['accent-2', 'bg'], ['accent-2', 'surface'],
  ['#ffffff', 'accent-btn'], ['#ffffff', 'accent-btn-hover'],
  ['success', 'surface'], ['danger', 'surface'],
  ...(['converters', 'text-tools', 'encoders', 'generators', 'compare'].flatMap((c) => [[`tint-${c}`, 'bg'], [`tint-${c}`, 'surface']]) as [string, string][]),
  ...(['key', 'string', 'number', 'boolean', 'null', 'punct'].flatMap((k) => [[`syn-${k}`, 'surface'], [`syn-${k}`, 'surface-2']]) as [string, string][]),
];

for (const palette of PALETTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`palette ${palette} / ${theme}: every text pairing is >= 4.5:1`, () => {
      const t = resolved(palette, theme);
      const failures: string[] = [];
      for (const [fg, bg] of PAIRS) {
        const f = fg.startsWith('#') ? fg : t[fg];
        const b = t[bg];
        assert.ok(/^#[0-9a-f]{6}$/i.test(f ?? '') && /^#[0-9a-f]{6}$/i.test(b ?? ''), `${fg} on ${bg} did not resolve to hex (${f} / ${b})`);
        const r = ratio(f, b);
        if (r < 4.5) failures.push(`${fg} ${f} on ${bg} ${b} = ${r.toFixed(2)}`);
      }
      assert.deepEqual(failures, []);
    });
  }
}

test('the two copies of each dark block hold identical values', () => {
  assert.deepEqual(sysDark, forcedDark, 'default dark: system block and forced block differ');
  for (const palette of PALETTES.filter((p) => p !== 'tangerine')) {
    assert.deepEqual(
      tokens(`  :root[data-palette="${palette}"]:not([data-theme="light"])`),
      tokens(`:root[data-palette="${palette}"][data-theme="dark"]`),
      `${palette}: system-dark and forced-dark blocks differ`,
    );
  }
});
