/**
 * Aspect ratio: reduce width×height to the simplest whole-number ratio, name
 * it against common video/photo/display ratios, and scale a target width or
 * height to match. Pure, no DOM.
 *
 * Reduction is decimal-aware (dimensions like 8.5×11 paper or 36×24mm film
 * are real inputs, not just pixels): both values are scaled up by the larger
 * of their decimal-place counts before the Euclidean GCD, so 16.5×9 reduces
 * to the exact 11:6 rather than only working on whole pixels.
 */

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

export function parseDimension(raw: string, label: string): ParseResult {
  const s = raw.trim();
  if (!s) return { ok: false, error: `Enter a ${label}.` };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: `"${s}" is not a valid ${label}.` };
  if (n <= 0) return { ok: false, error: `Enter a ${label} greater than 0.` };
  return { ok: true, value: n };
}

function decimalPlaces(raw: string): number {
  const i = raw.indexOf('.');
  return i === -1 ? 0 : raw.length - i - 1;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Reduce width/height to the simplest whole-number ratio, scaling decimals up first so nothing is truncated. */
export function simplifyRatio(width: number, height: number, rawWidth = String(width), rawHeight = String(height)): [number, number] {
  const dp = Math.max(decimalPlaces(rawWidth), decimalPlaces(rawHeight));
  const scale = 10 ** dp;
  const iw = Math.round(width * scale);
  const ih = Math.round(height * scale);
  const g = gcd(iw, ih) || 1;
  return [iw / g, ih / g];
}

const KNOWN_RATIOS: { name: string; w: number; h: number }[] = [
  { name: '1:1 (Square)', w: 1, h: 1 },
  { name: '4:3 (Standard/Classic TV)', w: 4, h: 3 },
  { name: '3:2 (35mm photo/DSLR)', w: 3, h: 2 },
  { name: '16:10 (Widescreen laptop)', w: 16, h: 10 },
  { name: '16:9 (Widescreen/HD video)', w: 16, h: 9 },
  { name: '21:9 (Ultrawide/Cinematic, marketing name)', w: 21, h: 9 },
  { name: '3:4 (Portrait standard)', w: 3, h: 4 },
  { name: '2:3 (Portrait photo)', w: 2, h: 3 },
  { name: '4:5 (Instagram portrait)', w: 4, h: 5 },
  { name: '5:4 (Large format photo)', w: 5, h: 4 },
  { name: '9:16 (Vertical video/Reels/Stories)', w: 9, h: 16 },
  { name: '10:16 (Portrait laptop)', w: 10, h: 16 },
];

/** Nearest named ratio within 0.5% relative difference in decimal value, or null if nothing is close. */
export function knownRatioName(width: number, height: number): string | null {
  const r = width / height;
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const k of KNOWN_RATIOS) {
    const diff = Math.abs(r - k.w / k.h) / (k.w / k.h);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k.name;
    }
  }
  return bestDiff <= 0.005 ? best : null;
}

// Long-edge sizes recognisable across video (640/1280/1920/2560/3840), 5K and 8K displays.
const LONG_EDGE_TARGETS = [640, 1280, 1920, 2560, 3840, 5120, 7680];

export interface Resolution {
  width: number;
  height: number;
}

/**
 * Exact integer multiples of the simplified ratio near each common long-edge size. A multiple is
 * dropped if it lands more than 35% away from its target — most ratios (16:9, 4:3, 1:1) hit the
 * target exactly, but a ratio like 21:9 or 3:2 never divides evenly into these targets, since
 * marketed "21:9" ultrawide monitors are not actually 21:9 (see the FAQ) — the near-miss is real,
 * not a bug, and is disclosed on the page rather than silently rounded to something misleading.
 */
export function standardResolutions(ratioW: number, ratioH: number): Resolution[] {
  const long = Math.max(ratioW, ratioH);
  const seen = new Set<string>();
  const out: Resolution[] = [];
  for (const target of LONG_EDGE_TARGETS) {
    const k = Math.max(1, Math.round(target / long));
    const width = ratioW * k;
    const height = ratioH * k;
    const longEdge = Math.max(width, height);
    if (Math.abs(longEdge - target) / target > 0.35) continue;
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ width, height });
  }
  return out;
}

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface RatioInfo {
  ratioW: number;
  ratioH: number;
  /** width / height, full precision — used for scaling, not just display. */
  decimal: number;
  /** (height / width) * 100 — the classic CSS "padding-bottom hack" percentage for this ratio. */
  percentage: number;
  orientation: Orientation;
  knownName: string | null;
  standardResolutions: Resolution[];
}

export type RatioResult = { ok: true; value: RatioInfo } | { ok: false; error: string };

export function computeAspectRatio(width: number, height: number, rawWidth = String(width), rawHeight = String(height)): RatioResult {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'Enter finite width and height values.' };
  if (width <= 0 || height <= 0) return { ok: false, error: 'Width and height must both be greater than 0.' };

  const [ratioW, ratioH] = simplifyRatio(width, height, rawWidth, rawHeight);
  const decimal = width / height;
  const orientation: Orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait';

  return {
    ok: true,
    value: {
      ratioW,
      ratioH,
      decimal,
      percentage: (height / width) * 100,
      orientation,
      knownName: knownRatioName(width, height),
      standardResolutions: standardResolutions(ratioW, ratioH),
    },
  };
}

/** Height that keeps `width`/`height`'s ratio at a new target width. */
export function scaleToWidth(targetWidth: number, width: number, height: number): number {
  return targetWidth * (height / width);
}

/** Width that keeps `width`/`height`'s ratio at a new target height. */
export function scaleToHeight(targetHeight: number, width: number, height: number): number {
  return targetHeight * (width / height);
}

/** 1920×1080 — a genuinely common resolution, immediately recognisable as 16:9. */
export const SAMPLE_WIDTH = '1920';
export const SAMPLE_HEIGHT = '1080';
