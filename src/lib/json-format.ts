/**
 * JSON formatting and validation with useful error locations. Pure, no DOM.
 */
export type Indent = 2 | 4 | 'tab';

export interface JsonOk {
  ok: true;
  output: string;
  /** Top-level type, e.g. "object", "array". */
  kind: string;
}
export interface JsonError {
  ok: false;
  error: string;
  line?: number;
  column?: number;
  /** The offending line's text, for a caret display. */
  snippet?: string;
}
export type JsonResult = JsonOk | JsonError;

export interface FormatOptions {
  indent: Indent;
  sortKeys: boolean;
}

export const DEFAULT_FORMAT: FormatOptions = { indent: 2, sortKeys: false };

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) out[k] = sortDeep((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Translate an engine's SyntaxError message into a line/column, when possible.
 * Firefox and newer V8 include "line N column M"; older V8 gives "position N";
 * V8's "Unexpected token" form gives a context snippet of 10 characters either
 * side of the offending token, which we search for in the input.
 */
function locate(message: string, input: string): { line?: number; column?: number; snippet?: string } {
  let line: number | undefined;
  let column: number | undefined;
  let pos: number | undefined;

  const lc = message.match(/line (\d+) column (\d+)/i);
  const posMatch = message.match(/position (\d+)/i);
  const ctx = message.match(/^Unexpected token '(.+?)', (\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/);

  if (lc) {
    line = Number(lc[1]);
    column = Number(lc[2]);
  } else if (posMatch) {
    pos = Number(posMatch[1]);
  } else if (ctx) {
    const [, token, leading, context] = ctx;
    if (leading) {
      const i = input.indexOf(context);
      if (i >= 0) pos = i + 10;
    } else {
      const i = input.indexOf(token);
      if (i >= 0) pos = i;
    }
  } else if (/unexpected end of (?:json )?input/i.test(message)) {
    pos = input.length;
  }

  if (pos !== undefined) {
    const before = input.slice(0, pos);
    line = before.split('\n').length;
    column = pos - before.lastIndexOf('\n');
  }
  if (line === undefined) return {};
  const snippet = input.split('\n')[line - 1];
  return { line, column, snippet };
}

/** Strip the engine-specific prefix so the message reads the same in every browser. */
function cleanMessage(message: string): string {
  return message
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/\s*in JSON at position \d+.*$/i, '')
    .replace(/\s*\(line \d+ column \d+\)\s*$/i, '')
    .replace(/\s*at line \d+ column \d+ of the JSON data$/i, '')
    .replace(/,\s*"[^"]*"\s*is not valid JSON$/i, '')
    .trim();
}

export function parseJson(input: string): { ok: true; value: unknown } | JsonError {
  if (!input.trim()) return { ok: false, error: 'Input is empty.' };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: cleanMessage(message), ...locate(message, input) };
  }
}

export function formatJson(input: string, opts: Partial<FormatOptions> = {}): JsonResult {
  const o = { ...DEFAULT_FORMAT, ...opts };
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  const value = o.sortKeys ? sortDeep(parsed.value) : parsed.value;
  const indent = o.indent === 'tab' ? '\t' : o.indent;
  return { ok: true, output: JSON.stringify(value, null, indent), kind: kindOf(value) };
}

export function minifyJson(input: string, opts: Partial<Pick<FormatOptions, 'sortKeys'>> = {}): JsonResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  const value = opts.sortKeys ? sortDeep(parsed.value) : parsed.value;
  return { ok: true, output: JSON.stringify(value), kind: kindOf(value) };
}
