/**
 * HTML → Markdown (GFM). Pure, no DOM: a small tolerant HTML parser plus a
 * converter that reads *inline styles* as well as tags, because the HTML that
 * Google Docs, Word and most rich editors put on the clipboard says bold with
 * <span style="font-weight:700">, code with a Courier New font-family, and a
 * link with a google.com/url?q= redirect. Semantic HTML (<strong>, <code>,
 * <a href>) is handled the same way, so web-page source converts too.
 */

// ---- Minimal HTML tree -----------------------------------------------------------

export interface Element {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
}
export interface Text {
  type: 'text';
  text: string;
}
export type HNode = Element | Text;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'iframe', 'object', 'canvas']);
/** Opening one of these implicitly closes an open element of the listed kinds. */
const AUTO_CLOSE: Record<string, string[]> = {
  p: ['p'],
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option'],
  h1: ['p'], h2: ['p'], h3: ['p'], h4: ['p'], h5: ['p'], h6: ['p'],
  ul: ['p'], ol: ['p'], pre: ['p'], table: ['p'], blockquote: ['p'], div: ['p'], hr: ['p'],
};

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', times: '×', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * Parse HTML into a tree. Tolerant on purpose: unknown tags are kept, unclosed
 * tags are closed by their parent, stray closing tags are ignored, <p>/<li>/<td>
 * auto-close as browsers do, and script/style/svg contents are dropped.
 */
export function parseHtml(html: string): HNode[] {
  const root: Element = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      // Closing tag: pop to the matching open element, if any.
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2] !== undefined) {
      const tag = m[2].toLowerCase();
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
        attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      }
      if (RAW_TEXT.has(tag)) {
        // Skip to the closing tag; nothing inside is content.
        const close = new RegExp(`</${tag}\\s*>`, 'ig');
        close.lastIndex = re.lastIndex;
        const c = close.exec(html);
        re.lastIndex = c ? c.index + c[0].length : html.length;
        continue;
      }
      const closes = AUTO_CLOSE[tag];
      if (closes) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (closes.includes(stack[i].tag)) { stack.length = i; break; }
          // A <p> closes only within its own block; stop at a container.
          if (['td', 'th', 'li', 'blockquote', 'div', 'section', 'article', 'body', 'table'].includes(stack[i].tag) && tag === 'p') break;
          if (['ul', 'ol', 'table', 'tbody', 'thead'].includes(stack[i].tag)) break;
        }
      }
      const el: Element = { type: 'element', tag, attrs, children: [] };
      top().children.push(el);
      if (!VOID.has(tag) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] !== undefined) {
      const text = decodeEntities(m[5]);
      const parent = top();
      const last = parent.children[parent.children.length - 1];
      if (last && last.type === 'text') last.text += text;
      else parent.children.push({ type: 'text', text });
    }
  }
  return root.children;
}

// ---- Style reading ---------------------------------------------------------------

export function parseStyle(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

interface Fmt { bold: boolean; italic: boolean; strike: boolean; code: boolean; pre: boolean }

/** What an element adds to (or removes from) the inline formatting of its children. */
function formatOf(el: Element, inherited: Fmt): Fmt {
  const st = parseStyle(el.attrs.style);
  const f = { ...inherited };
  const tag = el.tag;
  if (tag === 'b' || tag === 'strong') f.bold = true;
  if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'var') f.italic = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') f.strike = true;
  if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') f.code = true;
  if (tag === 'pre') f.pre = true;
  // Inline styles override the tag: Google Docs wraps every copy in <b style="font-weight:normal">.
  const fw = st['font-weight'];
  if (fw) f.bold = fw === 'bold' || fw === 'bolder' || (/^\d+$/.test(fw) && Number(fw) >= 600);
  const fs = st['font-style'];
  if (fs) f.italic = fs === 'italic' || fs === 'oblique';
  const td = st['text-decoration'] ?? st['text-decoration-line'];
  if (td) f.strike = td.includes('line-through') || (inherited.strike && !td.includes('none'));
  const ff = st['font-family'];
  if (ff) f.code = /courier|consolas|menlo|monaco|monospace|source code|fira code|roboto mono|ubuntu mono/.test(ff);
  const ws = st['white-space'];
  if (ws) f.pre = ws.startsWith('pre') && ws !== 'pre-line';
  return f;
}

