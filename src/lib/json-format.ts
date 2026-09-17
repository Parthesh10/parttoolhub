/**
 * JSON formatting and validation with useful error locations. Pure, no DOM.
 */
import { parseJson as parseJsonShared } from './json-parse';

/**
 * UX-008: named sample sets behind the "Load sample" control, so a visitor can pick data that
 * actually resembles what they're about to paste rather than always getting the same one object.
 * `simple` is the pre-existing default (unchanged, so it stays the one thing this tool's own
 * page's history has referenced); `apiResponse` and `edgeCase` are new.
 */
export const SAMPLES = {
  simple:
    '{"name":"Ada Lovelace","born":1815,"active":true,"tags":["mathematician","writer"],"address":{"city":"London","country":"UK"}}',
  apiResponse:
    '{"page":1,"per_page":2,"total":42,"results":[{"id":101,"name":"Widget A","price":19.99,"in_stock":true},{"id":102,"name":"Widget B","price":24.5,"in_stock":false}]}',
  // Exercises the cases the "Edge cases" section on the tool page already talks about: Unicode,
  // an integer past Number.MAX_SAFE_INTEGER (9007199254740993, which JSON.parse silently rounds),
  // an empty object/array, a null, and escaped characters inside a string.
  edgeCase:
    '{"unicode":"caf\\u00e9 \\u65e5\\u672c","bigNumber":9007199254740993,"emptyArray":[],"emptyObject":{},"nullValue":null,"nested":[[1,2],[3,4]],"escaped":"line1\\nline2\\ttab \\"quoted\\""}',
} as const;
export type SampleKey = keyof typeof SAMPLES;

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

/** Re-exported so existing importers of this module are unaffected by the move to json-parse.ts. */
export function parseJson(input: string): { ok: true; value: unknown } | JsonError {
  return parseJsonShared(input, 'Input is empty.');
}

const TOO_DEEP: JsonError = { ok: false, error: 'The document is nested too deeply to format (several thousand levels).' };

/**
 * JSON.parse copes with absurd nesting, but JSON.stringify and sortDeep are
 * recursive and overflow the stack somewhere past a few thousand levels. Turn
 * that into an ordinary error instead of an exception that kills the page.
 */
function serialise(value: unknown, sortKeys: boolean, indent: string | number | undefined): JsonResult {
  try {
    const v = sortKeys ? sortDeep(value) : value;
    return { ok: true, output: JSON.stringify(v, null, indent), kind: kindOf(v) };
  } catch (e) {
    if (e instanceof RangeError) return TOO_DEEP;
    throw e;
  }
}

export function formatJson(input: string, opts: Partial<FormatOptions> = {}): JsonResult {
  const o = { ...DEFAULT_FORMAT, ...opts };
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return serialise(parsed.value, o.sortKeys, o.indent === 'tab' ? '\t' : o.indent);
}

export function minifyJson(input: string, opts: Partial<Pick<FormatOptions, 'sortKeys'>> = {}): JsonResult {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return serialise(parsed.value, Boolean(opts.sortKeys), undefined);
}
