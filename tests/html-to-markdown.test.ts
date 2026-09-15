import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, parseHtml, parseStyle, decodeEntities, escapeInline, unwrapRedirect, SAMPLE_DOCS_HTML, SAMPLE_HTML } from '../src/lib/html-to-markdown.ts';

const md = (html: string, opts = {}) => htmlToMarkdown(html, opts).markdown;

// ---- the shared samples ---------------------------------------------------------

test('Google Docs sample: styled spans, wrapper, redirect link, sibling-ul nesting, bold header cells', () => {
  const r = htmlToMarkdown(SAMPLE_DOCS_HTML);
  assert.equal(
    r.markdown,
    [
      '# Q3 launch plan',
      '',
      'We ship on **14 October**. The *only* blocker is the `billing-v2` flag — see the [rollout page](https://example.com/wiki/billing-v2).',
      '',
      '## Checklist',
      '',
      '- Freeze the release branch',
      '  - Notify **#eng-release**',
      '- Run the migration on staging',
      '',
      '| Owner | Status |',
      '| --- | --- |',
      '| Priya | On track |',
    ].join('\n'),
  );
  assert.deepEqual(r.stats, { headings: 2, paragraphs: 4, lists: 2, tables: 1, links: 1, images: 0, codeBlocks: 0, words: 53 });
  assert.deepEqual(r.notes, [
    'Google Docs redirect links were unwrapped to their real addresses.',
    'The table had no header row, so its first row became the header (Markdown tables need one).',
  ]);
  assert.equal(r.plain, false);
});

test('semantic HTML sample: headings, emphasis, code, links, nested lists, quote, fenced code with language, table, image', () => {
  const r = htmlToMarkdown(SAMPLE_HTML);
  assert.equal(
    r.markdown,
    [
      '## Release notes — v2.4.0',
      '',
      'This release adds **scheduled exports** and fixes the *timezone* bug in `report.py`. Full details on the [changelog](https://example.com/changelog).',
      '',
      '### Added',
      '',
      '- Scheduled exports',
      '  - Daily, weekly or monthly',
      '  - CSV and JSON formats',
      '- Dark mode for the dashboard',
      '',
      '### Upgrade',
      '',
      '1. Back up the database',
      '2. Run `pip install -U reporter`',
      '',
      '> Exports created before 2.4 keep their old schedule.',
      '',
      '```bash',
      'reporter export --format csv --schedule weekly',
      '```',
      '',
      '| Setting | Default |',
      '| --- | --- |',
      '| `format` | csv |',
      '| `schedule` | none |',
      '',
      '![Dashboard in dark mode](https://example.com/dashboard.png)',
    ].join('\n'),
  );
  assert.deepEqual(r.stats, { headings: 3, paragraphs: 9, lists: 3, tables: 1, links: 1, images: 1, codeBlocks: 1, words: 97 });
  assert.deepEqual(r.notes, []);
});

// ---- inline ---------------------------------------------------------------------------

test('inline formatting from tags and from styles; font-weight threshold; underline noted', () => {
  const r = htmlToMarkdown('<p>a <b>bold</b> and <i>it</i> and <b><i>both</i></b> and <s>gone</s> and <u>under</u> and <code>x*y</code> and <span style="font-weight:bold">sb</span><span style="font-weight:700"> more</span> and <span style="font-weight:600">semi</span> <span style="font-weight:500">no</span></p>');
  assert.equal(r.markdown, 'a **bold** and *it* and ***both*** and ~~gone~~ and under and `x*y` and **sb more** and **semi** no');
  assert.deepEqual(r.notes, ['Underline has no Markdown equivalent; underlined text is kept as plain text.']);
});

test('Docs quirks: bold split across spans merges; the font-weight:normal wrapper is not bold; Courier New is code', () => {
  assert.equal(md('<p><span style="font-weight:700">Hello</span><span style="font-weight:700"> world</span><span style="font-weight:400">!</span></p>'), '**Hello world**!');
  assert.equal(md('<b style="font-weight:normal"><p>plain</p></b>'), 'plain');
  assert.equal(md('<p><span style="font-family:\'Courier New\',monospace">ls -la</span></p>'), '`ls -la`');
  assert.equal(md('<p><span style="text-decoration:line-through">s</span></p>'), '~~s~~');
});

test('markers hug words; empty emphasis vanishes', () => {
  assert.equal(md('<p>x<b> bold </b>y <strong>  </strong>z</p>'), 'x **bold** y  z');
});