// ---- Inline runs -----------------------------------------------------------------

interface Run extends Fmt {
  kind: 'text' | 'br' | 'image';
  text: string;
  href: string | null;
  src?: string;
  alt?: string;
}

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul', 'body', 'html', 'caption', 'center']);

// Not a type predicate: a false result must leave `n` as "any node", since inline elements are elements too.
const isBlock = (n: HNode): boolean => n.type === 'element' && BLOCK_TAGS.has(n.tag);
function hasBlockChild(el: Element): boolean {
  return el.children.some((c) => c.type === 'element' && (BLOCK_TAGS.has(c.tag) || (c.tag !== 'a' && hasBlockChild(c))));
}

/** Google Docs wraps every link in a redirect: https://www.google.com/url?q=<real>&sa=D&… */
export function unwrapRedirect(href: string): { href: string; unwrapped: boolean } {
  const m = href.match(/^https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?(.*)$/i);
  if (!m) return { href, unwrapped: false };
  const q = new URLSearchParams(m[1]).get('q');
  return q ? { href: q, unwrapped: true } : { href, unwrapped: false };
}

interface Ctx {
  notes: Set<string>;
  stats: Stats;
  bullet: '-' | '*';
}

export interface Stats {
  headings: number;
  paragraphs: number;
  lists: number;
  tables: number;
  links: number;
  images: number;
  codeBlocks: number;
  words: number;
}

function collectRuns(nodes: HNode[], fmt: Fmt, href: string | null, ctx: Ctx, out: Run[]): void {
  for (const n of nodes) {
    if (n.type === 'text') {
      out.push({ kind: 'text', text: n.text, href, ...fmt });
      continue;
    }
    const el = n;
    if (el.tag === 'br') { out.push({ kind: 'br', text: '', href, ...fmt }); continue; }
    if (el.tag === 'img') {
      const src = el.attrs.src ?? '';
      if (!src) { ctx.notes.add('An image had no address and was dropped.'); continue; }
      ctx.stats.images++;
      out.push({ kind: 'image', text: '', href, src, alt: (el.attrs.alt ?? '').trim(), ...fmt });
      continue;
    }
    if (el.tag === 'input') continue; // checkboxes are read by the list converter; other inputs have no text
    if (el.tag === 'sup' || el.tag === 'sub') { collectRuns(el.children, fmt, href, ctx, out); continue; }
    if (el.tag === 'u' || parseStyle(el.attrs.style)['text-decoration']?.includes('underline')) {
      if (!href && el.tag === 'u') ctx.notes.add('Underline has no Markdown equivalent; underlined text is kept as plain text.');
    }
    let link = href;
    if (el.tag === 'a' && el.attrs.href) {
      const raw = el.attrs.href.trim();
      if (/^\s*(javascript|data|vbscript):/i.test(raw)) {
        ctx.notes.add('A link with a javascript: or data: address was dropped; its text was kept.');
      } else {
        const u = unwrapRedirect(raw);
        if (u.unwrapped) ctx.notes.add('Google Docs redirect links were unwrapped to their real addresses.');
        link = u.href;
        ctx.stats.links++;
      }
    }
    collectRuns(el.children, formatOf(el, fmt), link, ctx, out);
  }
}

// ---- Markdown escaping ---------------------------------------------------------------

