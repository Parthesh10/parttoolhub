import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToDocx } from '../src/lib/markdown-to-docx.ts';

/** Minimal store-only ZIP reader (same approach as tests/zip-writer.test.ts) to get at the parts. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'not a valid ZIP: no End Of Central Directory record');
  const total = dv.getUint16(eocd + 10, true);
  const centralOffset = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  let p = centralOffset;
  for (let i = 0; i < total; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    out.set(name, new TextDecoder().decode(bytes.subarray(dataStart, dataStart + compSize)));
  }
  return out;
}

/**
 * A minimal well-formedness check (balanced/self-closed tags, no attempt at full XML validation)
 * — enough to catch the class of bug this generator is most at risk of: an unclosed <w:r> or a
 * stray '<'/'>' from unescaped user text breaking the document.
 */
function assertWellFormed(xml: string, label: string) {
  const withoutDecl = xml.replace(/^<\?xml[^?]*\?>/, '');
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = tagRe.exec(withoutDecl))) {
    // Anything between tags must not contain a stray '<' or '>' (would mean bad escaping).
    const between = withoutDecl.slice(lastIndex, m.index);
    assert.ok(!/[<>]/.test(between), `${label}: stray < or > outside a tag near "${between.slice(0, 40)}"`);
    lastIndex = tagRe.lastIndex;
    const [, closing, name, , selfClose] = m;
    if (closing) {
      const top = stack.pop();
      assert.equal(top, name, `${label}: mismatched closing tag </${name}> (expected </${top}>)`);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], `${label}: unclosed tag(s): ${stack.join(', ')}`);
}

function build(markdown: string) {
  const bytes = markdownToDocx(markdown, { title: 'Test' });
  const parts = readZip(bytes);
  for (const [name, content] of parts) if (name.endsWith('.xml') || name.endsWith('.rels')) assertWellFormed(content, name);
  return parts;
}

test('produces a complete, well-formed OOXML package with every required part', () => {
  const parts = build('# Hello\n\nSome text.');
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml', 'docProps/app.xml']) {
    assert.ok(parts.has(name), `missing required part: ${name}`);
  }
});

test('headings map to Heading1-6 paragraph styles', () => {
  const parts = build('# H1\n## H2\n###### H6');
  const doc = parts.get('word/document.xml')!;
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>[\s\S]*?H1/);
  assert.match(doc, /<w:pStyle w:val="Heading2"\/>[\s\S]*?H2/);
  assert.match(doc, /<w:pStyle w:val="Heading6"\/>[\s\S]*?H6/);
});

test('bold, italic and strikethrough become w:b / w:i / w:strike runs', () => {
  const doc = build('**bold** *italic* ~~gone~~').get('word/document.xml')!;
  assert.match(doc, /<w:b\/>[\s\S]*?<w:t[^>]*>bold<\/w:t>/);
  assert.match(doc, /<w:i\/>[\s\S]*?<w:t[^>]*>italic<\/w:t>/);
  assert.match(doc, /<w:strike\/>[\s\S]*?<w:t[^>]*>gone<\/w:t>/);
});

test('special XML characters in text are escaped, not left to break the document', () => {
  const doc = build('Ampersand & <tag> "quotes" and \'apostrophe\'').get('word/document.xml')!;
  assert.ok(doc.includes('Ampersand &amp; &lt;tag&gt;'), 'raw & and < / > must be escaped in text runs');
});

test('a plain-text link produces a real hyperlink relationship, and every run inside it is styled', () => {
  const parts = build('[**bold link**](https://example.com/a?x=1&y=2)');
  const doc = parts.get('word/document.xml')!;
  const rels = parts.get('word/_rels/document.xml.rels')!;
  const relIdMatch = doc.match(/<w:hyperlink r:id="(rId\d+)"/);
  assert.ok(relIdMatch, 'no <w:hyperlink> found');
  const relId = relIdMatch![1];
  assert.ok(rels.includes(`Id="${relId}"`), `relationship ${relId} missing from document.xml.rels`);
  assert.ok(rels.includes('example.com/a?x=1&amp;y=2'), 'the URL\'s own & must be escaped in the relationship target');
  // The bold run inside the link must carry both the Hyperlink style and <w:b/> — not just the
  // first run in the document, which a naive single-replace implementation could miss entirely.
  const hyperlinkBody = doc.match(/<w:hyperlink[^>]*>([\s\S]*?)<\/w:hyperlink>/)![1];
  assert.match(hyperlinkBody, /<w:rStyle w:val="Hyperlink"\/>/);
  assert.match(hyperlinkBody, /<w:b\/>/);
});

