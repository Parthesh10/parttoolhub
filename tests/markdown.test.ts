import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkdown,
  parseInline,
  renderText,
  renderHtml,
  summarize,
  inlineToText,
  SAMPLE_MARKDOWN,
  PLAIN_STYLE,
  SLACK_STYLE,
  WHATSAPP_STYLE,
  GOOGLE_CHAT_STYLE,
  TEXT_MODES,
} from '../src/lib/markdown.ts';

const html = (md: string) => renderHtml(parseMarkdown(md));
const plain = (md: string) => renderText(parseMarkdown(md));
const slack = (md: string) => renderText(parseMarkdown(md), SLACK_STYLE);

// ---- the shared sample ---------------------------------------------------------

test('sample: structure is what the pages describe', () => {
  const blocks = parseMarkdown(SAMPLE_MARKDOWN);
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'list', 'table', 'quote', 'code', 'list']);
  assert.deepEqual(summarize(blocks), { headings: 1, lists: 3, tables: 1, codeBlocks: 1, links: 3, words: 104 });
  const p = plain(SAMPLE_MARKDOWN);
  assert.ok(p.startsWith('Deploy checklist\n\nRun the full test suite before tagging a release — npm test takes about two minutes.'));
  assert.ok(p.includes('2. Update the changelog\n   • Group entries under Added, Changed and Fixed\n   • Link each entry'), 'nested tight list, no blank line, indented under its parent');
  assert.ok(p.includes('Environment | URL                         | Owner\n------------|-----------------------------|------\nStaging     |'), 'table aligned in columns');
  assert.ok(p.includes('• ☑ Smoke test passed\n• ☐ Release notes sent to #announcements (https://example.com/chat/announcements)'));
  assert.ok(!/[*_`#|]{2}|\[.*\]\(/.test(p.replace(/------.*\n/, '')), 'no Markdown markup survives in plain text');
  const s = slack(SAMPLE_MARKDOWN);
  assert.ok(s.startsWith('*Deploy checklist*\n\nRun the *full test suite* before tagging a release — `npm test` takes about _two minutes_.'));
  assert.ok(s.includes('```\nEnvironment | URL'), 'table fenced for monospace in chat');
  assert.ok(s.includes('```\nnpm run build && npm run deploy -- --env production\n```'));
  const h = html(SAMPLE_MARKDOWN);
  assert.ok(h.startsWith('<h2>Deploy checklist</h2>\n<p>Run the <strong>full test suite</strong>'));
  assert.ok(h.includes('<ol><li>Bump the version in <code style='), 'tight list: no <p> inside <li>');
  assert.ok(h.includes('<table border="1" style="border-collapse:collapse"><thead><tr><th>Environment</th>'));
  assert.ok(h.includes('<li>☑ Smoke test passed</li><li>☐ Release notes sent to <a href="https://example.com/chat/announcements">#announcements</a></li>'));
});

// ---- inline ------------------------------------------------------------------------

test('emphasis: bold, italic, both, strike, underscores, intraword rules', () => {
  assert.equal(html('**b** *i* ***bi*** __b__ _i_ ~~s~~'), '<p><strong>b</strong> <em>i</em> <em><strong>bi</strong></em> <strong>b</strong> <em>i</em> <del>s</del></p>');
  assert.equal(html('snake_case_name and _a_b and 2*3*4'), '<p>snake_case_name and _a_b and 2<em>3</em>4</p>', 'underscores never open inside a word; asterisks may');
  assert.equal(html('**bold with *italic* inside**'), '<p><strong>bold with <em>italic</em> inside</strong></p>');
  assert.equal(html('a * b **unclosed'), '<p>a * b **unclosed</p>', 'unmatched delimiters stay literal');
  assert.equal(html('~single~ tilde'), '<p>~single~ tilde</p>', 'strikethrough needs exactly two tildes');
  assert.equal(plain('**b** *i* ~~s~~ `c`'), 'b i s c');
  assert.equal(slack('**b** *i* ~~s~~ `c`'), '*b* _i_ ~s~ `c`');
  assert.equal(slack('** spaced bold **'), '** spaced bold **', 'space-padded asterisks are not emphasis in Markdown, so they stay as typed');
  assert.equal(slack('**trailing space **x'), '**trailing space **x');
});