/** Escape characters that would otherwise be read as Markdown. Not applied inside code. */
export function escapeInline(s: string): string {
  return s
    .replace(/[\\`*[\]]/g, (c) => `\\${c}`)
    .replace(/(^|[^\w])_|_(?=$|[^\w])/g, (m) => m.replace('_', '\\_'))
    .replace(/~~/g, '\\~\\~')
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<');
}

/** Escape a line start that would begin a heading, quote, list item, rule or table. */
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+*](?=\s|$)|\d{1,9}[.)](?=\s|$)|\||([-*_=])(?:\s*\2){2,}\s*$)/, (m, ws: string, tok: string) => {
    // "1. " becomes "1\." — the backslash goes before the punctuation, not the digit.
    const d = tok.match(/^(\d{1,9})([.)])$/);
    return d ? `${ws}${d[1]}\\${d[2]}` : `${ws}\\${tok}`;
  });
}

/** Collapse HTML whitespace as a browser would in normal flow. */
const collapse = (s: string) => s.replace(/[ \t\r\n\f]+/g, ' ');

/** Turn a paragraph's runs into one Markdown string (may contain "  \n" hard breaks). */
function runsToMarkdown(runs: Run[], ctx: Ctx, opts: { table?: boolean } = {}): string {
  // 1. Collapse whitespace in normal runs; drop empties; merge runs with identical formatting.
  const merged: Run[] = [];
  for (const r of runs) {
    let run = r;
    if (run.kind === 'text') {
      const text = run.pre ? run.text : collapse(run.text.replace(/ /g, ' '));
      if (!text) continue;
      run = { ...run, text };
    }
    const last = merged[merged.length - 1];
    if (last && run.kind === 'text' && last.kind === 'text' && last.bold === run.bold && last.italic === run.italic && last.strike === run.strike && last.code === run.code && last.pre === run.pre && last.href === run.href) {
      last.text += run.text;
    } else merged.push({ ...run });
  }
  if (!merged.length) return '';

  // 2. Serialize. Links group consecutive runs with the same href.
  const wrapMarks = (inner: string, r: Run): string => {
    if (!inner.trim()) return inner;
    const lead = inner.match(/^\s*/)![0];
    const trail = inner.match(/\s*$/)![0];
    let core = inner.trim();
    if (r.code) {
      // A code span needs a backtick run longer than any inside it.
      const longest = Math.max(0, ...[...core.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(longest + 1);
      const pad = core.startsWith('`') || core.endsWith('`') ? ' ' : '';
      core = `${fence}${pad}${core}${pad}${fence}`;
    } else {
      if (r.strike) core = `~~${core}~~`;
      if (r.italic) core = `*${core}*`;
      if (r.bold) core = `**${core}**`;
    }
    return `${lead}${core}${trail}`;
  };
  const one = (r: Run): string => {
    if (r.kind === 'br') return opts.table ? ' ' : '  \n';
    if (r.kind === 'image') return `![${(r.alt ?? '').replace(/[[\]]/g, '')}](${r.src})`;
    const text = r.code ? r.text : escapeInline(r.text);
    return wrapMarks(text, r);
  };
  let out = '';
  for (let i = 0; i < merged.length; ) {
    const r = merged[i];
    if (r.href) {
      let j = i;
      let inner = '';
      while (j < merged.length && merged[j].href === r.href && merged[j].kind !== 'br') inner += one(merged[j++]);
      const lead = inner.match(/^\s*/)![0];
      const trail = inner.match(/\s*$/)![0];
      const label = inner.trim();
      out += label ? `${lead}[${label}](${r.href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})${trail}` : inner;
      i = j;
    } else {
      out += one(r);
      i++;
    }
  }
  // 3. Line-start escapes, then tidy whitespace at the edges and around hard breaks.
  const lines = out.split('  \n').map((l) => escapeLineStart(l.replace(/^ +| +$/g, '')));
  return lines.join('  \n').trim();
}

// ---- Blocks ------------------------------------------------------------------------------

function findFirst(el: Element, pred: (e: Element) => boolean): Element | null {
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    if (pred(c)) return c;
    const inner = findFirst(c, pred);
    if (inner) return inner;
  }
  return null;
}

function textOf(nodes: HNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : n.tag === 'br' ? '\n' : textOf(n.children))).join('');
}

/** Language hint from class="language-js" / "lang-js" / highlight-source-js, on <pre> or its <code>. */
function codeLang(el: Element): string {
  const cls = [el.attrs.class ?? '', ...el.children.filter((c): c is Element => c.type === 'element').map((c) => c.attrs.class ?? '')].join(' ');
  return cls.match(/(?:language|lang|highlight-source|brush)[-:]\s*([\w+#-]+)/)?.[1] ?? '';
}

function convertBlocks(nodes: HNode[], ctx: Ctx, depth = 0): string[] {
  const out: string[] = [];
  let inline: Run[] = [];
  const flushInline = () => {
    if (!inline.length) return;
    const md = runsToMarkdown(inline, ctx);
    inline = [];
    if (md) { out.push(md); ctx.stats.paragraphs++; }
  };
  const inlineFmt: Fmt = { bold: false, italic: false, strike: false, code: false, pre: false };
  let lastWordList = false;

  for (const n of nodes) {
    if (isBlock(n) && !((n as Element).tag === 'p' && /MsoList/i.test((n as Element).attrs.class ?? ''))) lastWordList = false;
    if (!isBlock(n)) {
      // Inline node — or a non-block element (span, font, a…) that happens to contain blocks.
      if (n.type === 'element' && hasBlockChild(n)) {
        flushInline();
        out.push(...convertBlocks(n.children, ctx, depth));
      } else {
        collectRuns([n], inlineFmt, null, ctx, inline);
      }
      continue;
    }
    flushInline();
    const el = n as Element;
    const tag = el.tag;
    const st = parseStyle(el.attrs.style);

    if (/^h[1-6]$/.test(tag)) {
      const runs: Run[] = [];
      collectRuns(el.children, inlineFmt, null, ctx, runs);
      const text = runsToMarkdown(runs, ctx).replace(/\s*\n\s*/g, ' ');
      if (text) { out.push(`${'#'.repeat(Number(tag[1]))} ${text}`); ctx.stats.headings++; }
      continue;
    }
    if (tag === 'hr') { out.push('---'); continue; }
    if (tag === 'pre') {
      const raw = textOf(el.children).replace(/^\n/, '').replace(/\n$/, '');
      const longest = Math.max(2, ...[...raw.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(longest + 1);
      out.push(`${fence}${codeLang(el)}\n${raw}\n${fence}`);
      ctx.stats.codeBlocks++;
      continue;
    }
    if (tag === 'blockquote') {
      const inner = convertBlocks(el.children, ctx, depth).join('\n\n');
      if (inner) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      out.push(convertList(el, ctx, depth));
      continue;
    }
    if (tag === 'table') {
      const t = convertTable(el, ctx);
      if (t) out.push(t);
      continue;
    }
    if (tag === 'p' && (st['font-family'] || st['white-space']) && /courier|monospace|consolas|menlo/.test(st['font-family'] ?? '')) {
      // A monospace paragraph (Word/Docs "code" style) reads better as a code block.
      const raw = textOf(el.children).trim();
      if (raw) { out.push(`\`\`\`\n${raw}\n\`\`\``); ctx.stats.codeBlocks++; }
      continue;
    }
    // Word's list paragraphs: <p class="MsoListParagraph"> with a bullet/number glyph in a mso-list:Ignore span.
    if (tag === 'p' && /MsoList/i.test(el.attrs.class ?? '')) {
      const runs: Run[] = [];
      collectRuns(el.children.filter((c) => !(c.type === 'element' && /mso-list:\s*ignore/i.test(c.attrs.style ?? ''))), inlineFmt, null, ctx, runs);
      const glyph = textOf(el.children).trim().match(/^([•·o§▪‑-]|\d+[.)]|[a-z][.)])\s*/i)?.[1] ?? '';
      const text = runsToMarkdown(runs, ctx).replace(/^([•·o§▪]|\d+[.)]|[a-z][.)])\s+/i, '');
      const level = Math.max(0, Math.round(parseFloat(st['margin-left'] ?? '0') / 36) - 1);
      const marker = /^\d/.test(glyph) ? glyph.replace(')', '.') : ctx.bullet;
      if (text) {
        const lineOut = `${'  '.repeat(level)}${marker} ${text}`;
        if (lastWordList && out.length) out[out.length - 1] += `\n${lineOut}`;
        else out.push(lineOut);
        lastWordList = true;
        ctx.notes.add('Word list paragraphs were converted by their bullet glyph and indent; check the nesting.');
      }
      continue;
    }
    // Any other block container: paragraphs, divs, sections, cells…
    const inner = convertBlocks(el.children, ctx, depth);
    out.push(...inner);
  }
  flushInline();
  return out;
}

