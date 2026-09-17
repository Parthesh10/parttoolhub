import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonToTsInterface } from '../src/lib/json-to-ts.ts';

test('simple flat object', () => {
  const ts = jsonToTsInterface({ name: 'Ada', age: 28, active: true });
  assert.equal(ts, 'interface Root {\n  name: string;\n  age: number;\n  active: boolean;\n}');
});

test('null becomes the literal type "null", not "unknown"', () => {
  const ts = jsonToTsInterface({ value: null });
  assert.equal(ts, 'interface Root {\n  value: null;\n}');
});

test('nested object becomes its own named interface, referenced by field type', () => {
  const ts = jsonToTsInterface({ name: 'Ada', address: { city: 'London', zip: '10001' } });
  assert.match(ts, /interface Address \{\n {2}city: string;\n {2}zip: string;\n\}/);
  assert.match(ts, /interface Root \{\n {2}name: string;\n {2}address: Address;\n\}/);
  // Nested interface must be emitted before the interface that references it.
  assert.ok(ts.indexOf('interface Address') < ts.indexOf('interface Root'));
});

test('array of primitives becomes a primitive[] type', () => {
  const ts = jsonToTsInterface({ tags: ['a', 'b'] });
  assert.equal(ts, 'interface Root {\n  tags: string[];\n}');
});

test('a mixed-type array of primitives becomes a union array', () => {
  const ts = jsonToTsInterface({ mixed: [1, 'a', true] });
  assert.match(ts, /mixed: \((number \| string \| boolean|[a-z ]+\|[a-z ]+\|[a-z ]+)\)\[\];/);
});

test('array of objects merges into one Item interface rather than a union of N', () => {
  const ts = jsonToTsInterface({ tags: [{ id: 1, label: 'x' }, { id: 2, label: 'y' }] });
  assert.match(ts, /interface TagsItem \{\n {2}id: number;\n {2}label: string;\n\}/);
  assert.match(ts, /tags: TagsItem\[\];/);
});

test('a field missing from some array-of-object elements becomes optional, not required', () => {
  const ts = jsonToTsInterface({ items: [{ a: 1, b: 2 }, { a: 3 }] });
  assert.match(ts, /a: number;/);
  assert.match(ts, /b\?: number;/);
});

test('a field with different types across array elements becomes a union', () => {
  const ts = jsonToTsInterface({ items: [{ id: 1 }, { id: 'two' }] });
  assert.match(ts, /id: number \| string;/);
});

test('root array of objects: a type alias plus one merged item interface', () => {
  const ts = jsonToTsInterface([{ id: 1 }, { id: 2 }], 'Root');
  assert.match(ts, /interface RootItem \{\n {2}id: number;\n\}/);
  assert.match(ts, /type Root = RootItem\[\];/);
  assert.ok(ts.indexOf('interface RootItem') < ts.indexOf('type Root'));
});

test('root array of primitives: a plain type alias, no interface', () => {
  const ts = jsonToTsInterface([1, 2, 3], 'Root');
  assert.equal(ts, 'type Root = number[];');
});

test('root scalar: a plain type alias', () => {
  assert.equal(jsonToTsInterface(42, 'Root'), 'type Root = number;');
  assert.equal(jsonToTsInterface('hi', 'Root'), 'type Root = string;');
  assert.equal(jsonToTsInterface(null, 'Root'), 'type Root = null;');
});

test('empty array becomes unknown[] rather than guessing a type', () => {
  const ts = jsonToTsInterface({ items: [] });
  assert.match(ts, /items: unknown\[\];/);
});

test('empty object becomes an empty interface body', () => {
  const ts = jsonToTsInterface({ meta: {} });
  assert.match(ts, /interface Meta \{\}/);
  assert.match(ts, /meta: Meta;/);
});

test('a key that is not a valid identifier is quoted in the interface field', () => {
  const ts = jsonToTsInterface({ 'first-name': 'Ada', '2fa': true });
  assert.match(ts, /"first-name": string;/);
  assert.match(ts, /"2fa": boolean;/);
});

test('two same-named nested objects at different paths get disambiguated interface names', () => {
  // Both `owner` and `assignee` produce a "Person"-shaped hint here only if we used the same key
  // twice; with different keys they already get different names naturally, so exercise the real
  // collision case instead: two *different* branches that would both want the same pascal-cased name.
  const ts = jsonToTsInterface({ data: { id: 1 }, extra: { data: { id: 2 } } });
  const interfaceNames = [...ts.matchAll(/^interface (\w+)/gm)].map((m) => m[1]);
  assert.equal(new Set(interfaceNames).size, interfaceNames.length, `duplicate interface names: ${interfaceNames.join(', ')}`);
});
