import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, relativeTime, describeClaims } from '../src/lib/jwt-decode.ts';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const make = (header: unknown, payload: unknown, sig = 'sig') => `${b64url(header)}.${b64url(payload)}.${sig}`;

test('decodes header, payload and signature', () => {
  const token = make({ alg: 'HS256', typ: 'JWT' }, { sub: '123', name: 'Ada', admin: true });
  const r = decodeJwt(token);
  assert.ok(r.ok);
  assert.deepEqual(r.jwt.header, { alg: 'HS256', typ: 'JWT' });
  assert.equal(r.jwt.payload.name, 'Ada');
  assert.equal(r.jwt.signature, 'sig');
});

test('computes expiry status from exp', () => {
  const now = 1_700_000_000_000;
  const live = decodeJwt(make({ alg: 'none' }, { exp: now / 1000 + 60 }), now);
  const dead = decodeJwt(make({ alg: 'none' }, { exp: now / 1000 - 60 }), now);
  const none = decodeJwt(make({ alg: 'none' }, { sub: 'x' }), now);
  assert.ok(live.ok && live.jwt.timing.expired === false);
  assert.ok(dead.ok && dead.jwt.timing.expired === true);
  assert.ok(none.ok && none.jwt.timing.expired === null);
});

test('strips a Bearer prefix and whitespace', () => {
  const r = decodeJwt(`  Bearer ${make({ alg: 'none' }, { a: 1 })}\n`);
  assert.ok(r.ok && r.jwt.payload.a === 1);
});

test('handles UTF-8 in claims', () => {
  const r = decodeJwt(make({ alg: 'none' }, { name: 'Zoë 日本' }));
  assert.ok(r.ok && r.jwt.payload.name === 'Zoë 日本');
});

test('clear errors for malformed input', () => {
  assert.ok(!decodeJwt('').ok);
  const two = decodeJwt('a.b');
  assert.ok(!two.ok && /three/.test(two.error));
  const bad = decodeJwt('!!!.@@@.x');
  assert.ok(!bad.ok);
  const notJson = decodeJwt(`${Buffer.from('hello').toString('base64url')}.${b64url({})}.x`);
  assert.ok(!notJson.ok && /JSON/.test(notJson.error));
});

test('relativeTime phrasing', () => {
  const now = 1_700_000_000_000;
  assert.equal(relativeTime(new Date(now + 2 * 3600e3), now), 'in 2 hours');
  assert.equal(relativeTime(new Date(now - 3 * 86400e3), now), '3 days ago');
  assert.equal(relativeTime(new Date(now - 1000), now), '1 second ago');
});

test('describeClaims: registered header claims get human labels', () => {
  const rows = describeClaims({ alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(rows, [
    { key: 'alg', label: 'Algorithm', value: 'HS256', isRegistered: true },
    { key: 'typ', label: 'Type', value: 'JWT', isRegistered: true },
  ]);
});

test('describeClaims: exp/nbf/iat render as human-readable dates with relative phrasing', () => {
  const rows = describeClaims({ iat: 1700000000 });
  assert.equal(rows[0].label, 'Issued At');
  assert.match(rows[0].value, /^2023-11-14 22:13:20 UTC \(.+\)$/);
});

test('describeClaims: an unregistered/private claim keeps its own key as the label', () => {
  const rows = describeClaims({ role: 'admin', 'x-custom-claim': 42 });
  assert.deepEqual(rows, [
    { key: 'role', label: 'role', value: 'admin', isRegistered: false },
    { key: 'x-custom-claim', label: 'x-custom-claim', value: '42', isRegistered: false },
  ]);
});

test('describeClaims: arrays, objects, null and booleans all render to plain text', () => {
  const rows = describeClaims({ aud: ['api-a', 'api-b'], meta: { plan: 'pro' }, admin: true, note: null });
  assert.equal(rows[0].value, 'api-a, api-b');
  assert.equal(rows[1].value, '{"plan":"pro"}');
  assert.equal(rows[2].value, 'true');
  assert.equal(rows[3].value, 'null');
});

test('describeClaims: row order follows the object\'s own key order, not the label map', () => {
  const rows = describeClaims({ jti: 'x', sub: 'y', iss: 'z' });
  assert.deepEqual(rows.map((r) => r.key), ['jti', 'sub', 'iss']);
});