function convertList(list: Element, ctx: Ctx, depth: number): string {
  ctx.stats.lists++;
  const ordered = list.tag === 'ol';
  let num = Number(list.attrs.start ?? '1') || 1;
  const lines: string[] = [];
  // Google Docs nests by putting a <ul>/<ol> directly inside a list as a sibling of <li>,
  // and by aria-level on items; both are folded into the previous item.
  const items: { el: Element; nested: Element[] }[] = [];
  for (const c of list.children) {
    if (c.type !== 'element') continue;
    if (c.tag === 'li') items.push({ el: c, nested: [] });
    else if ((c.tag === 'ul' || c.tag === 'ol') && items.length) items[items.length - 1].nested.push(c);
    else if (c.tag === 'ul' || c.tag === 'ol') items.push({ el: { type: 'element', tag: 'li', attrs: {}, children: [] }, nested: [c] });
  }
  const baseLevel = Number(items[0]?.el.attrs['aria-level'] ?? '1') || 1;
  for (const { el, nested } of items) {
    const marker = ordered ? `${num++}.` : ctx.bullet;
    const indentExtra = Math.max(0, (Number(el.attrs['aria-level'] ?? baseLevel) || baseLevel) - baseLevel);
    const pad = ' '.repeat(marker.length + 1);
    // Task list: a checkbox <input> or a Docs/GitHub checkbox glyph at the start.
    let checkbox = '';
    const first = textOf(el.children).trimStart();
    const box = findFirst(el, (e) => e.tag === 'input' && (e.attrs.type ?? '').toLowerCase() === 'checkbox');
    if (box) checkbox = 'checked' in box.attrs ? '[x] ' : '[ ] ';
    else if (/^[☐☑☒✓✔]/.test(first)) checkbox = /^[☑☒✓✔]/.test(first) ? '[x] ' : '[ ] ';
    // One <p> (or bare text) plus nested lists is a tight item; several <p>s make it loose.
    const paragraphs = el.children.filter((c) => c.type === 'element' && c.tag === 'p').length;
    let body = convertBlocks(el.children, ctx, depth + 1).join(paragraphs > 1 ? '\n\n' : '\n');
    if (checkbox) body = body.replace(/^\\?[☐☑☒✓✔]\s*/, '');
    for (const sub of nested) body += (body ? '\n' : '') + convertList(sub, ctx, depth + 1);
    const [firstLine = '', ...rest] = body.split('\n');
    const extra = '  '.repeat(indentExtra);
    lines.push(`${extra}${marker} ${checkbox}${firstLine}`.replace(/\s+$/, ''));
    for (const r of rest) lines.push(r ? `${extra}${pad}${r}` : '');
  }
  return lines.join('\n');
}

