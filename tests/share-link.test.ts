import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeShare, decodeShare, MAX_SHARE_CHARS, type SharePayload } from '../src/lib/share-link.ts';

const p = (i: Record<string, string>, o: SharePayload['o'] = {}): SharePayload => ({ v: 1, i, o });
const u = (json: string) => 'u' + Buffer.from(json).toString('base64url');

test('a payload survives the round trip, including options, two inputs and non-ASCII text', async () => {
  const payload = p({ 'input-old': '{"name": "Zoë 🚀", "city": "東京"}', 'input-new': 'second box\nwith lines' }, { 'opt-indent': '4', 'opt-sort': true });
  assert.deepEqual(await decodeShare(await encodeShare(payload)), payload);
});

test('the fragment is URL-safe base64 (no + / = that links or chat apps can mangle)', async () => {
  const code = await encodeShare(p({ input: '~~~???>>>'.repeat(50) }));
  assert.match(code, /^[zu][A-Za-z0-9_-]+$/);
});

test('typical JSON compresses well below its own length, so realistic inputs fit the link limit', async () => {
  const rows = Array.from({ length: 120 }, (_, n) => ({ id: n, name: `User ${n}`, active: n % 2 === 0, tags: ['a', 'b'] }));
  const json = JSON.stringify(rows, null, 2);
  const code = await encodeShare(p({ input: json }));
  assert.ok(code.length < json.length / 3, `${code.length} vs ${json.length}`);
  assert.ok(code.length < MAX_SHARE_CHARS);
});

test('an uncompressed (u) fragment from a browser without CompressionStream still decodes', async () => {
  assert.deepEqual(await decodeShare(u(JSON.stringify(p({ input: 'plain' })))), p({ input: 'plain' }));
});

test('anything that is not a valid share decodes to null instead of throwing', async () => {
  for (const bad of ['', 'x123', 'zNOT-DEFLATE', u('{"v":2,"i":{}}'), u('{"v":1,"i":{"input":1}}'), u('{"v":1,"i":["an array"]}')]) {
    assert.equal(await decodeShare(bad), null, bad);
  }
});

test('option values that are neither text nor on/off are dropped, never applied', async () => {
  const code = u(JSON.stringify({ v: 1, i: { input: 'x' }, o: { ok: 'a', flag: false, evil: { nested: 1 }, n: 5 } }));
  assert.deepEqual(await decodeShare(code), p({ input: 'x' }, { ok: 'a', flag: false }));
});