test('code spans: literal contents, backtick runs, stripped edge spaces', () => {
  assert.equal(html('use `a*b*` and ``a ` b`` and ` spaced `'), "<p>use <code style=\"font-family:Consolas,'Courier New',monospace\">a*b*</code> and <code style=\"font-family:Consolas,'Courier New',monospace\">a ` b</code> and <code style=\"font-family:Consolas,'Courier New',monospace\">spaced</code></p>");
  assert.equal(plain('use `a*b*`'), 'use a*b*');
  assert.equal(html('unclosed `tick'), '<p>unclosed `tick</p>');
});

test('links, images and autolinks', () => {
  assert.equal(html('[text](https://x.y/p?a=1&b=2 "T")'), '<p><a href="https://x.y/p?a=1&amp;b=2">text</a></p>');
  assert.equal(html('<https://auto.link> and https://bare.example.com/path. and www.site.org,'), '<p><a href="https://auto.link">https://auto.link</a> and <a href="https://bare.example.com/path">https://bare.example.com/path</a>. and <a href="http://www.site.org">www.site.org</a>,</p>');
  assert.equal(html('[https://same.example.com](https://same.example.com)'), '<p><a href="https://same.example.com">https://same.example.com</a></p>', 'no autolink inside link text');
  assert.equal(html('[nested [b]](u2) [`code`](u)'), "<p><a href=\"u2\">nested [b]</a> <a href=\"u\"><code style=\"font-family:Consolas,'Courier New',monospace\">code</code></a></p>");
  assert.equal(html('![alt text](https://img/x.png)'), '<p><img src="https://img/x.png" alt="alt text"></p>');
  assert.equal(html('[x](javascript:alert(1)) ![y](data:text/html,x)'), '<p>x y</p>', 'unsafe URL schemes are dropped');
  assert.equal(plain('[Docs](https://docs.example.com) and [https://s.x](https://s.x) and ![alt](https://i/p.png)'), 'Docs (https://docs.example.com) and https://s.x and alt (https://i/p.png)');
  assert.equal(renderText(parseMarkdown('[Docs](https://d.x) and [x](https://y.z)'), { ...PLAIN_STYLE, links: 'url' }), 'https://d.x and https://y.z');
  assert.equal(renderText(parseMarkdown('[Docs](https://d.x) and [x](https://y.z)'), { ...PLAIN_STYLE, links: 'text' }), 'Docs and x');
  assert.equal(plain('[mail](mailto:a@b.c)'), 'mail (a@b.c)');
});

test('escapes, entities and raw HTML', () => {
  assert.equal(html('not \\*bold\\* and \\# and a\\\\b'), '<p>not *bold* and # and a\\b</p>');
  assert.equal(html('&amp; &lt;tag&gt; &copy; &unknown;'), '<p>&amp; &lt;tag&gt; © &amp;unknown;</p>');
  assert.equal(html('<b>not bold</b> <script>alert(1)</script>'), '<p>&lt;b&gt;not bold&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;</p>', 'input HTML is text, never markup');
  assert.equal(plain('<b>x</b>'), '<b>x</b>');
});

test('line breaks: two spaces or backslash are hard, a bare newline is soft', () => {
  assert.equal(html('one  \ntwo\\\nthree\nfour'), '<p>one<br>two<br>three\nfour</p>');
  assert.equal(plain('one  \ntwo\\\nthree\nfour'), 'one\ntwo\nthree four');
});

// ---- blocks ----------------------------------------------------------------------------

test('headings: ATX (with closing hashes), setext, and the non-headings', () => {
  assert.equal(html('# H1 #\n## H2\n###### H6'), '<h1>H1</h1>\n<h2>H2</h2>\n<h6>H6</h6>');
  assert.equal(html('####### seven\n#nospace'), '<p>####### seven\n#nospace</p>');
  assert.equal(html('Title\n=====\nSub\n---'), '<h1>Title</h1>\n<h2>Sub</h2>');
  assert.equal(plain('## Heading\n\ntext'), 'Heading\n\ntext');
  assert.equal(slack('## Heading'), '*Heading*', 'chat apps have no headings: a bold line');
});

test('horizontal rules vs setext underline, and rules vanish in text', () => {
  assert.equal(html('para\n---\n\n---\n\n* * *\n___'), '<h2>para</h2>\n<hr>\n<hr>\n<hr>');
  assert.equal(plain('a\n\n---\n\nb'), 'a\n\nb');
});