function convertTable(table: Element, ctx: Ctx): string {
  const rows: { cells: Element[]; header: boolean }[] = [];
  const walk = (nodes: HNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      if (n.tag === 'tr') {
        const cells = n.children.filter((c): c is Element => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
        if (cells.length) rows.push({ cells, header: cells.every((c) => c.tag === 'th') });
      } else if (['thead', 'tbody', 'tfoot'].includes(n.tag)) walk(n.children);
    }
  };
  walk(table.children);
  if (!rows.length) return '';
  ctx.stats.tables++;
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const cellText = (c: Element) => {
    const runs: Run[] = [];
    collectRuns(c.children, { bold: false, italic: false, strike: false, code: false, pre: false }, null, ctx, runs);
    // Block children inside a cell (Docs wraps cell text in <p>) flatten to one line.
    const md = runsToMarkdown(runs, ctx, { table: true }) || convertBlocks(c.children, ctx).join(' ');
    return md.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
  };
  const align = (c: Element | undefined): string => {
    const a = (c?.attrs.align ?? parseStyle(c?.attrs.style)['text-align'] ?? '').toLowerCase();
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
  };
  const header = rows[0];
  if (!header.header) ctx.notes.add('The table had no header row, so its first row became the header (Markdown tables need one).');
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const fill = (r: { cells: Element[] }) => Array.from({ length: cols }, (_, i) => (r.cells[i] ? cellText(r.cells[i]) : ''));
  // A header row is already bold in Markdown; Docs and Word bold it by hand, so drop whole-cell bold there.
  const headCells = fill(header).map((c) => c.replace(/^\*\*(.+)\*\*$/, '$1'));
  const out = [line(headCells), line(Array.from({ length: cols }, (_, i) => align(header.cells[i])))];
  for (const r of rows.slice(1)) out.push(line(fill(r)));
  return out.join('\n');
}

// ---- Public API ----------------------------------------------------------------------------

export interface ConvertOptions {
  /** Marker for unordered lists. */
  bullet: '-' | '*';
}

