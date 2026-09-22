/**
 * Lightweight, dependency-free syntax tokenizer for the Text Diff Checker's optional code
 * highlighting. Deliberately basic — comments, strings, numbers and a per-language keyword list,
 * nothing that needs a real parser (no bracket matching, no distinguishing a function name from a
 * variable). Good enough to scan a diff at a glance; not a replacement for an IDE. Verified against
 * real JS and Python samples (template-literal interpolation, triple-quoted docstrings, an f-string,
 * a line comment after code) for exact character-for-character reconstruction before being trusted.
 * Pure, no DOM.
 */

export type Language = 'plain' | 'javascript' | 'python' | 'json' | 'html' | 'css' | 'sql' | 'bash';

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'plain', label: 'Plain text (no highlighting)' },
  { value: 'javascript', label: 'JavaScript / TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML / XML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash / Shell' },
];

export type TokenType = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'tag';
export interface Token {
  type: TokenType;
  text: string;
}

interface LangSpec {
  lineComment?: string;
  blockComment?: [string, string];
  strings: string[];
  keywords: Set<string>;
  /** HTML/XML-style `<tag>` markup, tokenized as a whole rather than by keyword. */
  tags?: boolean;
}

const JS_KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends',
  'new', 'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch', 'finally',
  'throw', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false', 'this', 'super', 'static',
  'of', 'in', 'do', 'switch', 'case', 'break', 'continue', 'yield', 'delete', 'void', 'interface',
  'type', 'enum', 'implements', 'public', 'private', 'protected', 'readonly',
];
const PY_KEYWORDS = [
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'try',
  'except', 'finally', 'raise', 'with', 'lambda', 'None', 'True', 'False', 'self', 'and', 'or',
  'not', 'in', 'is', 'pass', 'break', 'continue', 'yield', 'global', 'nonlocal', 'assert', 'del',
];
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'ON', 'GROUP', 'BY',
  'ORDER', 'HAVING', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
  'ALTER', 'DROP', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'DISTINCT', 'LIMIT', 'UNION', 'ALL',
];
const BASH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function',
  'return', 'export', 'local', 'echo', 'exit', 'in',
];
const CSS_KEYWORDS = [
  'important', 'inherit', 'initial', 'unset', 'auto', 'none', 'flex', 'grid', 'block', 'inline',
];

const LANGS: Record<Exclude<Language, 'plain'>, LangSpec> = {
  javascript: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['`', '"', "'"], keywords: new Set(JS_KEYWORDS) },
  python: { lineComment: '#', strings: ['"""', "'''", '"', "'"], keywords: new Set(PY_KEYWORDS) },
  json: { strings: ['"'], keywords: new Set(['true', 'false', 'null']) },
  html: { blockComment: ['<!--', '-->'], strings: ['"', "'"], keywords: new Set(), tags: true },
  css: { blockComment: ['/*', '*/'], strings: ['"', "'"], keywords: new Set(CSS_KEYWORDS) },
  sql: { lineComment: '--', blockComment: ['/*', '*/'], strings: ["'", '"'], keywords: new Set(SQL_KEYWORDS.flatMap((k) => [k, k.toLowerCase()])) },
  bash: { lineComment: '#', strings: ['"', "'"], keywords: new Set(BASH_KEYWORDS) },
};

/** Best-effort language guess from a handful of cheap, high-signal markers. Defaults to 'plain'. */
export function detectLanguage(src: string): Language {
  const s = src.trim();
  if (!s) return 'plain';
  if (/^[[{]/.test(s) && /["'\d\-{[]\s*[:,\]}]/.test(s)) return 'json';
  if (/^</.test(s) && /<\/?[a-zA-Z!][^>]*>/.test(s)) return 'html';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/i.test(s)) return 'sql';
  if (/^#!.*\b(bash|sh)\b/.test(s) || /^\s*(export |echo )/.test(s)) return 'bash';
  if (/^\s*(def |import |from .+ import |class .+:)/.test(s) || /:\s*$/m.test(s)) return 'python';
  if (/[{};]\s*$/m.test(s) && /\b(function|const|let|var|=>)\b/.test(s)) return 'javascript';
  if (/[{}]/.test(s) && /:\s*[^;]+;/.test(s)) return 'css';
  return 'plain';
}

export function tokenize(src: string, lang: Language): Token[] {
  if (lang === 'plain') return src ? [{ type: 'plain', text: src }] : [];
  const spec = LANGS[lang];
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    if (spec.tags && src[i] === '<') {
      const close = src.indexOf('>', i);
      const end = close === -1 ? n : close + 1;
      tokens.push({ type: 'tag', text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (spec.lineComment && src.startsWith(spec.lineComment, i)) {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      tokens.push({ type: 'comment', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (spec.blockComment && src.startsWith(spec.blockComment[0], i)) {
      const close = src.indexOf(spec.blockComment[1], i + spec.blockComment[0].length);
      const end = close === -1 ? n : close + spec.blockComment[1].length;
      tokens.push({ type: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }
    const delim = spec.strings.find((d) => src.startsWith(d, i));
    if (delim) {
      let j = i + delim.length;
      while (j < n && !src.startsWith(delim, j)) {
        if (src[j] === '\\') j += 2;
        else j++;
      }
      j = Math.min(j + delim.length, n);
      tokens.push({ type: 'string', text: src.slice(i, j) });
      i = j;
      continue;
    }
    const numMatch = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (numMatch && !/[A-Za-z_$]/.test(src[i - 1] ?? '')) {
      tokens.push({ type: 'number', text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }
    const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
    if (idMatch) {
      const word = idMatch[0];
      tokens.push({ type: spec.keywords.has(word) ? 'keyword' : 'plain', text: word });
      i += word.length;
      continue;
    }
    const wsMatch = /^\s+/.exec(src.slice(i));
    if (wsMatch) {
      tokens.push({ type: 'plain', text: wsMatch[0] });
      i += wsMatch[0].length;
      continue;
    }
    tokens.push({ type: 'plain', text: src[i] });
    i++;
  }
  return tokens;
}