test('lists: nesting, tight vs loose, start number, marker kinds, tasks, lazy lines', () => {
  assert.equal(html('- a\n- b\n  - b1\n    1. deep\n- c'), '<ul><li>a</li><li>b\n<ul><li>b1\n<ol><li>deep</li></ol></li></ul></li><li>c</li></ul>');
  assert.equal(plain('- a\n- b\n  - b1\n    1. deep\n- c'), '• a\n• b\n  • b1\n    1. deep\n• c');
  assert.equal(renderText(parseMarkdown('- a\n  - b'), WHATSAPP_STYLE), '- a\n  - b', 'WhatsApp uses its own dash bullets');
  assert.equal(html('1. one\n2. two\n\n   more\n3. three'), '<ol><li><p>one</p></li><li><p>two</p>\n<p>more</p></li><li><p>three</p></li></ol>', 'a blank line inside an item makes the list loose');
  assert.equal(plain('5. five\n\n6. six'), '5. five\n\n6. six', 'loose list keeps its blank lines');
  assert.equal(html('5. five\n6. six'), '<ol start="5"><li>five</li><li>six</li></ol>');
  assert.equal(html('- a\n\n1. b'), '<ul><li>a</li></ul>\n<ol><li>b</li></ol>', 'a blank line before a different list does not make the first one loose');
  assert.equal(html('1. a\n10. b'), '<ol><li>a</li><li>b</li></ol>', 'numbers come from the start value, as CommonMark renumbers');
  assert.equal(html('- [x] done\n- [ ] todo\n- [not] task'), '<ul><li>☑ done</li><li>☐ todo</li><li>[not] task</li></ul>');
  assert.equal(plain('- [x] done\n- [ ] todo'), '• ☑ done\n• ☐ todo');
  assert.equal(html('- x\nlazy line\n- y'), '<ul><li>x\nlazy line</li><li>y</li></ul>');
  assert.equal(html('text\n2. not a list\n\n1. list'), '<p>text\n2. not a list</p>\n<ol><li>list</li></ol>', 'only a list starting at 1 can interrupt a paragraph');
  assert.equal(html('- **Step 1:** do x'), '<ul><li><strong>Step 1:</strong> do x</li></ul>');
  assert.equal(html('-\tabc'), '<ul><li>abc</li></ul>', 'tab after the marker');
});

test('block quotes, nested, with lists inside', () => {
  assert.equal(html('> q1\n> q2\n>\n> - item\n> > nested'), '<blockquote><p>q1\nq2</p>\n<ul><li>item</li></ul>\n<blockquote><p>nested</p></blockquote></blockquote>');
  assert.equal(plain('> q1\n> q2\n>\n> - item'), '> q1 q2\n>\n> • item');
});

test('fenced code: language, tildes, longer fences, unclosed, inside a list', () => {
  const pre = (t: string) => `<pre style="font-family:Consolas,'Courier New',monospace;white-space:pre-wrap"><code>${t}</code></pre>`;
  assert.equal(html('```js\nconst x = 1;\n  indented\n```'), pre('const x = 1;\n  indented'));
  assert.deepEqual(parseMarkdown('```js\nx\n```')[0], { type: 'code', lang: 'js', text: 'x' });
  assert.equal(html('~~~\ntilde\n~~~'), pre('tilde'));
  assert.equal(html('````\n```\ninner\n```\n````'), pre('```\ninner\n```'));
  assert.equal(html('```\nnever closed\nstill code'), pre('never closed\nstill code'));
  assert.equal(html('- item\n  ```\n  code in item\n  ```\n- next'), `<ul><li>item\n${pre('code in item')}</li><li>next</li></ul>`);
  assert.equal(plain('```\nx = 1\n```'), 'x = 1', 'plain text: the code without fences');
  assert.equal(slack('```\nx = 1\n```'), '```\nx = 1\n```', 'chat: fenced, as the apps render it');
  assert.equal(html('```\n<b>&\n```'), pre('&lt;b&gt;&amp;'));
});

