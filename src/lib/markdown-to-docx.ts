/**
 * Markdown → a real .docx file, built by hand as a ZIP of WordprocessingML
 * (OOXML) parts — no external library, matching this site's one-script-per-
 * tool rule and its no-dependency posture generally. Reuses this repo's own
 * Markdown parser (src/lib/markdown.ts) for the AST, so this module is only
 * the AST-to-OOXML half.
 *
 * Deliberately scoped: headings, paragraphs, bold/italic/strikethrough/
 * inline code, hyperlinks, fenced code blocks, block quotes, bullet and
 * numbered lists (including nesting), tables and horizontal rules all map
 * to real Word constructs. Images are represented as a bracketed hyperlink
 * to the image URL rather than embedded binary data — embedding a fetched
 * image as a media part is a meaningfully larger scope (network fetch,
 * format sniffing, a relationship + drawing XML per image) than this pass
 * covers; see the tool page's edge cases section, which says so plainly.
 */
import { parseMarkdown, type Block, type Inline, type ListItem } from './markdown';
import { createZip, type ZipEntry } from './zip-writer';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

// ---- Run-level (inline) rendering -----------------------------------------

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Inside a <w:hyperlink>: every run needs the Hyperlink character style, not just the first. */
  link?: boolean;
}

interface Rel {
  id: string;
  target: string;
}

class DocBuilder {
  private nextRelId = 4; // rId1-3 are reserved for styles/numbering/... below
  rels: Rel[] = [];
  private nextNumId = 3; // numId 1 = bullets (shared); ordered lists each allocate a fresh id from 3
  /** Every numId handed out to an ordered list, in allocation order — numbering.xml needs one <w:num> per id. */
  orderedNumIds: number[] = [];

  addHyperlinkRel(href: string): string {
    const id = `rId${this.nextRelId++}`;
    this.rels.push({ id, target: href });
    return id;
  }

  allocOrderedNumId(): number {
    const id = this.nextNumId++;
    this.orderedNumIds.push(id);
    return id;
  }

  /** One <w:r> per styled run of text, splitting only where formatting changes. */
  runs(inline: Inline[], style: RunStyle = {}): string {
    return inline.map((node) => this.runNode(node, style)).join('');
  }

  private runNode(node: Inline, style: RunStyle): string {
    switch (node.type) {
      case 'text':
        return this.textRun(node.text, style);
      case 'strong':
        return this.runs(node.children, { ...style, bold: true });
      case 'em':
        return this.runs(node.children, { ...style, italic: true });
      case 'del':
        return this.runs(node.children, { ...style, strike: true });
      case 'code':
        return this.textRun(node.text, { ...style, code: true });
      case 'link': {
        const id = this.addHyperlinkRel(node.href);
        const linkStyle = { ...style, link: true };
        const inner = node.children.length ? this.runs(node.children, linkStyle) : this.textRun(node.href, linkStyle);
        return `<w:hyperlink r:id="${id}" w:history="1">${inner}</w:hyperlink>`;
      }
      case 'image':
        // Not embedded (see module doc comment) — a clearly-labelled link stands in for it.
        return this.runNode({ type: 'link', href: node.src, children: [{ type: 'text', text: `[Image: ${node.alt || node.src}]` }] }, style);
      case 'br':
      case 'softbreak':
        return `<w:r><w:br/></w:r>`;
    }
  }

