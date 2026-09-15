/**
 * Markdown → structure → plain text / chat markup / HTML. Pure, no DOM.
 *
 * Covers the Markdown that AI assistants and READMEs actually produce: ATX and
 * setext headings, paragraphs with hard and soft breaks, **bold**, *italic*,
 * ~~strike~~, `code`, fenced code blocks, links, images, autolinks, block
 * quotes, nested bullet/numbered/task lists, GFM tables, horizontal rules and
 * backslash escapes. Raw HTML is treated as text (and escaped on output), not
 * interpreted. No dependency: the site's rule is one small script per tool.
 */

// ---- AST ---------------------------------------------------------------------

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'br' }
  | { type: 'softbreak' };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  children: Block[];
  /** Set for GFM task items: "- [ ] todo" / "- [x] done". */
  checked?: boolean;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; loose: boolean; items: ListItem[] }
  | { type: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: 'hr' };

// ---- Shared sample -------------------------------------------------------------

/** What "Load sample" inserts on both Markdown pages and what their Example sections render. */
export const SAMPLE_MARKDOWN = `## Deploy checklist

Run the **full test suite** before tagging a release — \`npm test\` takes about *two minutes*.

1. Bump the version in \`package.json\`
2. Update the changelog
   - Group entries under **Added**, **Changed** and **Fixed**
   - Link each entry to its pull request
3. Tag and push: \`git tag v2.4.0 && git push --tags\`

| Environment | URL | Owner |
|---|---|---|
| Staging | https://staging.example.com | Priya |
| Production | https://example.com | Marco |

> Production deploys happen only between 09:00 and 16:00 UTC.

\`\`\`bash
npm run build && npm run deploy -- --env production
\`\`\`

- [x] Smoke test passed
- [ ] Release notes sent to [#announcements](https://example.com/chat/announcements)`;

// ---- Block parsing ------------------------------------------------------------

const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)?.*$/;
const BULLET_RE = /^( {0,3})([-*+])([ \t]+|$)/;
const ORDERED_RE = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/;
const QUOTE_RE = /^ {0,3}>[ ]?/;
const TABLE_DELIM_RE = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;

const expandTabs = (line: string) => line.replace(/\t/g, '    ');
const isBlank = (line: string) => /^\s*$/.test(line);