test('an image reference becomes a labelled link rather than being silently dropped', () => {
  const doc = build('![a diagram](https://example.com/diagram.png)').get('word/document.xml')!;
  assert.match(doc, /<w:hyperlink/);
  assert.match(doc, /\[Image: a diagram\]/);
});

test('inline code gets the monospace character style', () => {
  const doc = build('Run `npm test` here.').get('word/document.xml')!;
  assert.match(doc, /<w:rStyle w:val="CodeChar"\/>[\s\S]*?<w:t[^>]*>npm test<\/w:t>/);
});

test('a fenced code block keeps every line and its indentation, joined by <w:br/> in one CodeBlock paragraph', () => {
  const doc = build('```\nfirst\n  indented\nlast\n```').get('word/document.xml')!;
  assert.match(doc, /<w:pStyle w:val="CodeBlock"\/>/);
  assert.match(doc, /first<\/w:t><w:br\/>/);
  assert.match(doc, /<w:t xml:space="preserve">  indented<\/w:t>/, 'leading spaces preserved via xml:space="preserve"');
  // Last line has no trailing <w:br/> inside its own run.
  assert.match(doc, /<w:t xml:space="preserve">last<\/w:t><\/w:r><\/w:p>/);
});

test('a blockquote applies the Quote paragraph style to its prose', () => {
  const doc = build('> Quoted text here.').get('word/document.xml')!;
  assert.match(doc, /<w:pStyle w:val="Quote"\/>[\s\S]*?Quoted text here/);
});

test('bullet lists all share numId 1; nesting advances the indent level', () => {
  const doc = build('- one\n- two\n  - nested\n- three').get('word/document.xml')!;
  const numIds = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
  assert.ok(numIds.every((id) => id === '1'), 'every bullet item should reference numId 1');
  assert.match(doc, /<w:ilvl w:val="1"\/>[\s\S]{0,80}<w:numId w:val="1"\/>[\s\S]*?nested/);
});

test('separate ordered lists each get a distinct numId, so each restarts at 1', () => {
  const doc = build('1. a\n2. b\n\nSome text.\n\n1. x\n2. y').get('word/document.xml')!;
  const numIds = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
  assert.equal(new Set(numIds).size, 2, 'two independent ordered lists should use two distinct numIds');
  const numberingXml = build('1. a\n2. b\n\nSome text.\n\n1. x\n2. y');
  // (rebuilt separately to also check numbering.xml defines a <w:num> for each id used)
  const numbering = numberingXml.get('word/numbering.xml')!;
  for (const id of new Set(numIds)) assert.ok(numbering.includes(`w:numId="${id}"`), `numbering.xml missing <w:num> for numId ${id}`);
});

test('a task list renders a checkbox glyph before the item text', () => {
  const doc = build('- [x] done\n- [ ] todo').get('word/document.xml')!;
  assert.match(doc, /☑[\s\S]{0,80}done/);
  assert.match(doc, /☐[\s\S]{0,80}todo/);
});

test('a GFM table becomes a real w:tbl with a bold header row and one column definition per column', () => {
  const doc = build('| A | B |\n| --- | --- |\n| 1 | 2 |').get('word/document.xml')!;
  assert.match(doc, /<w:tbl>/);
  assert.equal((doc.match(/<w:gridCol\/>/g) ?? []).length, 2);
  const headerRow = doc.match(/<w:tr>([\s\S]*?)<\/w:tr>/)![1];
  assert.match(headerRow, /<w:b\/>[\s\S]*?>A</);
});

test('a horizontal rule becomes a bordered empty paragraph', () => {
  const doc = build('above\n\n---\n\nbelow').get('word/document.xml')!;
  assert.match(doc, /<w:pBdr><w:bottom w:val="single"/);
});

test('empty input produces a still-valid, empty-bodied document', () => {
  const parts = build('');
  assert.ok(parts.get('word/document.xml')!.includes('<w:body>'));
});

test('the title option is escaped into docProps/core.xml', () => {
  const bytes = markdownToDocx('text', { title: 'A "quoted" & tricky <title>' });
  const parts = readZip(bytes);
  assertWellFormed(parts.get('docProps/core.xml')!, 'docProps/core.xml');
  assert.match(parts.get('docProps/core.xml')!, /<dc:title>A &quot;quoted&quot; &amp; tricky &lt;title&gt;<\/dc:title>/);
});
