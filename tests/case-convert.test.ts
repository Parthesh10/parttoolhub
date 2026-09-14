import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, convertCase, convertAll, SAMPLE_INPUT } from '../src/lib/case-convert.ts';

test('tokenize splits camelCase, PascalCase and acronym runs', () => {
  assert.deepEqual(tokenize('myVariableName'), ['my', 'Variable', 'Name']);
  assert.deepEqual(tokenize('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  assert.deepEqual(tokenize('getUserID'), ['get', 'User', 'ID']);
});

test('tokenize splits on underscores, hyphens, dots, spaces and line breaks', () => {
  assert.deepEqual(tokenize('some_variable_name'), ['some', 'variable', 'name']);
  assert.deepEqual(tokenize('some-kebab-case'), ['some', 'kebab', 'case']);
  assert.deepEqual(tokenize('some.dot.case'), ['some', 'dot', 'case']);
  assert.deepEqual(tokenize('already Spaced Words'), ['already', 'Spaced', 'Words']);
  assert.deepEqual(tokenize('line one\nline two'), ['line', 'one', 'line', 'two']);
  assert.deepEqual(tokenize('SCREAMING_SNAKE_CASE'), ['SCREAMING', 'SNAKE', 'CASE']);
});

test('tokenize: digits stay attached to the token they touch', () => {
  assert.deepEqual(tokenize('version2'), ['version2']);
  assert.deepEqual(tokenize('2FastCars'), ['2', 'Fast', 'Cars']);
  // A known limitation, not a bug: without knowing "iOS" is a brand name, the
  // tokenizer only sees a lower/upper boundary at "i|OS9" and stops there.
  assert.deepEqual(tokenize('iOS9Update'), ['i', 'OS9', 'Update']);
});

test('tokenize: empty and separator-only input produce no tokens', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize('___---...'), []);
});

test('convertCase: every target style from the same tokens', () => {
  const tokens = ['user', 'First', 'Name'];
  assert.equal(convertCase(tokens.join(' '), 'camel'), 'userFirstName');
  assert.equal(convertCase(tokens.join(' '), 'pascal'), 'UserFirstName');
  assert.equal(convertCase(tokens.join(' '), 'snake'), 'user_first_name');
  assert.equal(convertCase(tokens.join(' '), 'constant'), 'USER_FIRST_NAME');
  assert.equal(convertCase(tokens.join(' '), 'kebab'), 'user-first-name');
  assert.equal(convertCase(tokens.join(' '), 'dot'), 'user.first.name');
});

test('convertCase is idempotent: converting an already-correct style is a no-op', () => {
  assert.equal(convertCase('userFirstName', 'camel'), 'userFirstName');
  assert.equal(convertCase('USER_FIRST_NAME', 'constant'), 'USER_FIRST_NAME');
  assert.equal(convertCase('user-first-name', 'kebab'), 'user-first-name');
});

test('convertCase on empty input returns an empty string, not an error', () => {
  assert.equal(convertCase('', 'camel'), '');
  assert.equal(convertCase('   ', 'snake'), '');
});

test('convertAll returns every style keyed by CaseStyle', () => {
  const all = convertAll(SAMPLE_INPUT);
  assert.deepEqual(all, {
    camel: 'userFirstName',
    pascal: 'UserFirstName',
    snake: 'user_first_name',
    constant: 'USER_FIRST_NAME',
    kebab: 'user-first-name',
    dot: 'user.first.name',
  });
});

test('a single word round-trips unchanged in camel/snake/kebab (no boundary to split)', () => {
  assert.equal(convertCase('hello', 'camel'), 'hello');
  assert.equal(convertCase('hello', 'snake'), 'hello');
  assert.equal(convertCase('HELLO', 'constant'), 'HELLO');
});