/** Parse a Markdown document into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      flushPara();
      i++;
      continue;
    }

    // Setext heading: a paragraph line followed by === or ---.
    if (para.length && SETEXT_RE.test(line)) {
      const level = line.trim()[0] === '=' ? 1 : 2;
      blocks.push({ type: 'heading', level, children: parseInline(para.join('\n')) });
      para = [];
      i++;
      continue;
    }

    let m: RegExpMatchArray | null;

    if ((m = line.match(FENCE_RE))) {
      flushPara();
      const indent = m[1].length;
      const fence = m[2];
      const lang = (m[3] ?? '').trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[i])) {
        body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ''));
        i++;
      }
      i++; // closing fence (or EOF: an unclosed fence runs to the end, as in CommonMark)
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    if ((m = line.match(ATX_RE))) {
      flushPara();
      blocks.push({ type: 'heading', level: m[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline((m[2] ?? '').trim()) });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].replace(QUOTE_RE, ''));
        i++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner) });
      continue;
    }

    const listStart = matchListMarker(line);
    // A list can interrupt a paragraph only if it is a bullet or starts at 1 (CommonMark).
    if (listStart && (!para.length || !listStart.ordered || listStart.start === 1) && !(para.length && listStart.empty)) {
      flushPara();
      const { block, next } = parseList(lines, i, listStart);
      blocks.push(block);
      i = next;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1])) {
      const header = splitRow(line);
      const delims = splitRow(lines[i + 1]);
      if (header.length === delims.length) {
        flushPara();
        const align: Align[] = delims.map((d) => {
          const t = d.trim();
          const l = t.startsWith(':'), r = t.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
        });
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|') && !matchListMarker(lines[i]) && !ATX_RE.test(lines[i]) && !FENCE_RE.test(lines[i])) {
          const cells = splitRow(lines[i]);
          while (cells.length < header.length) cells.push('');
          rows.push(cells.slice(0, header.length).map((c) => parseInline(c.trim())));
          i++;
        }
        blocks.push({ type: 'table', align, header: header.map((c) => parseInline(c.trim())), rows });
        continue;
      }
    }

    para.push(line.replace(/^ {0,3}/, ''));
    i++;
  }
  flushPara();
  return blocks;
}

/** Split a table row on unescaped pipes, dropping one optional leading and trailing pipe. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

interface ListMarker { ordered: boolean; start: number; marker: string; indent: number; contentIndent: number; empty: boolean }

function matchListMarker(line: string): ListMarker | null {
  let m = line.match(BULLET_RE);
  if (m) {
    const spaces = m[3].length;
    const empty = m[3].length === 0 || line.slice(m[0].length).trim() === '';
    // 1–4 spaces after the marker set the content indent; 5+ means one space plus indented code.
    const width = spaces === 0 || spaces > 4 ? 1 : spaces;
    return { ordered: false, start: 1, marker: m[2], indent: m[1].length, contentIndent: m[1].length + 1 + width, empty };
  }
  m = line.match(ORDERED_RE);
  if (m) {
    const spaces = m[4].length;
    const empty = spaces === 0 || line.slice(m[0].length).trim() === '';
    const width = spaces === 0 || spaces > 4 ? 1 : spaces;
    return { ordered: true, start: Number(m[2]), marker: m[3], indent: m[1].length, contentIndent: m[1].length + m[2].length + 1 + width, empty };
  }
  return null;
}

function parseList(lines: string[], from: number, first: ListMarker): { block: Block; next: number } {
  const items: ListItem[] = [];
  let loose = false;
  let i = from;
  let sawBlankBetweenItems = false;

  while (i < lines.length) {
    const mk = matchListMarker(lines[i]);
    if (!mk || mk.ordered !== first.ordered || mk.marker !== first.marker || mk.indent > first.indent + 3) break;
    if (mk.indent < first.indent) break;
    // Collect this item's lines: the first line's content, then lines indented to contentIndent
    // (or blank), until a line that is neither.
    const itemLines: string[] = [lines[i].slice(Math.min(mk.contentIndent, lines[i].length))];
    i++;
    let blankRun = 0;
    let internalBlank = false;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        blankRun++;
        itemLines.push('');
        i++;
        continue;
      }
      const leading = l.match(/^ */)![0].length;
      if (leading >= mk.contentIndent) {
        if (blankRun) internalBlank = true;
        blankRun = 0;
        itemLines.push(l.slice(mk.contentIndent));
        i++;
        continue;
      }
      // Lazy continuation: a non-indented text line directly after a paragraph line stays in the item.
      const sibling = matchListMarker(l);
      if (!blankRun && !sibling && !QUOTE_RE.test(l) && !ATX_RE.test(l) && !FENCE_RE.test(l) && !HR_RE.test(l) && itemLines[itemLines.length - 1] !== '') {
        itemLines.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    // Trailing blanks belong between items, not inside this one — and only make the list loose
    // if what follows is another item of this same list, not a different list or block.
    let trailing = 0;
    while (itemLines.length && itemLines[itemLines.length - 1] === '') { itemLines.pop(); trailing++; }
    const nextMk = i < lines.length ? matchListMarker(lines[i]) : null;
    const continues = !!nextMk && nextMk.ordered === first.ordered && nextMk.marker === first.marker && nextMk.indent >= first.indent && nextMk.indent <= first.indent + 3;
    if (trailing && continues) sawBlankBetweenItems = true;
    if (internalBlank) loose = true;

    let checked: boolean | undefined;
    const task = itemLines[0]?.match(/^\[([ xX])\][ \t]+/);
    if (task) {
      checked = task[1] !== ' ';
      itemLines[0] = itemLines[0].slice(task[0].length);
    }
    items.push({ children: parseBlocks(itemLines), checked });
  }
  if (sawBlankBetweenItems) loose = true;
  return { block: { type: 'list', ordered: first.ordered, start: first.start, loose, items }, next: i };
}