  private textRun(text: string, style: RunStyle): string {
    if (!text) return '';
    const props: string[] = [];
    if (style.bold) props.push('<w:b/>');
    if (style.italic) props.push('<w:i/>');
    if (style.strike) props.push('<w:strike/>');
    // w:rStyle can only appear once per run, so a link takes it (colour/underline matter more
    // than the exact character style) and inline code layered under a link falls back to just
    // the monospace font directly, rather than losing the link's own look.
    if (style.link) props.push('<w:rStyle w:val="Hyperlink"/>');
    if (style.code) props.push(style.link ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '<w:rStyle w:val="CodeChar"/>');
    const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  // ---- Block-level rendering ------------------------------------------

  blocks(blocks: Block[]): string {
    return blocks.map((b) => this.block(b, 0)).join('');
  }

  /**
   * `styleOverride` lets a blockquote force its Quote style onto a plain paragraph child without
   * a fragile string-rewrite of already-built XML — headings/lists/tables keep their own style
   * inside a quote (only bare paragraphs read as "quoted prose" in the common case).
   */
  private block(b: Block, listDepth: number, styleOverride?: string): string {
    switch (b.type) {
      case 'heading':
        return this.paragraph(this.runs(b.children), `Heading${b.level}`);
      case 'paragraph':
        return this.paragraph(this.runs(b.children), styleOverride);
      case 'code':
        return this.codeBlock(b.text);
      case 'quote': {
        const inner = b.children.map((child) => this.block(child, listDepth, 'Quote')).join('');
        return inner || this.paragraph('', 'Quote');
      }
      case 'list':
        return this.list(b, listDepth);
      case 'table':
        return this.table(b);
      case 'hr':
        return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>`;
    }
  }

  private paragraph(runsXml: string, style?: string): string {
    const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    return `<w:p>${pPr}${runsXml}</w:p>`;
  }

  private codeBlock(text: string): string {
    const lines = text.replace(/\n$/, '').split('\n');
    const runs = lines
      .map((line, i) => {
        const br = i < lines.length - 1 ? '<w:br/>' : '';
        return `<w:r><w:t xml:space="preserve">${esc(line) || ' '}</w:t>${br}</w:r>`;
      })
      .join('');
    return `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${runs}</w:p>`;
  }

  private list(b: Extract<Block, { type: 'list' }>, depth: number): string {
    const numId = b.ordered ? this.allocOrderedNumId() : 1;
    return b.items.map((item) => this.listItem(item, depth, numId, b.ordered)).join('');
  }

  private listItem(item: ListItem, depth: number, numId: number, ordered: boolean): string {
    const ilvl = ordered ? 0 : Math.min(depth, 8);
    const indent = 720 + depth * 360;
    const numPr = `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
    const checkbox = item.checked === undefined ? '' : item.checked ? '☑ ' : '☐ ';

    const out: string[] = [];
    let firstParaEmitted = false;
    for (const child of item.children) {
      if (!firstParaEmitted && (child.type === 'paragraph' || child.type === 'heading')) {
        const text = child.type === 'paragraph' ? this.runs(child.children) : this.runs(child.children);
        const prefixRun = checkbox ? this.textRun(checkbox, {}) : '';
        out.push(
          `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="${indent}"/>${numPr}</w:pPr>${prefixRun}${text}</w:p>`,
        );
        firstParaEmitted = true;
      } else if (child.type === 'list') {
        out.push(this.list(child, depth + 1));
      } else {
        // A second paragraph, code block, etc. inside one list item: indent to match, no bullet/number of its own.
        const rendered = this.block(child, depth + 1);
        out.push(rendered.replace('<w:pPr>', `<w:pPr><w:ind w:left="${indent}"/>`));
      }
    }
    if (!firstParaEmitted) {
      out.unshift(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="${indent}"/>${numPr}</w:pPr></w:p>`);
    }
    return out.join('');
  }

  private table(b: Extract<Block, { type: 'table' }>): string {
    const cols = b.header.length;
    const grid = `<w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>`;
    const borders =
      '<w:tblBorders>' +
      (['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const)
        .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
        .join('') +
      '</w:tblBorders>';
    const tblPr = `<w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>`;

    const cell = (inline: Inline[], align: 'left' | 'center' | 'right' | null, header: boolean) => {
      const jc = align && align !== 'left' ? `<w:jc w:val="${align}"/>` : '';
      const runsXml = header ? this.runs(inline, { bold: true }) : this.runs(inline);
      return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${jc ? `<w:pPr>${jc}</w:pPr>` : ''}${runsXml}</w:p></w:tc>`;
    };
    const headerRow = `<w:tr>${b.header.map((h, i) => cell(h, b.align[i] ?? null, true)).join('')}</w:tr>`;
    const rows = b.rows
      .map((row) => `<w:tr>${row.map((c, i) => cell(c, b.align[i] ?? null, false)).join('')}</w:tr>`)
      .join('');
    return `<w:tbl>${tblPr}${grid}${headerRow}${rows}</w:tbl>`;
  }
}

// ---- Fixed OOXML parts (styles, numbering, content types, metadata) ------

function stylesXml(): string {
  const headingStyle = (level: number, size: number) => `
    <w:style w:type="paragraph" w:styleId="Heading${level}">
      <w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
      <w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>
      <w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>
    </w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>
  </w:style>
  ${[1, 2, 3, 4, 5, 6].map((l) => headingStyle(l, 36 - l * 2)).join('')}
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="432"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BFBFBF"/></w:pBdr></w:pPr>
    <w:rPr><w:i/><w:color w:val="595959"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:shd w:val="clear" w:fill="F2F2F2"/><w:spacing w:after="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="CodeChar">
    <w:name w:val="Code Char"/>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F2F2F2"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;
}

function numberingXml(orderedNumIds: number[]): string {
  const level = (i: number, bullet: boolean) => `
    <w:lvl w:ilvl="${i}">
      <w:start w:val="1"/>
      <w:numFmt w:val="${bullet ? 'bullet' : 'decimal'}"/>
      <w:lvlText w:val="${bullet ? '&#8226;' : `%${i + 1}.`}"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr>
      ${bullet ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ''}
    </w:lvl>`;
  const bulletLevels = Array.from({ length: 9 }, (_, i) => level(i, true)).join('');
  const decimalLevels = Array.from({ length: 9 }, (_, i) => level(i, false)).join('');
  const nums = [`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`, ...orderedNumIds.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/></w:num>`)];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0">${bulletLevels}</w:abstractNum>
  <w:abstractNum w:abstractNumId="1">${decimalLevels}</w:abstractNum>
  ${nums.join('')}
</w:numbering>`;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function documentRelsXml(hyperlinks: Rel[]): string {
  const fixed = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'numbering', target: 'numbering.xml' },
  ];
  const rels = [
    ...fixed.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"/>`),
    ...hyperlinks.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escAttr(r.target)}" TargetMode="External"/>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
}

function coreXml(title: string, when: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escAttr(title)}</dc:title>
  <dc:creator>PartToolHub</dc:creator>
  <cp:lastModifiedBy>PartToolHub</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>PartToolHub</Application>
</Properties>`;
}

export interface DocxOptions {
  /** Document title stored in metadata (docProps/core.xml), not printed on the page. */
  title?: string;
}

/** Converts Markdown source straight to a .docx file's bytes. */
export function markdownToDocx(markdown: string, opts: DocxOptions = {}): Uint8Array {
  const blocks = parseMarkdown(markdown);
  const builder = new DocBuilder();
  const bodyXml = builder.blocks(blocks);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const when = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: contentTypesXml() },
    { name: '_rels/.rels', data: rootRelsXml() },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: documentRelsXml(builder.rels) },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/numbering.xml', data: numberingXml(builder.orderedNumIds) },
    { name: 'docProps/core.xml', data: coreXml(opts.title ?? 'Converted document', when) },
    { name: 'docProps/app.xml', data: appXml() },
  ];
  return createZip(entries);
}
