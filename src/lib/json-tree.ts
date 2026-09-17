/**
 * Renders a parsed JSON value as nested, collapsible <details> HTML for the JSON Formatter's
 * tree view (JSON-002). Pure, no DOM — returns an HTML string the client script assigns via
 * innerHTML. Every node carries a JSONPath-style `data-path` attribute ($ for the root,
 * $.key / $[index] for children) so JSON-003 (copy JSONPath on click) can reuse it without
 * touching this module again.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A bare key that doesn't need bracket-quoting in a JSONPath, e.g. `$.name` not `$["a b"]`. */
const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function childPath(parentPath: string, key: string, isArray: boolean): string {
  if (isArray) return `${parentPath}[${key}]`;
  return SIMPLE_KEY.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
}

function renderPrimitive(v: unknown): string {
  if (v === null) return '<span class="jt-null">null</span>';
  if (typeof v === 'string') return `<span class="jt-string">"${escapeHtml(v)}"</span>`;
  if (typeof v === 'number') return `<span class="jt-number">${v}</span>`;
  if (typeof v === 'boolean') return `<span class="jt-boolean">${v}</span>`;
  return '';
}

function renderNode(key: string | null, value: unknown, path: string): string {
  const keyLabel = key !== null ? `<span class="jt-key">"${escapeHtml(key)}"</span><span class="jt-colon">: </span>` : '';
  const isContainer = value !== null && typeof value === 'object';

  if (!isContainer) {
    return `<div class="jt-leaf" data-path="${escapeHtml(path)}">${keyLabel}${renderPrimitive(value)}</div>`;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const count = entries.length;
  const summary = isArray ? `[${count} item${count === 1 ? '' : 's'}]` : `{${count} key${count === 1 ? '' : 's'}}`;

  if (count === 0) {
    return `<div class="jt-leaf" data-path="${escapeHtml(path)}">${keyLabel}<span class="jt-punct">${isArray ? '[]' : '{}'}</span></div>`;
  }

  const children = entries
    .map(([k, v]) => renderNode(k, v, childPath(path, k, isArray)))
    .join('');
  return (
    `<details class="jt-node" open data-path="${escapeHtml(path)}">` +
    `<summary>${keyLabel}<span class="jt-punct">${summary}</span></summary>` +
    `<div class="jt-children">${children}</div>` +
    `</details>`
  );
}

/** `value` is whatever JSON.parse returned — including a bare primitive at the root. */
export function renderJsonTree(value: unknown): string {
  return renderNode(null, value, '$');
}
