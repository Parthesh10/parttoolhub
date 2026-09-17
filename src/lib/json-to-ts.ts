/**
 * Infers a TypeScript interface (or type alias, for a root array/primitive) from a parsed JSON
 * value. Pure, no DOM. Not a full type-inference engine — a pragmatic best-effort reading, same
 * spirit as most "paste JSON, get a TS type" tools: array-of-object elements are merged into one
 * interface (fields absent from some elements become optional, differing types become a union)
 * rather than emitting a separate interface per element or a giant union of object types.
 */

function tsPrimitiveType(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'unknown';
}

function pascalCase(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  return (
    cleaned
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('') || 'Root'
  );
}

function isValidIdentifier(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

interface GenContext {
  interfaces: string[];
  usedNames: Set<string>;
}

function uniqueName(base: string, ctx: GenContext): string {
  let name = base;
  let i = 2;
  while (ctx.usedNames.has(name)) {
    name = `${base}${i}`;
    i++;
  }
  ctx.usedNames.add(name);
  return name;
}

/** Merges N same-role objects (e.g. every element of one array) into a single interface. */
function typeForMergedObjects(objects: Record<string, unknown>[], nameHint: string, ctx: GenContext): string {
  const interfaceName = uniqueName(pascalCase(nameHint), ctx);
  const allKeys = new Set<string>();
  for (const o of objects) for (const k of Object.keys(o)) allKeys.add(k);

  const fields: string[] = [];
  for (const key of allKeys) {
    const presentIn = objects.filter((o) => Object.prototype.hasOwnProperty.call(o, key));
    const optional = presentIn.length < objects.length;
    const types = new Set<string>();
    for (const o of presentIn) types.add(typeForValue(o[key], key, ctx));
    const propName = isValidIdentifier(key) ? key : JSON.stringify(key);
    fields.push(`  ${propName}${optional ? '?' : ''}: ${[...types].join(' | ')};`);
  }
  // Emitted in dependency order: nested interfaces (added to ctx.interfaces during the loop
  // above, since typeForValue recurses before this push) come out before the interface that uses them.
  ctx.interfaces.push(fields.length ? `interface ${interfaceName} {\n${fields.join('\n')}\n}` : `interface ${interfaceName} {}`);
  return interfaceName;
}

function typeForValue(value: unknown, nameHint: string, ctx: GenContext): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    const allObjects = value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
    if (allObjects) {
      const elementType = typeForMergedObjects(value as Record<string, unknown>[], `${nameHint}Item`, ctx);
      return `${elementType}[]`;
    }
    const elementTypes = new Set(value.map((v) => typeForValue(v, nameHint, ctx)));
    return elementTypes.size === 1 ? `${[...elementTypes][0]}[]` : `(${[...elementTypes].join(' | ')})[]`;
  }
  if (value !== null && typeof value === 'object') {
    return typeForMergedObjects([value as Record<string, unknown>], nameHint, ctx);
  }
  return tsPrimitiveType(value);
}

export function jsonToTsInterface(value: unknown, rootName = 'Root'): string {
  const ctx: GenContext = { interfaces: [], usedNames: new Set() };
  if (Array.isArray(value)) {
    const elementType = typeForValue(value, rootName, ctx); // already includes the trailing []
    const body = [...ctx.interfaces, `type ${rootName} = ${elementType};`];
    return body.join('\n\n');
  }
  if (value !== null && typeof value === 'object') {
    typeForMergedObjects([value as Record<string, unknown>], rootName, ctx);
    return ctx.interfaces.join('\n\n');
  }
  return `type ${rootName} = ${tsPrimitiveType(value)};`;
}