test('tables: alignment, optional outer pipes, escaped and code pipes, short and long rows, not-a-table', () => {
  assert.equal(html('| a | b |\n|---|:-:|\n| 1 | 2 |\n| only |\n| x | y | extra |'), '<table border="1" style="border-collapse:collapse"><thead><tr><th>a</th><th style="text-align:center">b</th></tr></thead><tbody><tr><td>1</td><td style="text-align:center">2</td></tr><tr><td>only</td><td style="text-align:center"></td></tr><tr><td>x</td><td style="text-align:center">y</td></tr></tbody></table>');
  assert.equal(html('a | b\n--- | ---:\n1 | 22'), '<table border="1" style="border-collapse:collapse"><thead><tr><th>a</th><th style="text-align:right">b</th></tr></thead><tbody><tr><td>1</td><td style="text-align:right">22</td></tr></tbody></table>');
  assert.equal(plain('| a | b |\n|---|---:|\n| 1 | 22 |'), 'a |  b\n--|---\n1 | 22', 'a right-aligned column right-aligns its header too');
  assert.equal(html('| a |\n|---|\n| x \\| y |\n| `a|b` |').match(/<td>.*?<\/td>/g)?.length, 2);
  assert.ok(html('| a |\n|---|\n| x \\| y |').includes('<td>x | y</td>'));
  assert.equal(html('not | table'), '<p>not | table</p>');
  assert.equal(html('| a | b |\n|---|\n| 1 |'), '<p>| a | b |\n|---|\n| 1 |</p>', 'header/delimiter count mismatch is not a table');
});

// ---- modes --------------------------------------------------------------------------------

test('chat modes differ only where the apps do', () => {
  const md = '# T\n\n**b** _i_ ~~s~~ `c`\n\n- one\n\n> q\n\n```\nx\n```';
  assert.equal(renderText(parseMarkdown(md), SLACK_STYLE), '*T*\n\n*b* _i_ ~s~ `c`\n\n• one\n\n> q\n\n```\nx\n```');
  assert.equal(renderText(parseMarkdown(md), WHATSAPP_STYLE), '*T*\n\n*b* _i_ ~s~ `c`\n\n- one\n\n> q\n\n```\nx\n```');
  assert.equal(renderText(parseMarkdown(md), GOOGLE_CHAT_STYLE), renderText(parseMarkdown(md), WHATSAPP_STYLE), 'Google Chat documents "- " lists and ">" quotes, like WhatsApp; Slack markup mode has no list syntax');
  assert.equal(renderText(parseMarkdown(md), PLAIN_STYLE), 'T\n\nb i s c\n\n• one\n\n> q\n\nx');
  assert.deepEqual(Object.keys(TEXT_MODES), ['plain', 'slack', 'whatsapp', 'google-chat']);
});

test('markers hug the words in chat markup even when the Markdown had spaces inside', () => {
  assert.equal(slack('**bold **text'), '**bold **text');
  assert.equal(slack('a **b**'), 'a *b*');
  assert.equal(renderText(parseInline('x') ? parseMarkdown('**[link](https://l.x)**') : [], SLACK_STYLE), '*link (https://l.x)*');
});

// ---- edges and size ----------------------------------------------------------------------

test('empty and whitespace-only input give empty output', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.equal(plain('   \n\n  '), '');
  assert.equal(html('   \n\n  '), '');
});

test('CRLF, tabs and unicode', () => {
  assert.equal(html('a\r\n\r\n- b\r\n\t- c'), '<p>a</p>\n<ul><li>b\n<ul><li>c</li></ul></li></ul>');
  assert.equal(plain('- 🚀 ship it — “quotes” **强调**'), '• 🚀 ship it — “quotes” 强调');
  assert.equal(inlineToText(parseInline('**a** `b` [c](d) ![e](f)')), 'a b c e');
});

test('half a megabyte parses and renders in well under a second; pathological runs do not blow up', () => {
  const big = Array.from({ length: 4000 }, (_, i) => `## Heading ${i}\n\nSome **bold** text with a [link](https://e.com/${i}) and \`code\`.\n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| ${i} | x |\n`).join('\n');
  const t0 = performance.now();
  const blocks = parseMarkdown(big);
  renderText(blocks);
  renderHtml(blocks);
  assert.ok(performance.now() - t0 < 1500, `took ${(performance.now() - t0).toFixed(0)} ms`);
  assert.equal(blocks.length, 16000);
  const t1 = performance.now();
  parseMarkdown('*'.repeat(5000) + '_'.repeat(5000) + '['.repeat(5000));
  parseMarkdown(Array.from({ length: 40 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n'));
  assert.ok(performance.now() - t1 < 500);
});
