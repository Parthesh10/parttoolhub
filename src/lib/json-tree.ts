/**
 * Renders a parsed JSON value as nested, collapsible <details> HTML for the JSON Formatter's
 * tree view (JSON-002). Pure, no DOM — returns an HTML string the client script assigns via
 * innerHTML. Every node carries a JSONPath-style `data-path` attribute ($ for the root,
 * $.key / $[index] for children).
 *
 * JSON-003 (copy JSONPath on click): scoped to leaf nodes only, not container-node <summary>
 * lines — nesting a focusable copy control inside a <summary> (already an interactive element,
 * toggling expand/collapse on click) means nested interactive content, which is both invalid
 * HTML and a real keyboard-navigation trap. A leaf div has no such conflict, so it's the click
 * target itself (role="button", tabindex, aria-label) rather than needing a separate control.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A bare key that doesn't need bracket-quoting in a JSONPath, e.g. `$.name` not `$["a b"]`. */
const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * SEO-002's Core Web Vitals audit found a real perf cliff here: a 2000-item array (a realistic
 * "large API response" paste) fully expanded produced 92,010 DOM elements and two 685ms-long
 * blocking tasks switching into tree view — every element goes into the innerHTML string
 * regardless of a <details>'s open/closed state, so collapsing nodes by default doesn't help;
 * only rendering fewer of them does. Capping how many array items get a full subtree, with a
 * plain (non-interactive) "N more items" leaf for the rest, bounds the worst case without losing
 * the feature for realistically-sized JSON.
 */
const MAX_ARRAY_ITEMS = 200;

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
    return `<div class="jt-leaf" data-path="${escapeHtml(path)}" role="button" tabindex="0" aria-label="Copy JSONPath ${escapeHtml(path)}">${keyLabel}${renderPrimitive(value)}</div>`;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const count = entries.length;
  const summary = isArray ? `[${count} item${count === 1 ? '' : 's'}]` : `{${count} key${count === 1 ? '' : 's'}}`;

  if (count === 0) {
    return `<div class="jt-leaf" data-path="${escapeHtml(path)}" role="button" tabindex="0" aria-label="Copy JSONPath ${escapeHtml(path)}">${keyLabel}<span class="jt-punct">${isArray ? '[]' : '{}'}</span></div>`;
  }

  const truncated = isArray && entries.length > MAX_ARRAY_ITEMS;
  const shown = truncated ? entries.slice(0, MAX_ARRAY_ITEMS) : entries;
  const children = shown
    .map(([k, v]) => renderNode(k, v, childPath(path, k, isArray)))
    .join('');
  const truncationNotice = truncated
    ? `<div class="jt-truncated">… ${entries.length - MAX_ARRAY_ITEMS} more item${entries.length - MAX_ARRAY_ITEMS === 1 ? '' : 's'} not shown (use Text view to see the rest)</div>`
    : '';
  return (
    `<details class="jt-node" open data-path="${escapeHtml(path)}">` +
    `<summary>${keyLabel}<span class="jt-punct">${summary}</span></summary>` +
    `<div class="jt-children">${children}${truncationNotice}</div>` +
    `</details>`
  );
}

/** `value` is whatever JSON.parse returned — including a bare primitive at the root. */
export function renderJsonTree(value: unknown): string {
  return renderNode(null, value, '$');
}
