/**
 * Structural (semantic) JSON diff: compares by key path, not by text position, so reordered keys
 * or re-indented whitespace never show as a false change — the exact complaint a plain text diff
 * of two JSON blobs runs into. Arrays are compared with the same Myers diff used for text (by deep
 * equality of elements), so inserting one item in the middle of a list reports one addition, not a
 * cascade of "changed" entries for every element after it — verified against that exact case
 * (`[1,2,3]` → `[1,99,2,3]` reports only `$.list[1]` added) before being trusted. Reuses
 * json-parse.ts so parse errors read the same as every other JSON-consuming tool on the site.
 */
import { parseJson, type JsonParseError } from './json-parse';
import { diffArrays } from './diff-core';

export type JsonChange =
  | { type: 'added'; path: string; value: unknown }
  | { type: 'removed'; path: string; value: unknown }
  | { type: 'changed'; path: string; oldValue: unknown; newValue: unknown };

export interface JsonDiffStats {
  added: number;
  removed: number;
  changed: number;
  identical: boolean;
}

export interface JsonDiffValue {
  changes: JsonChange[];
  stats: JsonDiffStats;
  oldPretty: string;
  newPretty: string;
}

export type JsonDiffSide = 'old' | 'new';
export type JsonDiffResult = { ok: true; value: JsonDiffValue } | ({ ok: false; side: JsonDiffSide } & Omit<JsonParseError, 'ok'>);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => deepEqual(v, bArr[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  return aKeys.length === bKeys.length && aKeys.every((k) => Object.prototype.hasOwnProperty.call(bObj, k) && deepEqual(aObj[k], bObj[k]));
}

const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function childPath(parent: string, key: string, isArrayIndex: boolean): string {
  if (isArrayIndex) return `${parent}[${key}]`;
  return SIMPLE_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function walk(oldVal: unknown, newVal: unknown, path: string, out: JsonChange[]): void {
  if (deepEqual(oldVal, newVal)) return;

  if (isPlainObject(oldVal) && isPlainObject(newVal)) {
    const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    for (const k of keys) {
      const p = childPath(path, k, false);
      const inOld = Object.prototype.hasOwnProperty.call(oldVal, k);
      const inNew = Object.prototype.hasOwnProperty.call(newVal, k);
      if (!inOld) out.push({ type: 'added', path: p, value: newVal[k] });
      else if (!inNew) out.push({ type: 'removed', path: p, value: oldVal[k] });
      else walk(oldVal[k], newVal[k], p, out);
    }
    return;
  }

  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    const ops = diffArrays(oldVal, newVal, deepEqual);
    let ai = 0;
    let bi = 0;
    for (const op of ops) {
      if (op.type === 'equal') {
        ai++;
        bi++;
        continue;
      }
      if (op.type === 'delete') {
        out.push({ type: 'removed', path: childPath(path, String(ai), true), value: oldVal[ai] });
        ai++;
      } else {
        out.push({ type: 'added', path: childPath(path, String(bi), true), value: newVal[bi] });
        bi++;
      }
    }
    return;
  }

  out.push({ type: 'changed', path, oldValue: oldVal, newValue: newVal });
}

const TOO_DEEP_ERROR = 'The document is nested too deeply to compare (several thousand levels).';

export function diffJson(oldText: string, newText: string): JsonDiffResult {
  const oldParsed = parseJson(oldText, 'Paste the original JSON.');
  if (!oldParsed.ok) return { ok: false, side: 'old', error: oldParsed.error, line: oldParsed.line, column: oldParsed.column, snippet: oldParsed.snippet };
  const newParsed = parseJson(newText, 'Paste the changed JSON.');
  if (!newParsed.ok) return { ok: false, side: 'new', error: newParsed.error, line: newParsed.line, column: newParsed.column, snippet: newParsed.snippet };

  const changes: JsonChange[] = [];
  try {
    walk(oldParsed.value, newParsed.value, '$', changes);
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, side: 'new', error: TOO_DEEP_ERROR };
    throw e;
  }

  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const c of changes) {
    if (c.type === 'added') added++;
    else if (c.type === 'removed') removed++;
    else changed++;
  }

  return {
    ok: true,
    value: {
      changes,
      stats: { added, removed, changed, identical: changes.length === 0 },
      oldPretty: JSON.stringify(oldParsed.value, null, 2),
      newPretty: JSON.stringify(newParsed.value, null, 2),
    },
  };
}

export const SAMPLE_OLD = '{\n  "name": "Ada Lovelace",\n  "born": 1815,\n  "tags": ["mathematician"],\n  "address": {\n    "city": "London"\n  }\n}';
export const SAMPLE_NEW = '{\n  "born": 1815,\n  "name": "Ada Lovelace",\n  "tags": ["mathematician", "writer"],\n  "address": {\n    "city": "London",\n    "country": "UK"\n  },\n  "active": true\n}';