export interface ConvertResult {
  markdown: string;
  stats: Stats;
  /** Things worth telling the person: what was unwrapped, dropped or approximated. */
  notes: string[];
  /** True when the input had no HTML tags at all. */
  plain: boolean;
}

export function htmlToMarkdown(html: string, opts: Partial<ConvertOptions> = {}): ConvertResult {
  const ctx: Ctx = {
    notes: new Set(),
    stats: { headings: 0, paragraphs: 0, lists: 0, tables: 0, links: 0, images: 0, codeBlocks: 0, words: 0 },
    bullet: opts.bullet ?? '-',
  };
  const plain = !/<[a-zA-Z!/]/.test(html);
  const tree = parseHtml(html);
  const blocks = convertBlocks(tree, ctx);
  const markdown = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  ctx.stats.words = markdown.split(/\s+/).filter(Boolean).length;
  return { markdown, stats: ctx.stats, notes: [...ctx.notes], plain };
}

// ---- Shared samples ----------------------------------------------------------------------------

/**
 * What Google Docs puts on the clipboard (Chrome) for a short document: a <b>
 * wrapper with font-weight:normal, every run in a styled <span>, links wrapped
 * in a google.com/url redirect, nested lists as a <ul> inside a <ul> with
 * aria-level. Trimmed of the longest style declarations but structurally exact.
 */
export const SAMPLE_DOCS_HTML = `<meta charset='utf-8'><b style="font-weight:normal;" id="docs-internal-guid-1f3a2b8c-7fff-9d1e-4c2a-0a1b2c3d4e5f"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">Q3 launch plan</span></h1><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">We ship on </span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;white-space:pre-wrap;">14 October</span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">. The </span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;font-style:italic;white-space:pre-wrap;">only</span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;"> blocker is the </span><span style="font-size:11pt;font-family:'Courier New',monospace;font-weight:400;white-space:pre-wrap;">billing-v2</span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;"> flag, see the </span><a href="https://www.google.com/url?q=https://example.com/wiki/billing-v2&amp;sa=D&amp;source=editors&amp;ust=1760000000000000&amp;usg=AOvVaw0abc123" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;font-weight:400;text-decoration:underline;white-space:pre-wrap;">rollout page</span></a><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">.</span></p><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;white-space:pre-wrap;"></span></p><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">Checklist</span></h2><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">Freeze the release branch</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">Notify </span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;white-space:pre-wrap;">#eng-release</span></p></li></ul><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">Run the migration on staging</span></p></li></ul><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;white-space:pre-wrap;"></span></p><div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="180"/><col width="120"/></colgroup><tbody><tr style="height:0pt"><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;white-space:pre-wrap;">Owner</span></p></td><td style="border:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;white-space:pre-wrap;">Status</span></p></td></tr><tr style="height:0pt"><td style="border:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">Priya</span></p></td><td style="border:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;white-space:pre-wrap;">On track</span></p></td></tr></tbody></table></div></b>`;

/** A clean, semantic HTML fragment — what a web page or a CMS gives you. */
export const SAMPLE_HTML = `<article>
  <h2>Release notes: v2.4.0</h2>
  <p>This release adds <strong>scheduled exports</strong> and fixes the <em>timezone</em> bug in <code>report.py</code>. Full details on the <a href="https://example.com/changelog">changelog</a>.</p>
  <h3>Added</h3>
  <ul>
    <li>Scheduled exports
      <ul>
        <li>Daily, weekly or monthly</li>
        <li>CSV and JSON formats</li>
      </ul>
    </li>
    <li>Dark mode for the dashboard</li>
  </ul>
  <h3>Upgrade</h3>
  <ol>
    <li>Back up the database</li>
    <li>Run <code>pip install -U reporter</code></li>
  </ol>
  <blockquote><p>Exports created before 2.4 keep their old schedule.</p></blockquote>
  <pre><code class="language-bash">reporter export --format csv --schedule weekly</code></pre>
  <table>
    <thead><tr><th>Setting</th><th>Default</th></tr></thead>
    <tbody>
      <tr><td><code>format</code></td><td>csv</td></tr>
      <tr><td><code>schedule</code></td><td>none</td></tr>
    </tbody>
  </table>
  <p><img src="https://example.com/dashboard.png" alt="Dashboard in dark mode"></p>
</article>`;
