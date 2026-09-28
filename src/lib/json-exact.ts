/**
 * A JSON reader that keeps every number exactly as written. Pure, no DOM.
 *
 * JSON.parse turns 9007199254740993 into 9007199254740992 (a JavaScript number has 53 bits of
 * precision), which is wrong for an ID that is about to be written into a database. This reader
 * returns numbers as their source text instead. It only runs on text JSON.parse has already
 * accepted (parseJson in json-parse.ts reports errors with a line and column first), so it does
 * not re-validate, and it hands each string literal to JSON.parse to decode its escapes.
 */

export type JsonValue =
  | { t: 'string'; v: string }
  | { t: 'number'; v: string }
  | { t: 'boolean'; v: boolean }
  | { t: 'null' }
  | { t: 'array'; v: JsonValue[] }
  | { t: 'object'; v: Map<string, JsonValue> };

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Parse JSON that JSON.parse already accepted. A repeated key keeps its first position and its
 *  last value, as JSON.parse does. */
export function parseExact(text: string): JsonValue {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      i++;
    }
  };
  const readString = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  // Iterative over containers (an explicit stack), so deep nesting cannot overflow the call stack.
  type Frame = { kind: 'array'; items: JsonValue[] } | { kind: 'object'; map: Map<string, JsonValue>; key: string };
  const stack: Frame[] = [];
  let result: JsonValue | undefined;
  const emit = (v: JsonValue) => {
    const top = stack[stack.length - 1];
    if (!top) result = v;
    else if (top.kind === 'array') top.items.push(v);
    else top.map.set(top.key, v);
  };
  while (true) {
    skipWs();
    const top = stack[stack.length - 1];
    const c = text[i];
    if (top && (c === ',' || c === ']' || c === '}')) {
      i++;
      if (c === ',') {
        if (top.kind === 'object') {
          skipWs();
          top.key = readString();
          skipWs();
          i++; // :
        }
        continue;
      }
      stack.pop();
      emit(top.kind === 'array' ? { t: 'array', v: top.items } : { t: 'object', v: top.map });
      if (!stack.length) break;
      continue;
    }
    if (c === '[') {
      i++;
      stack.push({ kind: 'array', items: [] });
      continue;
    }
    if (c === '{') {
      i++;
      skipWs();
      const frame: Frame = { kind: 'object', map: new Map(), key: '' };
      stack.push(frame);
      if (text[i] === '"') {
        frame.key = readString();
        skipWs();
        i++; // :
      }
      continue;
    }
    if (c === '"') emit({ t: 'string', v: readString() });
    else if (c === 't') { i += 4; emit({ t: 'boolean', v: true }); }
    else if (c === 'f') { i += 5; emit({ t: 'boolean', v: false }); }
    else if (c === 'n') { i += 4; emit({ t: 'null' }); }
    else {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text)!;
      i += m[0].length;
      emit({ t: 'number', v: m[0] });
    }
    if (!stack.length) break;
  }
  return result!;
}

/** Compact JSON text for a value, numbers exactly as they were written. */
export function stringifyExact(value: JsonValue): string {
  switch (value.t) {
    case 'string':
      return JSON.stringify(value.v);
    case 'number':
      return value.v;
    case 'boolean':
      return String(value.v);
    case 'null':
      return 'null';
    case 'array':
      return `[${value.v.map(stringifyExact).join(',')}]`;
    case 'object':
      return `{${[...value.v].map(([k, v]) => `${JSON.stringify(k)}:${stringifyExact(v)}`).join(',')}}`;
  }
}
