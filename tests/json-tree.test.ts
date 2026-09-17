import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJsonTree } from '../src/lib/json-tree.ts';

test('primitive root renders as a single leaf with no key', () => {
  const html = renderJsonTree(42);
  assert.equal(html, '<div class="jt-leaf" data-path="$"><span class="jt-number">42</span></div>');
});

test('object renders one <details> per container, one leaf per primitive', () => {
  const html = renderJsonTree({ name: 'Ada', active: true });
  assert.match(html, /^<details class="jt-node" open data-path="\$">/);
  assert.match(html, /<span class="jt-key">"name"<\/span>.*<span class="jt-string">"Ada"<\/span>/);
  assert.match(html, /<span class="jt-key">"active"<\/span>.*<span class="jt-boolean">true<\/span>/);
  assert.match(html, /\{2 keys\}/);
});

test('array uses index-based JSONPath and singular/plural item count', () => {
  const html = renderJsonTree(['a', 'b']);
  assert.match(html, /data-path="\$\[0\]"/);
  assert.match(html, /data-path="\$\[1\]"/);
  assert.match(html, /\[2 items\]/);
  const one = renderJsonTree(['a']);
  assert.match(one, /\[1 item\]/);
});

test('nested object/array paths compose correctly', () => {
  const html = renderJsonTree({ tags: ['x', 'y'], address: { city: 'London' } });
  assert.match(html, /data-path="\$\.tags\[0\]"/);
  assert.match(html, /data-path="\$\.tags\[1\]"/);
  assert.match(html, /data-path="\$\.address\.city"/);
});

test('a key that is not a valid bare identifier gets bracket-quoted in its path (quotes HTML-escaped in the attribute)', () => {
  const html = renderJsonTree({ 'first name': 'Ada' });
  assert.match(html, /data-path="\$\[&quot;first name&quot;\]"/);
});

test('empty object and array render as a leaf with no expand toggle', () => {
  assert.match(renderJsonTree({}), /<div class="jt-leaf"[^>]*><span class="jt-punct">\{\}<\/span><\/div>/);
  assert.match(renderJsonTree([]), /<div class="jt-leaf"[^>]*><span class="jt-punct">\[\]<\/span><\/div>/);
});

test('null is rendered distinctly from the string "null"', () => {
  const html = renderJsonTree({ a: null, b: 'null' });
  assert.match(html, /"a"<\/span><span class="jt-colon">: <\/span><span class="jt-null">null<\/span>/);
  assert.match(html, /"b"<\/span><span class="jt-colon">: <\/span><span class="jt-string">"null"<\/span>/);
});

test('HTML-special characters in both keys and string values are escaped (XSS safety)', () => {
  const html = renderJsonTree({ '<img src=x>': '<script>alert(1)</script>', quote: `He said "hi" & left` });
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('He said &quot;hi&quot; &amp; left'));
});
