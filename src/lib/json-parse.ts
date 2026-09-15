/**
 * A `JSON.parse` wrapper that translates the engine's raw SyntaxError into a
 * line/column location plus a browser-independent message, instead of
 * whatever text that particular JS engine happened to throw. Originally part
 * of the JSON Formatter (src/lib/json-format.ts); pulled out so every tool
 * that parses JSON as an intermediate step (CSV↔JSON, JSON↔Python dict) gives
 * the same quality of error instead of leaking a raw, browser-specific
 * exception message — the inconsistency this file fixes was found during a
 * 2026-09-16 error-message audit. Pure, no DOM.
 */

/** A 0-based character offset into `text` → its 1-based line/column, for any parser that tracks
 *  a position but not a line/column (this file's own `locate` uses it for the same reason). */
export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return { line, column };
}

export interface JsonParseError {
  ok: false;
  error: string;
  line?: number;
  column?: number;
  /** The offending line's text, for a caret display. */
  snippet?: string;
}
export type JsonParseResult = { ok: true; value: unknown } | JsonParseError;

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
  // `[\s\S]` rather than `.` for the token: V8 reports a literal newline
  // as the offending token when a value is cut short at a line end.
  const ctx = message.match(/^Unexpected token '([\s\S]+?)', (\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/);

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
    ({ line, column } = offsetToLineColumn(input, pos));
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
    // The quoted context V8 appends can itself contain quotes and newlines,
    // so match greedily to the end rather than stopping at the first quote.
    .replace(/,\s*(?:\.\.\.)?"[\s\S]*"(?:\.\.\.)?\s*is not valid JSON$/i, '')
    .trim();
}

export function parseJson(input: string, emptyMessage = 'Input is empty.'): JsonParseResult {
  if (!input.trim()) return { ok: false, error: emptyMessage };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: cleanMessage(message), ...locate(message, input) };
  }
}