test('links: spaces encoded, Docs redirect unwrapped, javascript: dropped, formatted label, bare URL label', () => {
  const r = htmlToMarkdown('<p><a href="https://e.com/a b?x=1">text</a> <a href="https://www.google.com/url?q=https://real.example.com/p%3Fa%3D1&amp;sa=D">docs link</a> <a href="javascript:alert(1)">bad</a> <a href="https://x.y"><b>bold link</b> tail</a></p>');
  assert.equal(r.markdown, '[text](https://e.com/a%20b?x=1) [docs link](https://real.example.com/p?a=1) bad [**bold link** tail](https://x.y)');
  assert.equal(r.stats.links, 3);
  assert.deepEqual(unwrapRedirect('https://www.google.com/url?q=https://a.b/c&sa=D&usg=x'), { href: 'https://a.b/c', unwrapped: true });
  assert.deepEqual(unwrapRedirect('https://www.google.com/search?q=x'), { href: 'https://www.google.com/search?q=x', unwrapped: false });
});

test('escaping: emphasis characters, brackets, backticks, tildes, tags — but not intraword underscores', () => {
  assert.equal(md('<p>2 * 3 = 6, snake_case_name, _lead and trail_, a[b], back\\slash, `tick`, &lt;tag&gt;, ~~not strike~~</p>'), '2 \\* 3 = 6, snake_case_name, \\_lead and trail\\_, a\\[b\\], back\\\\slash, \\`tick\\`, \\<tag>, \\~\\~not strike\\~\\~');
  assert.equal(escapeInline('a_b'), 'a_b');
  assert.equal(escapeInline('_a_'), '\\_a\\_');
});

test('line-start escapes after hard breaks: bullets, numbers, headings, quotes', () => {
  assert.equal(md('<p>- one<br>2. two<br># three<br>&gt; four<br>--- rule</p>'), '\\- one  \n2\\. two  \n\\# three  \n\\> four  \n--- rule');
  assert.equal(md('<p>1. not a list</p>'), '1\\. not a list');
});

test('code spans pick a backtick run longer than any inside', () => {
  assert.equal(md('<p><code>a ` b</code> and <code>`start</code></p>'), '``a ` b`` and `` `start ``');
});

// ---- blocks ---------------------------------------------------------------------------------

test('lists: nesting is tight, start numbers kept, multiple paragraphs make an item loose, bullet option', () => {
  assert.equal(md('<ul><li>a<ul><li>a1<ol><li>deep</li></ol></li></ul></li><li>b</li></ul><ol start="3"><li>three</li><li>four</li></ol>'), '- a\n  - a1\n    1. deep\n- b\n\n3. three\n4. four');
  assert.equal(md('<ul><li aria-level="1">a</li><ul><li aria-level="2">a1</li><li aria-level="2">a2</li></ul><li aria-level="1">b</li></ul>'), '- a\n  - a1\n  - a2\n- b', 'Docs puts the nested <ul> beside the <li>');
  assert.equal(md('<ul><li><p>para one</p><p>para two</p></li><li><p>next</p></li></ul>'), '- para one\n\n  para two\n- next');
  assert.equal(md('<ul><li>a</li></ul>', { bullet: '*' }), '* a');
});

test('task lists from checkbox inputs and from Docs/GitHub glyphs', () => {
  assert.equal(md('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li><li>☐ docs style</li><li>☑ docs done</li></ul>'), '- [x] done\n- [ ] todo\n- [ ] docs style\n- [x] docs done');
});

