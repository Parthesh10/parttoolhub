/**
 * Color parsing and conversion between hex, rgb()/rgba() and hsl()/hsla().
 * Pure, no DOM.
 */

export interface Rgba {
  r: number; g: number; b: number;
  /** 0–1. */
  a: number;
}

export type Result = { ok: true; value: Rgba } | { ok: false; error: string };

const clamp255 = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function parseHex(s: string): Rgba | null {
  const hex = s.replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const one = (c: string) => parseInt(c.length === 1 ? c + c : c, 16);
  if (hex.length === 3) return { r: one(hex[0]), g: one(hex[1]), b: one(hex[2]), a: 1 };
  if (hex.length === 4) return { r: one(hex[0]), g: one(hex[1]), b: one(hex[2]), a: one(hex[3]) / 255 };
  if (hex.length === 6) return { r: one(hex.slice(0, 2)), g: one(hex.slice(2, 4)), b: one(hex.slice(4, 6)), a: 1 };
  if (hex.length === 8) return { r: one(hex.slice(0, 2)), g: one(hex.slice(2, 4)), b: one(hex.slice(4, 6)), a: one(hex.slice(6, 8)) / 255 };
  return null;
}

function parsePercentOrNumber(tok: string, max: number): number | null {
  const m = tok.trim().match(/^(-?\d+(?:\.\d+)?)(%)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? (n / 100) * max : n;
}

function parseRgbFn(s: string): Rgba | null {
  const m = s.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const r = parsePercentOrNumber(parts[0], 255);
  const g = parsePercentOrNumber(parts[1], 255);
  const b = parsePercentOrNumber(parts[2], 255);
  if (r === null || g === null || b === null) return null;
  let a = 1;
  if (parts[3] !== undefined) {
    const av = parts[3].endsWith('%') ? parsePercentOrNumber(parts[3], 1) : Number(parts[3]);
    if (av === null || Number.isNaN(av)) return null;
    a = av;
  }
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s / 100);
  l = clamp01(l / 100);
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hh = h / 360;
  return {
    r: clamp255(hue2rgb(p, q, hh + 1 / 3) * 255),
    g: clamp255(hue2rgb(p, q, hh) * 255),
    b: clamp255(hue2rgb(p, q, hh - 1 / 3) * 255),
  };
}

function parseHslFn(s: string): Rgba | null {
  const m = s.match(/^hsla?\(\s*([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const hm = parts[0].trim().match(/^(-?\d+(?:\.\d+)?)(deg)?$/);
  if (!hm) return null;
  const h = Number(hm[1]);
  const sPct = parts[1].trim().match(/^(\d+(?:\.\d+)?)%$/);
  const lPct = parts[2].trim().match(/^(\d+(?:\.\d+)?)%$/);
  if (!sPct || !lPct) return null;
  let a = 1;
  if (parts[3] !== undefined) {
    const av = parts[3].endsWith('%') ? parsePercentOrNumber(parts[3], 1) : Number(parts[3]);
    if (av === null || Number.isNaN(av)) return null;
    a = av;
  }
  const rgb = hslToRgb(h, Number(sPct[1]), Number(lPct[1]));
  return { ...rgb, a: clamp01(a) };
}

export function parseColor(input: string): Result {
  const s = input.trim();
  if (!s) return { ok: false, error: 'Enter a color.' };
  const value = parseHex(s) ?? parseRgbFn(s) ?? parseHslFn(s);
  if (!value) {
    return { ok: false, error: 'Could not parse that as a color. Try a hex code (#3366ff), rgb(51, 102, 255), or hsl(225, 100%, 60%).' };
  }
  return { ok: true, value };
}

export function rgbToHex({ r, g, b, a }: Rgba, includeAlphaIfOpaque = false): string {
  const hx = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  const base = `#${hx(r)}${hx(g)}${hx(b)}`;
  if (a >= 1 && !includeAlphaIfOpaque) return base;
  return base + Math.round(clamp01(a) * 255).toString(16).padStart(2, '0');
}

export function rgbToHsl({ r, g, b, a }: Rgba): { h: number; s: number; l: number; a: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100), a };
}

export function formatRgb({ r, g, b, a }: Rgba): string {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})`;
}

export function formatHsl(rgba: Rgba): string {
  const { h, s, l, a } = rgbToHsl(rgba);
  return a >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${Number(a.toFixed(2))})`;
}

/** Relative luminance (WCAG 2.x) — used to decide black-or-white text on a swatch, and for contrast checks. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two colors, from 1 (identical) to 21 (black vs white). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const l1 = relativeLuminance(a) + 0.05;
  const l2 = relativeLuminance(b) + 0.05;
  return Number((Math.max(l1, l2) / Math.min(l1, l2)).toFixed(2));
}

export const SAMPLE_COLOR = '#3366ff';

/**
 * Darker and lighter versions of a colour for the Color Converter's tint strip: the same hue and
 * saturation at lightness `l - n*step … l + n*step` (clamped to 0-100, duplicates from clamping
 * dropped), ordered dark to light, with the input colour itself marked. Alpha is kept.
 */
export function tintScale(color: Rgba, step = 10, n = 4): { l: number; color: Rgba; isBase: boolean }[] {
  const { h, s, l } = rgbToHsl(color);
  const seen = new Set<number>();
  const out: { l: number; color: Rgba; isBase: boolean }[] = [];
  for (let i = -n; i <= n; i++) {
    const li = Math.min(100, Math.max(0, l + i * step));
    if (seen.has(li)) continue;
    seen.add(li);
    const base = i === 0;
    out.push({ l: li, color: base ? color : { ...hslToRgb(h, s, li), a: color.a }, isBase: base });
  }
  return out;
}