// ---- Inline parsing --------------------------------------------------------------

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunct = (c: string | undefined) => c !== undefined && PUNCT.test(c);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', '#8217': '’',
};

type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'delim'; ch: '*' | '_' | '~'; count: number; canOpen: boolean; canClose: boolean; used: number }
  | { kind: 'node'; node: Inline };

/** Parse inline Markdown (one paragraph, heading, or cell) into inline nodes. */
export function parseInline(src: string, opts: { inLink?: boolean } = {}): Inline[] {
  const toks: Tok[] = [];
  let text = '';
  const pushText = () => { if (text) { toks.push({ kind: 'text', text }); text = ''; } };

  for (let i = 0; i < src.length; ) {
    const ch = src[i];

    // Backslash escapes and hard breaks.
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n') { pushText(); toks.push({ kind: 'node', node: { type: 'br' } }); i += 2; continue; }
      if (next !== undefined && isPunct(next)) { text += next; i += 2; continue; }
      text += ch; i++; continue;
    }

    // Line breaks: two+ trailing spaces make a hard break, otherwise a soft break.
    if (ch === '\n') {
      const hard = /  $/.test(text);
      text = text.replace(/ +$/, '');
      pushText();
      toks.push({ kind: 'node', node: { type: hard ? 'br' : 'softbreak' } });
      i++;
      // Leading spaces on the next line are not content.
      while (src[i] === ' ') i++;
      continue;
    }

    // Code spans: a run of backticks closed by an equal run.
    if (ch === '`') {
      let n = 1;
      while (src[i + n] === '`') n++;
      const close = findBacktickRun(src, i + n, n);
      if (close !== -1) {
        pushText();
        let code = src.slice(i + n, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        toks.push({ kind: 'node', node: { type: 'code', text: code } });
        i = close + n;
        continue;
      }
      text += '`'.repeat(n); i += n; continue;
    }

    // Images and links.
    if (ch === '!' && src[i + 1] === '[') {
      const link = matchLink(src, i + 1);
      if (link) {
        pushText();
        toks.push({ kind: 'node', node: { type: 'image', alt: inlineToText(parseInline(link.text)), src: link.href } });
        i = link.end;
        continue;
      }
    }
    if (ch === '[' && !opts.inLink) {
      const link = matchLink(src, i);
      if (link) {
        pushText();
        toks.push({ kind: 'node', node: { type: 'link', href: link.href, children: parseInline(link.text, { inLink: true }) } });
        i = link.end;
        continue;
      }
    }

    // Autolinks: <https://…> and bare URLs / www. (GFM). Never inside link text: [https://x](https://x) is one link.
    if (ch === '<' && !opts.inLink) {
      const m = src.slice(i).match(/^<((?:https?|mailto):[^\s<>]+)>/i);
      if (m) {
        pushText();
        const href = m[1];
        toks.push({ kind: 'node', node: { type: 'link', href, children: [{ type: 'text', text: href }] } });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'w') && !opts.inLink && (i === 0 || !/[\w/]/.test(src[i - 1]))) {
      const m = src.slice(i).match(/^(https?:\/\/|www\.)[^\s<]*[^\s<?!.,:;'")\]]/);
      if (m) {
        pushText();
        const url = m[0];
        toks.push({ kind: 'node', node: { type: 'link', href: url.startsWith('www.') ? `http://${url}` : url, children: [{ type: 'text', text: url }] } });
        i += url.length;
        continue;
      }
    }

    // Entities.
    if (ch === '&') {
      const m = src.slice(i).match(/^&(#?\w+);/);
      if (m && m[1] in ENTITIES) { text += ENTITIES[m[1]]; i += m[0].length; continue; }
    }

    // Emphasis delimiter runs.
    if (ch === '*' || ch === '_' || ch === '~') {
      let n = 1;
      while (src[i + n] === ch) n++;
      if (ch === '~' && n !== 2) { text += ch.repeat(n); i += n; continue; }
      const before = src[i - 1];
      const after = src[i + n];
      const leftFlank = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before));
      const rightFlank = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after));
      let canOpen = leftFlank, canClose = rightFlank;
      if (ch === '_') {
        // Underscores do not open/close inside a word: snake_case_name stays as written.
        canOpen = leftFlank && (!rightFlank || isPunct(before));
        canClose = rightFlank && (!leftFlank || isPunct(after));
      }
      pushText();
      toks.push({ kind: 'delim', ch, count: n, canOpen, canClose, used: 0 });
      i += n;
      continue;
    }

    text += ch;
    i++;
  }
  pushText();
  return processEmphasis(toks);
}

