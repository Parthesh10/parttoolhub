import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, detectLanguage, LANGUAGES, type Language } from '../src/lib/syntax-highlight.ts';

function reconstruct(src: string, lang: Language) {
  return tokenize(src, lang).map((t) => t.text).join('');
}

test('plain text is returned as one unclassified token', () => {
  const tokens = tokenize('hello world', 'plain');
  assert.deepEqual(tokens, [{ type: 'plain', text: 'hello world' }]);
});

test('empty input tokenizes to an empty array for every language', () => {
  for (const { value } of LANGUAGES) assert.deepEqual(tokenize('', value), []);
});

test('JavaScript: keywords, a line comment and a template literal are classified, and reconstruction is exact', () => {
  const src = 'function greet(name) {\n  // say hi\n  const msg = `Hello, ${name}!`;\n  return msg;\n}';
  const tokens = tokenize(src, 'javascript');
  assert.equal(reconstruct(src, 'javascript'), src);
  const types = tokens.filter((t) => t.type !== 'plain').map((t) => t.type);
  assert.deepEqual(types, ['keyword', 'comment', 'keyword', 'string', 'keyword']);
});

test('Python: a triple-quoted docstring, an f-string and a trailing comment are classified, and reconstruction is exact', () => {
  const src = 'def greet(name):\n    """Say hi."""\n    msg = f\'Hello, {name}!\'  # comment\n    return msg';
  const tokens = tokenize(src, 'python');
  assert.equal(reconstruct(src, 'python'), src);
  const types = tokens.filter((t) => t.type !== 'plain').map((t) => t.type);
  assert.deepEqual(types, ['keyword', 'string', 'string', 'comment', 'keyword']);
});

test('a backslash-escaped quote inside a string does not end it early', () => {
  const src = 'const s = "a \\"quoted\\" word";';
  const tokens = tokenize(src, 'javascript');
  assert.equal(reconstruct(src, 'javascript'), src);
  const str = tokens.find((t) => t.type === 'string');
  assert.equal(str?.text, '"a \\"quoted\\" word"');
});

test('an unterminated string does not hang or throw; it just consumes to end of input', () => {
  const src = 'const s = "never closed';
  assert.doesNotThrow(() => tokenize(src, 'javascript'));
  assert.equal(reconstruct(src, 'javascript'), src);
});

test('HTML: a tag is one token distinct from its text content', () => {
  const src = '<p>Hello <b>world</b></p>';
  const tokens = tokenize(src, 'html');
  assert.equal(reconstruct(src, 'html'), src);
  assert.deepEqual(tokens.filter((t) => t.type === 'tag').map((t) => t.text), ['<p>', '<b>', '</b>', '</p>']);
});

test('SQL keywords are recognised case-insensitively', () => {
  const tokens = tokenize('select * from users', 'sql');
  assert.equal(tokens.find((t) => t.text === 'select')?.type, 'keyword');
  const upper = tokenize('SELECT * FROM users', 'sql');
  assert.equal(upper.find((t) => t.text === 'SELECT')?.type, 'keyword');
});

test('a number is not misclassified when it is part of an identifier (e.g. base64, sha256)', () => {
  const tokens = tokenize('const sha256 = 42;', 'javascript');
  const ident = tokens.find((t) => t.text === 'sha256');
  assert.equal(ident?.type, 'plain');
  const num = tokens.find((t) => t.text === '42');
  assert.equal(num?.type, 'number');
});

test('detectLanguage: recognises JSON, HTML, SQL, Python and JavaScript from real samples', () => {
  assert.equal(detectLanguage('{"a": 1, "b": [1,2]}'), 'json');
  assert.equal(detectLanguage('<div class="x">hi</div>'), 'html');
  assert.equal(detectLanguage('SELECT * FROM users WHERE id = 1'), 'sql');
  assert.equal(detectLanguage('def greet(name):\n    return name'), 'python');
  assert.equal(detectLanguage('function greet(name) { return name; }'), 'javascript');
});

test('detectLanguage: empty or ambiguous plain text falls back to \'plain\'', () => {
  assert.equal(detectLanguage(''), 'plain');
  assert.equal(detectLanguage('just a sentence with no code markers'), 'plain');
});
