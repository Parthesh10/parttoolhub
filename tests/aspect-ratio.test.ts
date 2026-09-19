import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDimension,
  simplifyRatio,
  knownRatioName,
  standardResolutions,
  computeAspectRatio,
  scaleToWidth,
  scaleToHeight,
} from '../src/lib/aspect-ratio.ts';

test('parseDimension rejects empty, non-numeric, zero and negative values', () => {
  assert.ok(!parseDimension('', 'width').ok);
  assert.ok(!parseDimension('abc', 'width').ok);
  assert.ok(!parseDimension('0', 'width').ok);
  assert.ok(!parseDimension('-5', 'width').ok);
});

test('parseDimension accepts a positive number, trimmed', () => {
  const r = parseDimension('  1920 ', 'width');
  assert.ok(r.ok);
  assert.equal(r.value, 1920);
});

test('simplifyRatio: 1920x1080 reduces to 16:9', () => {
  assert.deepEqual(simplifyRatio(1920, 1080), [16, 9]);
});

test('simplifyRatio: 1080x1920 (portrait) reduces to 9:16', () => {
  assert.deepEqual(simplifyRatio(1080, 1920), [9, 16]);
});

test('simplifyRatio: equal dimensions reduce to 1:1', () => {
  assert.deepEqual(simplifyRatio(800, 800), [1, 1]);
});

test('simplifyRatio: decimal dimensions (e.g. 16.5x9) reduce exactly, not just whole pixels', () => {
  assert.deepEqual(simplifyRatio(16.5, 9, '16.5', '9'), [11, 6]);
});

test('simplifyRatio: 8.5x11 (US Letter paper) reduces exactly', () => {
  assert.deepEqual(simplifyRatio(8.5, 11, '8.5', '11'), [17, 22]);
});

test('knownRatioName: matches 1920x1080 and 1280x720 to 16:9, and pixel-perfect squares to 1:1', () => {
  assert.match(knownRatioName(1920, 1080)!, /16:9/);
  assert.match(knownRatioName(1280, 720)!, /16:9/);
  assert.match(knownRatioName(500, 500)!, /1:1/);
});

test('knownRatioName: an arbitrary, non-standard ratio matches nothing', () => {
  assert.equal(knownRatioName(1337, 812), null);
});

test('knownRatioName: 1080x1350 (Instagram portrait) matches 4:5', () => {
  assert.match(knownRatioName(1080, 1350)!, /4:5/);
});

test('standardResolutions: 16:9 hits the real, well-known ladder exactly', () => {
  const list = standardResolutions(16, 9).map((r) => `${r.width}x${r.height}`);
  assert.deepEqual(list, ['640x360', '1280x720', '1920x1080', '2560x1440', '3840x2160', '5120x2880', '7680x4320']);
});

test('standardResolutions: 4:3 hits VGA/SVGA/XGA-family exact multiples', () => {
  const list = standardResolutions(4, 3).map((r) => `${r.width}x${r.height}`);
  assert.deepEqual(list, ['640x480', '1280x960', '1920x1440', '2560x1920', '3840x2880', '5120x3840', '7680x5760']);
});

test('standardResolutions: 21:9 never lands exactly on a target, since marketed ultrawide is not true 21:9', () => {
  for (const r of standardResolutions(21, 9)) {
    const longEdge = Math.max(r.width, r.height);
    assert.ok(!([640, 1280, 1920, 2560, 3840, 5120, 7680].includes(longEdge)), `${longEdge} should not be an exact video-width target for 21:9`);
  }
});

test('computeAspectRatio: 1920x1080 gives 16:9, decimal ~1.778, 56.25% padding-hack value, landscape', () => {
  const r = computeAspectRatio(1920, 1080);
  assert.ok(r.ok);
  assert.equal(r.value.ratioW, 16);
  assert.equal(r.value.ratioH, 9);
  assert.ok(Math.abs(r.value.decimal - 16 / 9) < 1e-9);
  assert.equal(r.value.percentage, 56.25);
  assert.equal(r.value.orientation, 'landscape');
  assert.match(r.value.knownName!, /16:9/);
});

test('computeAspectRatio: equal dimensions are "square", not landscape or portrait', () => {
  const r = computeAspectRatio(400, 400);
  assert.ok(r.ok);
  assert.equal(r.value.orientation, 'square');
});

test('computeAspectRatio: taller-than-wide is "portrait"', () => {
  const r = computeAspectRatio(1080, 1920);
  assert.ok(r.ok);
  assert.equal(r.value.orientation, 'portrait');
});

test('computeAspectRatio: rejects zero, negative and non-finite width/height', () => {
  assert.ok(!computeAspectRatio(0, 1080).ok);
  assert.ok(!computeAspectRatio(1920, -1).ok);
  assert.ok(!computeAspectRatio(NaN, 1080).ok);
  assert.ok(!computeAspectRatio(1920, Infinity).ok);
});

test('scaleToWidth: a 16:9 image at 1280 wide is exactly 720 tall', () => {
  assert.equal(scaleToWidth(1280, 1920, 1080), 720);
});

test('scaleToHeight: a 16:9 image at 720 tall is exactly 1280 wide', () => {
  assert.equal(scaleToHeight(720, 1920, 1080), 1280);
});

test('scaleToWidth and scaleToHeight are inverses of each other for the same ratio', () => {
  const w = scaleToHeight(2160, 1920, 1080); // width for a 2160-tall 16:9 image
  const h = scaleToWidth(w, 1920, 1080); // height back from that width
  assert.ok(Math.abs(h - 2160) < 1e-9);
});