function findBacktickRun(src: string, from: number, n: number): number {
  for (let k = from; k < src.length; k++) {
    if (src[k] !== '`') continue;
    let len = 1;
    while (src[k + len] === '`') len++;
    if (len === n) return k;
    k += len - 1;
  }
  return -1;
}

/** [text](href "title") starting at `at` (the "["). Text may contain balanced brackets and code spans. */
function matchLink(src: string, at: number): { text: string; href: string; end: number } | null {
  let depth = 0;
  let k = at;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') { k++; continue; }
    if (c === '`') {
      let n = 1;
      while (src[k + n] === '`') n++;
      const close = findBacktickRun(src, k + n, n);
      if (close !== -1) { k = close + n - 1; continue; }
    }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  if (k >= src.length || src[k + 1] !== '(') return null;
  const text = src.slice(at + 1, k);
  let p = k + 2;
  while (src[p] === ' ' || src[p] === '\n') p++;
  let href = '';
  if (src[p] === '<') {
    const close = src.indexOf('>', p);
    if (close === -1) return null;
    href = src.slice(p + 1, close);
    p = close + 1;
  } else {
    let paren = 0;
    const start = p;
    for (; p < src.length; p++) {
      const c = src[p];
      if (c === '\\') { p++; continue; }
      if (/\s/.test(c)) break;
      if (c === '(') paren++;
      else if (c === ')') { if (paren === 0) break; paren--; }
    }
    href = src.slice(start, p);
  }
  while (src[p] === ' ' || src[p] === '\n') p++;
  // Optional title in quotes.
  if (src[p] === '"' || src[p] === "'") {
    const q = src[p];
    const close = src.indexOf(q, p + 1);
    if (close === -1) return null;
    p = close + 1;
    while (src[p] === ' ') p++;
  }
  if (src[p] !== ')') return null;
  return { text, href: href.replace(/\\([!-/:-@[-`{-~])/g, '$1'), end: p + 1 };
}

/** CommonMark's "process emphasis": match closers to openers, strongest first. */
function processEmphasis(toks: Tok[]): Inline[] {
  // Work on an array of nodes where delimiters are still tokens; collapse matched pairs.
  type Item = Tok | { kind: 'wrap'; node: Inline };
  const items: Item[] = [...toks];
  const asInline = (it: Item): Inline => {
    if (it.kind === 'text') return { type: 'text', text: it.text };
    if (it.kind === 'delim') return { type: 'text', text: it.ch.repeat(it.count - it.used) };
    return it.node;
  };

  for (let c = 0; c < items.length; c++) {
    const closer = items[c];
    if (closer.kind !== 'delim' || !closer.canClose || closer.count - closer.used === 0) continue;
    // Find the nearest opener of the same character.
    let o = c - 1;
    for (; o >= 0; o--) {
      const cand = items[o];
      if (cand.kind !== 'delim' || cand.ch !== closer.ch || !cand.canOpen || cand.count - cand.used === 0) continue;
      // Rule of 3: if one of them can both open and close, the sum of lengths must not be a multiple of 3 (unless both are).
      if ((cand.canClose || closer.canOpen) && (cand.count + closer.count) % 3 === 0 && !(cand.count % 3 === 0 && closer.count % 3 === 0)) continue;
      break;
    }
    if (o < 0) continue;
    const opener = items[o] as Extract<Tok, { kind: 'delim' }>;
    const availO = opener.count - opener.used;
    const availC = closer.count - closer.used;
    const use = closer.ch === '~' ? 2 : availO >= 2 && availC >= 2 ? 2 : 1;
    const type: Inline['type'] = closer.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
    const children = items.slice(o + 1, c).map(asInline);
    const node: Inline = { type, children } as Inline;
    opener.used += use;
    closer.used += use;
    const replacement: Item[] = [];
    if (opener.count - opener.used > 0) replacement.push(opener);
    replacement.push({ kind: 'wrap', node });
    if (closer.count - closer.used > 0) replacement.push(closer);
    items.splice(o, c - o + 1, ...replacement);
    c = o + replacement.length - 1;
    // Re-examine this closer if it still has delimiters left.
    if (closer.count - closer.used > 0) c = o + replacement.length - 2;
  }
  return mergeText(items.map(asInline));
}

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text') last.text += n.text;
    else if (n.type === 'text' && n.text === '') continue;
    else out.push(n);
  }
  return out;
}

// ---- Renderers: shared helpers -----------------------------------------------------

/** Inline nodes as unformatted text (alt text, plain links, table widths). */
export function inlineToText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text': return n.text;
        case 'code': return n.text;
        case 'strong': case 'em': case 'del': return inlineToText(n.children);
        case 'link': return inlineToText(n.children);
        case 'image': return n.alt;
        case 'br': return '\n';
        case 'softbreak': return ' ';
      }
    })
    .join('');
}

export type LinkStyle = 'text-url' | 'url' | 'text';

/** How a link is written in text output. */
function linkText(n: Extract<Inline, { type: 'link' }>, style: LinkStyle, inner: string): string {
  const same = inner.trim() === n.href || inner.trim() === n.href.replace(/^https?:\/\//, '') || inner.trim() === n.href.replace(/^mailto:/, '');
  if (style === 'url' || same) return n.href.replace(/^mailto:/, '');
  if (style === 'text') return inner;
  return `${inner} (${n.href.replace(/^mailto:/, '')})`;
}

/** Pad table cells so columns line up in a monospace font. */
function alignedTable(t: Extract<Block, { type: 'table' }>, cell: (c: Inline[]) => string): string[] {
  const rows = [t.header, ...t.rows].map((r) => r.map(cell));
  const widths = t.header.map((_, ci) => Math.max(...rows.map((r) => [...(r[ci] ?? '')].length)));
  const pad = (s: string, ci: number) => {
    const w = widths[ci] - [...s].length;
    if (t.align[ci] === 'right') return ' '.repeat(w) + s;
    if (t.align[ci] === 'center') return ' '.repeat(Math.floor(w / 2)) + s + ' '.repeat(Math.ceil(w / 2));
    return s + ' '.repeat(w);
  };
  const line = (r: string[]) => r.map((s, ci) => pad(s, ci)).join(' | ').replace(/\s+$/, '');
  return [line(rows[0]), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.slice(1).map(line)];
}

// ---- Plain text and chat markup ----------------------------------------------------

export interface TextStyle {
  /** Wrappers for inline formatting; empty string = drop the markup and keep the words. */
  strong: string;
  em: string;
  del: string;
  /** Inline code wrapper. */
  code: string;
  /** Code-block fence; empty = raw lines. */
  fence: string;
  /** Bullet for unordered items. */
  bullet: string;
  /** Prefix for quoted lines. */
  quote: string;
  /** Headings become a bold line ("*Title*") when `headingStrong` is set, else plain text. */
  headingStrong: boolean;
  /** Tables: aligned monospace text, wrapped in the fence when `fence` is set. */
  links: LinkStyle;
}

export const PLAIN_STYLE: TextStyle = { strong: '', em: '', del: '', code: '', fence: '', bullet: '•', quote: '> ', headingStrong: false, links: 'text-url' };
export const SLACK_STYLE: TextStyle = { strong: '*', em: '_', del: '~', code: '`', fence: '```', bullet: '•', quote: '> ', headingStrong: true, links: 'text-url' };
export const WHATSAPP_STYLE: TextStyle = { strong: '*', em: '_', del: '~', code: '`', fence: '```', bullet: '-', quote: '> ', headingStrong: true, links: 'text-url' };
export const GOOGLE_CHAT_STYLE: TextStyle = { strong: '*', em: '_', del: '~', code: '`', fence: '```', bullet: '-', quote: '> ', headingStrong: true, links: 'text-url' };

export type TextMode = 'plain' | 'slack' | 'whatsapp' | 'google-chat';
export const TEXT_MODES: Record<TextMode, TextStyle> = { plain: PLAIN_STYLE, slack: SLACK_STYLE, whatsapp: WHATSAPP_STYLE, 'google-chat': GOOGLE_CHAT_STYLE };

function renderInlineText(nodes: Inline[], st: TextStyle): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text': return n.text;
        case 'code': return st.code ? `${st.code}${n.text}${st.code}` : n.text;
        case 'strong': return wrap(renderInlineText(n.children, st), st.strong);
        case 'em': return wrap(renderInlineText(n.children, st), st.em);
        case 'del': return wrap(renderInlineText(n.children, st), st.del);
        case 'link': return linkText(n, st.links, renderInlineText(n.children, st));
        case 'image': return n.alt ? `${n.alt} (${n.src})` : n.src;
        case 'br': return '\n';
        case 'softbreak': return ' ';
      }
    })
    .join('');
}

/** Slack/WhatsApp markers must hug the text: "*bold* " not "* bold *". Move edge spaces outside. */
function wrap(inner: string, mark: string): string {
  if (!mark || !inner.trim()) return inner;
  const lead = inner.match(/^\s*/)![0];
  const trail = inner.match(/\s*$/)![0];
  return `${lead}${mark}${inner.trim()}${mark}${trail}`;
}

/**
 * Markdown blocks as text for a chat box or anywhere formatting is unwanted.
 * Structure survives (bullets, numbering, quotes, aligned tables); markup does not.
 */
export function renderText(blocks: Block[], style: TextStyle = PLAIN_STYLE, tight = false): string {
  const st = style;
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const t = renderInlineText(b.children, st);
        out.push(st.headingStrong ? wrap(t, st.strong) : t);
        break;
      }
      case 'paragraph':
        out.push(renderInlineText(b.children, st));
        break;
      case 'code':
        out.push(st.fence ? `${st.fence}\n${b.text}\n${st.fence}` : b.text);
        break;
      case 'quote':
        out.push(renderText(b.children, st).split('\n').map((l) => `${st.quote}${l}`.replace(/\s+$/, '')).join('\n'));
        break;
      case 'hr':
        // A rule is a pause, not content: it becomes the paragraph gap that already separates blocks.
        break;
      case 'table': {
        const lines = alignedTable(b, (c) => renderInlineText(c, st));
        out.push(st.fence ? `${st.fence}\n${lines.join('\n')}\n${st.fence}` : lines.join('\n'));
        break;
      }
      case 'list': {
        const lines: string[] = [];
        b.items.forEach((item, idx) => {
          const marker = b.ordered ? `${b.start + idx}.` : st.bullet;
          const box = item.checked === undefined ? '' : item.checked ? '☑ ' : '☐ ';
          const body = renderText(item.children, st, !b.loose);
          const [first = '', ...rest] = body.split('\n');
          const indent = ' '.repeat(marker.length + 1);
          lines.push(`${marker} ${box}${first}`);
          for (const r of rest) lines.push(r ? `${indent}${r}` : '');
          // A loose list keeps a blank line between items; a tight one has none.
          if (b.loose && idx < b.items.length - 1) lines.push('');
        });
        out.push(lines.join('\n'));
        break;
      }
    }
  }
  return out.join(tight ? '\n' : '\n\n').replace(/\n{3,}/g, '\n\n');
}

// ---- HTML (for the clipboard, Google Docs, Word, Gmail) -----------------------------

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: string) => (/^\s*(javascript|data|vbscript):/i.test(u) ? '' : u);
const MONO = "font-family:Consolas,'Courier New',monospace";

function renderInlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text': return escapeHtml(n.text);
        case 'code': return `<code style="${MONO}">${escapeHtml(n.text)}</code>`;
        case 'strong': return `<strong>${renderInlineHtml(n.children)}</strong>`;
        case 'em': return `<em>${renderInlineHtml(n.children)}</em>`;
        case 'del': return `<del>${renderInlineHtml(n.children)}</del>`;
        case 'link': {
          const href = safeUrl(n.href);
          return href ? `<a href="${escapeHtml(href)}">${renderInlineHtml(n.children)}</a>` : renderInlineHtml(n.children);
        }
        case 'image': {
          const src = safeUrl(n.src);
          return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(n.alt)}">` : escapeHtml(n.alt);
        }
        case 'br': return '<br>';
        case 'softbreak': return '\n';
      }
    })
    .join('');
}

/**
 * Semantic HTML with the few inline styles Google Docs and Word need to keep
 * monospace code and table borders when the fragment is pasted. Every piece of
 * text is escaped; the input's own HTML is never passed through.
 */
export function renderHtml(blocks: Block[], tight = false): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading': return `<h${b.level}>${renderInlineHtml(b.children)}</h${b.level}>`;
        case 'paragraph': return tight ? renderInlineHtml(b.children) : `<p>${renderInlineHtml(b.children)}</p>`;
        case 'code': return `<pre style="${MONO};white-space:pre-wrap"><code>${escapeHtml(b.text)}</code></pre>`;
        case 'quote': return `<blockquote>${renderHtml(b.children)}</blockquote>`;
        case 'hr': return '<hr>';
        case 'table': {
          const td = (cells: Inline[][], tag: 'th' | 'td') =>
            cells.map((c, i) => `<${tag}${b.align[i] ? ` style="text-align:${b.align[i]}"` : ''}>${renderInlineHtml(c)}</${tag}>`).join('');
          return `<table border="1" style="border-collapse:collapse"><thead><tr>${td(b.header, 'th')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${td(r, 'td')}</tr>`).join('')}</tbody></table>`;
        }
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
          const items = b.items
            .map((it) => {
              const box = it.checked === undefined ? '' : it.checked ? '☑ ' : '☐ ';
              return `<li>${box}${renderHtml(it.children, !b.loose)}</li>`;
            })
            .join('');
          return `<${tag}${start}>${items}</${tag}>`;
        }
      }
    })
    .join('\n');
}

// ---- Convenience -----------------------------------------------------------------

export interface Stats {
  headings: number;
  lists: number;
  tables: number;
  codeBlocks: number;
  links: number;
  words: number;
}

/** What the input contained, for the status line and the page's example. */
export function summarize(blocks: Block[]): Stats {
  const s: Stats = { headings: 0, lists: 0, tables: 0, codeBlocks: 0, links: 0, words: 0 };
  const walkInline = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === 'link') s.links++;
      if ('children' in n) walkInline(n.children);
    }
  };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === 'heading') { s.headings++; walkInline(b.children); }
      else if (b.type === 'paragraph') walkInline(b.children);
      else if (b.type === 'list') { s.lists++; for (const it of b.items) walk(it.children); }
      else if (b.type === 'table') { s.tables++; for (const r of [b.header, ...b.rows]) for (const c of r) walkInline(c); }
      else if (b.type === 'code') s.codeBlocks++;
      else if (b.type === 'quote') walk(b.children);
    }
  };
  walk(blocks);
  s.words = renderText(blocks).split(/\s+/).filter(Boolean).length;
  return s;
}
