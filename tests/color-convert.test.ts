import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, rgbToHex, rgbToHsl, formatRgb, formatHsl, contrastRatio, relativeLuminance } from '../src/lib/color-convert.ts';

function parseOk(s: string) {
  const r = parseColor(s);
  assert.ok(r.ok, `expected ${s} to parse`);
  return (r as { ok: true; value: { r: number; g: number; b: number; a: number } }).value;
}

test('parseColor: hex in 3, 4, 6 and 8 digit forms', () => {
  assert.deepEqual(parseOk('#f00'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseOk('#ff0000'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseOk('#f008'), { r: 255, g: 0, b: 0, a: 136 / 255 });
  assert.deepEqual(parseOk('#ff000080'), { r: 255, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseOk('ff0000'), { r: 255, g: 0, b: 0, a: 1 }); // leading # is optional
});

test('parseColor: rgb()/rgba() with numbers, percentages and slash alpha', () => {
  assert.deepEqual(parseOk('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseOk('rgba(255, 0, 0, 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseOk('rgb(100%, 0%, 0%)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseOk('rgb(255 0 0 / 50%)'), { r: 255, g: 0, b: 0, a: 0.5 }); // modern space/slash syntax
});

test('parseColor: hsl()/hsla()', () => {
  const red = parseOk('hsl(0, 100%, 50%)');
  assert.equal(red.r, 255); assert.equal(red.g, 0); assert.equal(red.b, 0);
  const gray = parseOk('hsl(0, 0%, 50%)');
  assert.equal(gray.r, 128); assert.equal(gray.g, 128); assert.equal(gray.b, 128);
  const withAlpha = parseOk('hsla(0, 100%, 50%, 0.5)');
  assert.equal(withAlpha.a, 0.5);
});

test('parseColor: rejects garbage and empty input', () => {
  assert.ok(!parseColor('').ok);
  assert.ok(!parseColor('   ').ok);
  assert.ok(!parseColor('not a color').ok);
  assert.ok(!parseColor('#zzz').ok);
  assert.ok(!parseColor('rgb(1,2)').ok);
});

test('rgbToHex: omits alpha when opaque, includes it when not', () => {
  assert.equal(rgbToHex({ r: 51, g: 102, b: 255, a: 1 }), '#3366ff');
  assert.equal(rgbToHex({ r: 51, g: 102, b: 255, a: 0.5 }), '#3366ff80');
});

test('rgbToHsl: matches known values', () => {
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0, a: 1 }), { h: 0, s: 100, l: 50, a: 1 });
  assert.deepEqual(rgbToHsl({ r: 128, g: 128, b: 128, a: 1 }), { h: 0, s: 0, l: 50, a: 1 });
  assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255, a: 1 }), { h: 0, s: 0, l: 100, a: 1 });
});

test('formatRgb / formatHsl: alpha only appears when not fully opaque', () => {
  assert.equal(formatRgb({ r: 255, g: 0, b: 0, a: 1 }), 'rgb(255, 0, 0)');
  assert.equal(formatRgb({ r: 255, g: 0, b: 0, a: 0.5 }), 'rgba(255, 0, 0, 0.5)');
  assert.equal(formatHsl({ r: 255, g: 0, b: 0, a: 1 }), 'hsl(0, 100%, 50%)');
});

test('HSL round trip can shift by 1 per channel due to rounding — a real, disclosed limitation', () => {
  const original = parseOk('rgb(30, 144, 255)');
  const asHsl = formatHsl(original);
  const back = parseOk(asHsl);
  assert.ok(Math.abs(back.r - original.r) <= 1);
  assert.ok(Math.abs(back.g - original.g) <= 1);
  assert.ok(Math.abs(back.b - original.b) <= 1);
});

test('contrastRatio: black vs white is the maximum, 21', () => {
  assert.equal(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }), 21);
});

test('contrastRatio: a color against itself is 1', () => {
  assert.equal(contrastRatio({ r: 51, g: 102, b: 255, a: 1 }, { r: 51, g: 102, b: 255, a: 1 }), 1);
});

test('relativeLuminance: white is 1, black is 0', () => {
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 }), 1);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 }), 0);
});

test('tintScale: same hue, lightness in 10-point steps, dark to light, base marked', async () => {
  const { tintScale, parseColor, rgbToHsl } = await import('../src/lib/color-convert.ts');
  const base = parseColor('hsl(225, 100%, 60%)');
  assert.ok(base.ok);
  const t = tintScale(base.value);
  assert.deepEqual(t.map((x) => x.l), [20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(t.filter((x) => x.isBase).length, 1);
  assert.equal(t.find((x) => x.isBase)!.l, 60);
  for (const x of t.filter((x) => x.l > 0 && x.l < 100)) assert.equal(rgbToHsl(x.color).h, 225);
  // Clamping at the ends never duplicates a swatch.
  const white = parseColor('#ffffff');
  assert.ok(white.ok);
  assert.deepEqual(tintScale(white.value).map((x) => x.l), [60, 70, 80, 90, 100]);
});