test('tables: alignment, escaped pipes, short rows, first row promoted to header when there is no <th>', () => {
  assert.equal(md('<table><tr><th align="right">n</th><th>name</th></tr><tr><td>1</td><td>a | b</td></tr><tr><td>2</td></tr></table>'), '| n | name |\n| ---: | --- |\n| 1 | a \\| b |\n| 2 |  |');
  const r = htmlToMarkdown('<table><tbody><tr><td><b>x</b></td><td>y</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.equal(r.markdown, '| x | y |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(r.notes[0].startsWith('The table had no header row'));
  assert.equal(md('<table><tr><td>multi<br>line</td></tr></table>'), '| multi line |\n| --- |');
});

test('block quotes, pre with language class, fences longer than inner backticks, rules, empty paragraphs', () => {
  assert.equal(md('<blockquote><p>q1</p><p>q2</p></blockquote>'), '> q1\n>\n> q2');
  assert.equal(md('<pre><code class="language-js">const x = "a";\n  indented\n</code></pre>'), '```js\nconst x = "a";\n  indented\n```');
  assert.equal(md('<pre>plain ``` inside</pre>'), '````\nplain ``` inside\n````');
  assert.equal(md('<h1>T</h1><p></p><p>  </p><hr><h3>Sub <b>bold</b></h3><p><br></p><p>end</p>'), '# T\n\n---\n\n### Sub **bold**\n\nend');
  assert.equal(md('<h2>Title<br>line two <a href="https://x">link</a></h2>'), '## Title line two [link](https://x)');
});

test('Word: MsoListParagraph bullets and numbers by glyph and indent, o:p ignored', () => {
  const r = htmlToMarkdown('<p class="MsoListParagraph" style="margin-left:36.0pt;mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span style="font:7.0pt">&nbsp;&nbsp;</span></span>First item<o:p></o:p></p><p class="MsoListParagraph" style="margin-left:72.0pt"><span style="mso-list:Ignore">o<span>&nbsp;&nbsp;</span></span>Nested<o:p></o:p></p><p class="MsoListParagraph" style="margin-left:36.0pt"><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>Numbered</p>');
  assert.equal(r.markdown, '- First item\n  - Nested\n1. Numbered');
  assert.ok(r.notes[0].startsWith('Word list paragraphs'));
});

test('images: alt brackets stripped, no-src dropped with a note, linked image', () => {
  const r = htmlToMarkdown('<p><img src="https://i/x.png" alt="An [image]"> <img alt="no src"> <a href="https://l"><img src="https://i/y.png" alt="linked"></a></p>');
  assert.equal(r.markdown, '![An image](https://i/x.png)  [![linked](https://i/y.png)](https://l)');
  assert.equal(r.stats.images, 2);
  assert.ok(r.notes.includes('An image had no address and was dropped.'));
});

// ---- parser and misc -----------------------------------------------------------------------

test('parser: auto-closing <p>, stray closers, script/style/comments dropped, entities, whitespace collapse vs <pre>', () => {
  assert.deepEqual(parseHtml('<p>one<p>two').map((n) => n.type === 'element' && n.children.length), [1, 1]);
  assert.equal(md('<p>one<p>two<li>stray li</li></p>three</b></i>'), 'one\n\ntwo\n\nstray li\n\nthree');
  assert.equal(md('<style>p{color:red}</style><script>alert(1)</script><!-- c --><p>kept</p><noscript>no</noscript>'), 'kept');
  assert.equal(md('<p>&amp; &lt; &gt; &quot; &#39; &nbsp; &copy; &#x1F600; &unknownthing;</p>'), '& < > " \' © 😀 &unknownthing;');
  assert.equal(md('<p>\n  lots   of\n\n  space \t here\n</p><pre>  keep\n   this</pre>'), 'lots of space here\n\n```\n  keep\n   this\n```');
  assert.equal(md('<div>loose text<div>inner</div>more loose</div><span>span only</span><p>p</p>'), 'loose text\n\ninner\n\nmore loose\n\nspan only\n\np');
  assert.deepEqual(parseStyle('font-weight: 700; Color:#FFF;bad;white-space:pre-wrap'), { 'font-weight': '700', color: '#fff', 'white-space': 'pre-wrap' });
  assert.equal(decodeEntities('&lt;&#65;&#x42;&rsquo;'), '<AB’');
});

test('plain text input and empty input', () => {
  const r = htmlToMarkdown('just words, no tags at all');
  assert.equal(r.markdown, 'just words, no tags at all');
  assert.equal(r.plain, true);
  assert.equal(md(''), '');
  assert.equal(md('   \n  '), '');
});

test('300 KB converts in well under a second; a wall of "<" does not hang the parser', () => {
  const big = Array.from({ length: 2000 }, (_, i) => `<h2>H${i}</h2><p>Some <b>bold</b> <a href="https://e.com/${i}">link</a></p><ul><li>a</li><li>b</li></ul><table><tr><th>a</th></tr><tr><td>${i}</td></tr></table>`).join('');
  const t0 = performance.now();
  const r = htmlToMarkdown(big);
  assert.ok(performance.now() - t0 < 1500, `took ${(performance.now() - t0).toFixed(0)} ms`);
  assert.equal(r.stats.headings, 2000);
  const t1 = performance.now();
  htmlToMarkdown('<'.repeat(20000) + '<p>' + 'a'.repeat(20000));
  assert.ok(performance.now() - t1 < 500);
});
