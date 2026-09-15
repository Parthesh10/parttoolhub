/**
 * Content gate over the production build (seo-rules.md §12). Scans dist/
 * for every tool page and checks the things that make a page "done":
 * exactly one <h1>, the required <h2> sections of §3.1, ≥ 3 FAQ entries, a
 * canonical tag, JSON-LD that parses and matches the registry, the trust line,
 * and none of the §3A forbidden phrases in the visible prose.
 *
 * Needs a build first: `npm run build && npm test`. Without dist/ the tests
 * are skipped with a note rather than failing, so `npm test` still works on a
 * fresh checkout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS, toolPath } from '../src/data/tools.ts';
import { CATEGORIES } from '../src/data/categories.ts';
import { SITE } from '../src/site.config.ts';

const dist = resolve(import.meta.dirname, '../dist');
const built = existsSync(dist);
const skip = built ? false : 'dist/ not found — run `npm run build` first';

const read = (route: string) => readFileSync(resolve(dist, `.${route}.html`), 'utf8');
/** Astro escapes text content; compare against the escaped form. */
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Text of an element ignoring the data-astro-cid-* attributes Astro adds to scoped markup. */
const inner = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

/** Text of one <h2> per match, tags stripped. */
const h2s = (html: string) => [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

/** Visible text: drop scripts/styles/JSON-LD and tags. */
const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

/** Every JSON-LD block on the page, parsed. */
const jsonLd = (html: string): Record<string, unknown>[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : [v];
  });

// seo-rules §3A item 2 — keep in sync with that list. Matched case-insensitively
// against visible prose only (not code samples' content is not separable here,
// so keep phrases that would never legitimately appear in a snippet).
const FORBIDDEN = [
  "in today's digital",
  'in the world of',
  "whether you're a",
  'whether you are a',
  'look no further',
  'welcome to',
  "it's important to note",
  'it is important to note',
  "it's worth noting",
  'it is worth noting',
  "it's essential to",
  'plays a crucial role',
  'a wide range of',
  'a variety of',
  'powerful',
  'seamless',
  'robust',
  'effortless',
  'cutting-edge',
  'comprehensive',
  'user-friendly',
  'hassle-free',
  'game-changer',
  'in conclusion',
  'by following these steps',
  'happy converting',
  "here's why:",
  'at its core',
  'ultimately,',
];

const REQUIRED_H2 = [
  { label: 'How to use', match: /^How to use/i },
  { label: 'Example', match: /^Example/i },
  // Output-only tools (the JWT decoder has no toggles) document the result panes instead.
  { label: 'Options explained (or Reading the result)', match: /^(Options explained|Reading the result)/i },
  { label: 'Edge cases and common errors', match: /^Edge cases and common errors/i },
  { label: 'FAQ', match: /FAQ$/i },
  { label: 'Related tools', match: /^Related tools/i },
];

for (const tool of TOOLS) {
  const route = toolPath(tool);

  test(`${route}: structure (h1, required sections, FAQ, canonical, trust line)`, { skip }, () => {
    const html = read(route);
    assert.equal(count(html, /<h1[\s>]/g), 1, 'exactly one <h1>');
    assert.deepEqual(inner(html, 'h1'), [esc(tool.name)], '<h1> is the registry name');

    const headings = h2s(html);
    for (const req of REQUIRED_H2) {
      assert.ok(headings.some((h) => req.match.test(h)), `missing <h2> "${req.label}" — have: ${headings.join(' | ')}`);
    }
    // §3.1 order: How to use precedes Example, which precedes Options/Edge cases, which precede FAQ.
    const idx = (re: RegExp) => headings.findIndex((h) => re.test(h));
    assert.ok(idx(/^How to use/) < idx(/^Example/), 'How to use should come before Example');
    assert.ok(idx(/^Edge cases/) < idx(/FAQ$/), 'Edge cases should come before the FAQ');

    assert.ok(count(html, /<ol class="steps"[^>]*>/g) === 1, 'one "How to use" list');
    const steps = count(html.slice(html.indexOf('<ol class="steps"'), html.indexOf('</ol>', html.indexOf('<ol class="steps"'))), /<li[\s>]/g);
    assert.ok(steps >= 3 && steps <= 5, `How to use has ${steps} steps (want 3–5)`);

    const faqCount = count(html, /<details[\s>]/g);
    assert.ok(faqCount >= 3 && faqCount <= 6, `FAQ has ${faqCount} entries (want 3–6)`);

    assert.ok(html.includes(`<link rel="canonical" href="${SITE.url}${route}">`), 'canonical tag matches the route');
    assert.equal(count(html, /<link rel="canonical"/g), 1, 'exactly one canonical');
    assert.ok(!/<meta name="robots" content="noindex/.test(html), 'tool pages must be indexable');

    assert.ok(html.includes('Runs entirely in your browser'), 'trust line present');
    assert.ok(new RegExp(`<time datetime="${tool.reviewedOn}"[^>]*>`).test(html), 'visible review date matches reviewedOn');
    assert.ok(html.includes(`>${tool.reviewedBy}</a>`), 'review line names the maintainer');
    if (tool.spec) assert.ok(html.includes(`href="${tool.spec.url}"`), 'spec is linked');

    // Every tool page links to its hub (breadcrumb) and at least 3 other tools (related section).
    const cat = CATEGORIES.find((c) => c.slug === tool.category)!;
    assert.ok(html.includes(`href="/${cat.slug}"`), 'links to its category hub');
    const otherToolLinks = new Set([...html.matchAll(/href="(\/tools\/[a-z0-9-]+)"/g)].map((m) => m[1]).filter((p) => p !== route));
    assert.ok(otherToolLinks.size >= 3, `links to ${otherToolLinks.size} other tools (want ≥ 3)`);
  });

  test(`${route}: structured data is valid and matches the page`, { skip }, () => {
    const html = read(route);
    const ld = jsonLd(html);
    const types = ld.map((o) => o['@type']);
    for (const t of ['WebSite', 'Person', 'WebPage', 'BreadcrumbList', 'FAQPage']) {
      assert.ok(types.includes(t), `missing ${t} JSON-LD — have ${types.join(', ')}`);
    }
    // Type/property allowlists (no HowTo, no SoftwareApplication, no ratings) live in structured-data.test.ts.

    const page = ld.find((o) => o['@type'] === 'WebPage')!;
    assert.equal(page.name, tool.name, 'WebPage.name must equal the visible <h1>');
    assert.equal(page.url, `${SITE.url}${route}`);
    assert.equal(page['@id'], page.url, 'WebPage @id is its canonical URL');
    assert.equal(page.description, tool.description);
    assert.equal(page.dateModified, tool.reviewedOn, 'dateModified is the visible review date');
    assert.deepEqual((page.author as { '@id': string })['@id'], `${SITE.url}/#author`);
    assert.deepEqual((page.isPartOf as { '@id': string })['@id'], `${SITE.url}/#website`);

    const person = ld.find((o) => o['@type'] === 'Person')!;
    assert.equal(person.name, SITE.author);

    const faq = ld.find((o) => o['@type'] === 'FAQPage')!;
    const questions = (faq.mainEntity as { name: string }[]).map((q) => q.name);
    assert.equal(questions.length, count(html, /<details[\s>]/g), 'FAQPage entries equal visible <details>');
    const summaries = inner(html, 'summary');
    for (const q of questions) assert.ok(summaries.includes(esc(q)), `FAQ question not visible on page: ${q}`);

    const crumbs = ld.find((o) => o['@type'] === 'BreadcrumbList')!;
    const items = crumbs.itemListElement as { name: string }[];
    assert.deepEqual(items.map((i) => i.name), ['Home', CATEGORIES.find((c) => c.slug === tool.category)!.name, tool.name]);
  });

  test(`${route}: no forbidden phrases (seo-rules §3A)`, { skip }, () => {
    const text = visibleText(read(route)).toLowerCase();
    for (const phrase of FORBIDDEN) {
      assert.ok(!text.includes(phrase), `forbidden phrase "${phrase}" on ${route}`);
    }
  });

  test(`${route}: every build-time computed value rendered something (no empty quotes or code)`, { skip }, () => {
    // Worked examples and quoted error messages are computed from the engine in the page's
    // frontmatter; a wrong helper (e.g. parseJson where formatJson was meant) renders “” or
    // <code></code>, which reads as a claim with the evidence missing.
    const html = read(route);
    assert.ok(!/“”|„“|<code[^>]*><\/code>|<pre[^>]*><code[^>]*><\/code><\/pre>/.test(html), 'an empty computed value was rendered');
  });
}

test('category hubs have intro prose, one <h1>, and list every tool in the category', { skip }, () => {
  for (const c of CATEGORIES) {
    const html = read(`/${c.slug}`);
    assert.equal(count(html, /<h1[\s>]/g), 1, `${c.slug}: one <h1>`);
    for (const t of TOOLS.filter((t) => t.category === c.slug)) {
      assert.ok(html.includes(`href="${toolPath(t)}"`), `${c.slug}: missing link to ${t.slug}`);
    }
    const text = visibleText(html);
    assert.ok(text.split(' ').length >= 150, `${c.slug}: hub reads thin (${text.split(' ').length} words)`);
  }
});

test('supporting pages exist, are indexable, and name the maintainer where they should', { skip }, () => {
  for (const route of ['/about', '/contact', '/privacy-policy', '/terms']) {
    const html = read(route);
    assert.equal(count(html, /<h1[\s>]/g), 1, `${route}: one <h1>`);
    assert.ok(!/noindex/.test(html), `${route}: should be indexable`);
  }
  assert.ok(read('/about').includes(SITE.author), 'about page names the maintainer');
  // Public contact is deliberately via GitHub issues, not a displayed email
  // (maintainer's choice, seo-rules.md §4A) — assert a real reachable channel exists.
  assert.ok(read('/contact').includes(`${SITE.github}/issues`), 'contact page links the GitHub issue tracker');
  assert.ok(/noindex/.test(read('/404')), '404 is noindex');
});

test('social preview image exists and every page points at it with dimensions', { skip }, () => {
  assert.ok(existsSync(resolve(dist, `.${SITE.ogImage}`)), `${SITE.ogImage} missing from the build`);
  for (const route of ['/index', '/about', ...TOOLS.map(toolPath)]) {
    const html = read(route);
    assert.ok(html.includes(`property="og:image" content="${SITE.url}${SITE.ogImage}"`), `${route}: og:image`);
    assert.ok(html.includes('property="og:image:width" content="1200"'), `${route}: og:image:width`);
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'), `${route}: twitter card`);
  }
});

test('sitemap lists every indexable page with the canonical domain and no 404', { skip }, () => {
  const xml = readFileSync(resolve(dist, 'sitemap-0.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const t of TOOLS) assert.ok(locs.includes(`${SITE.url}${toolPath(t)}`), `sitemap missing ${t.slug}`);
  for (const c of CATEGORIES) assert.ok(locs.includes(`${SITE.url}/${c.slug}`), `sitemap missing /${c.slug}`);
  for (const p of ['/', '/about', '/contact', '/privacy-policy', '/terms']) assert.ok(locs.includes(`${SITE.url}${p}`), `sitemap missing ${p}`);
  assert.ok(!locs.some((l) => l.includes('/404')), 'sitemap must not include the 404 page');
  assert.ok(locs.every((l) => l.startsWith(SITE.url)), 'every sitemap URL is on the canonical domain');
  for (const t of TOOLS) {
    assert.ok(xml.includes(`<loc>${SITE.url}${toolPath(t)}</loc><lastmod>${tool_lastmod(t.reviewedOn)}`), `${t.slug}: lastmod should be its reviewedOn`);
  }
});

/** @astrojs/sitemap writes lastmod as an ISO datetime; we set it from the YYYY-MM-DD review date. */
function tool_lastmod(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toISOString();
}

test('every internal link in the build resolves to a built page or public file', { skip }, () => {
  const pages = ['/', '/about', '/contact', '/privacy-policy', '/terms', '/404', ...CATEGORIES.map((c) => `/${c.slug}`), ...TOOLS.map(toolPath)];
  const exists = (href: string) => {
    const path = href.replace(/[#?].*$/, '');
    if (path === '' || path === '/') return true;
    return existsSync(resolve(dist, `.${path}.html`)) || existsSync(resolve(dist, `.${path}`));
  };
  for (const route of pages) {
    const html = read(route === '/' ? '/index' : route);
    const internal = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('//'));
    for (const href of internal) assert.ok(exists(href), `${route}: broken internal link ${href}`);
  }
});

test('every <title> is 60 characters or fewer after the brand suffix rule', { skip }, () => {
  const routes = ['/index', '/about', '/contact', '/privacy-policy', '/terms', ...CATEGORIES.map((c) => `/${c.slug}`), ...TOOLS.map(toolPath)];
  for (const route of routes) {
    const raw = read(route).match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    const title = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    assert.ok(title.length > 0 && title.length <= 60, `${route}: <title> is ${title.length} chars: "${title}"`);
  }
});

// ---- Site-wide metadata: every indexable page, not just tools ---------------

const INDEXABLE = ['/index', '/about', '/contact', '/privacy-policy', '/terms', ...CATEGORIES.map((c) => `/${c.slug}`), ...TOOLS.map(toolPath)];
const publicPath = (route: string) => (route === '/index' ? '/' : route);
const attr = (html: string, re: RegExp) => html.match(re)?.[1] ?? '';
const unescape = (t: string) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test('every indexable page has one canonical, matching og:url, a sized description, OG/Twitter tags, lang and viewport', { skip }, () => {
  for (const route of INDEXABLE) {
    const html = read(route);
    const expected = `${SITE.url}${publicPath(route)}`;
    assert.equal(count(html, /<link rel="canonical"/g), 1, `${route}: one canonical`);
    assert.ok(html.includes(`<link rel="canonical" href="${expected}">`), `${route}: canonical is ${expected}`);
    assert.equal(attr(html, /property="og:url" content="([^"]*)"/), expected, `${route}: og:url equals canonical`);
    const desc = unescape(attr(html, /<meta name="description" content="([^"]*)"/));
    assert.ok(desc.length >= 50 && desc.length <= 160, `${route}: meta description is ${desc.length} chars`);
    assert.equal(unescape(attr(html, /property="og:description" content="([^"]*)"/)), desc, `${route}: og:description equals meta description`);
    assert.ok(attr(html, /property="og:title" content="([^"]*)"/).length > 0, `${route}: og:title`);
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'), `${route}: twitter card`);
    assert.ok(/<html lang="en"[\s>]/.test(html), `${route}: lang`);
    assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), `${route}: viewport`);
    assert.ok(!/<meta name="robots" content="noindex/.test(html), `${route}: must be indexable`);
    assert.equal(count(html, /<main[\s>]/g), 1, `${route}: one <main>`);
    assert.equal(count(html, /<h1[\s>]/g), 1, `${route}: one <h1>`);
    assert.ok(html.includes('class="skip-link"'), `${route}: skip link`);
  }
});

test('every indexable page carries WebSite + Person JSON-LD naming the maintainer', { skip }, () => {
  for (const route of INDEXABLE) {
    const ld = jsonLd(read(route));
    const types = ld.map((o) => o['@type']);
    assert.ok(types.includes('WebSite'), `${route}: WebSite schema`);
    const person = ld.find((o) => o['@type'] === 'Person') as Record<string, unknown> | undefined;
    assert.ok(person, `${route}: Person schema`);
    assert.equal(person!.name, SITE.author, `${route}: Person is the maintainer`);
    assert.equal(person!['@id'], `${SITE.url}/#author`);
  }
});

test('breadcrumb schema URLs resolve to built pages', { skip }, () => {
  for (const t of TOOLS) {
    const ld = jsonLd(read(toolPath(t)));
    const crumbs = ld.find((o) => o['@type'] === 'BreadcrumbList')!;
    for (const item of crumbs.itemListElement as { item?: string }[]) {
      if (!item.item) continue;
      const path = new URL(item.item).pathname;
      const file = path === '/' ? 'index.html' : `.${path}.html`;
      assert.ok(existsSync(resolve(dist, file)), `${t.slug}: breadcrumb item ${item.item} has no built page`);
    }
  }
});

test('sitemap and build output agree: every built page is listed once and nothing else is', { skip }, () => {
  const xml = readFileSync(resolve(dist, 'sitemap-0.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, 'no duplicate sitemap URLs');
  const built = new Set(INDEXABLE.map((r) => `${SITE.url}${publicPath(r)}`));
  assert.deepEqual(new Set(locs), built, 'sitemap URLs must equal the set of indexable built pages');
  assert.ok(readFileSync(resolve(dist, 'sitemap-index.xml'), 'utf8').includes(`${SITE.url}/sitemap-0.xml`), 'sitemap index points at the canonical domain');
});

test('robots.txt allows all crawlers and points at the sitemap on the canonical domain', { skip }, () => {
  const robots = readFileSync(resolve(dist, 'robots.txt'), 'utf8');
  assert.match(robots, /User-agent: \*\s+Allow: \//, 'allow everything');
  assert.ok(!/Disallow: \/\S/.test(robots), 'no path is disallowed');
  assert.ok(robots.includes(`Sitemap: ${SITE.url}/sitemap-index.xml`), 'sitemap line');
  assert.ok(existsSync(resolve(dist, 'ads.txt')), 'ads.txt is published');
});

test('llms.txt lists every registered tool, linked to its canonical URL, grouped by category', { skip }, () => {
  const llms = readFileSync(resolve(dist, 'llms.txt'), 'utf8');
  assert.ok(llms.startsWith(`# ${SITE.name}`), 'starts with the site name as an H1');
  assert.ok(llms.includes('/llms-full.txt'), 'points to the full-content companion file');
  for (const c of CATEGORIES) assert.ok(llms.includes(`## ${c.name}`), `llms.txt missing the ${c.name} section`);
  for (const t of TOOLS) {
    assert.ok(llms.includes(`(${SITE.url}${toolPath(t)})`), `llms.txt missing a link to ${t.slug}`);
    assert.ok(llms.includes(t.short), `llms.txt missing ${t.slug}'s description`);
  }
});

test('llms-full.txt inlines every tool\'s real page content (scripts/make-llms-full.mts), not just a link', { skip }, () => {
  const path = resolve(dist, 'llms-full.txt');
  assert.ok(existsSync(path), 'dist/llms-full.txt was not generated — check `npm run build`\'s post-build step ran');
  const full = readFileSync(path, 'utf8');
  assert.ok(full.startsWith(`# ${SITE.name}`), 'starts with the site name as an H1');
  assert.ok(full.includes('/llms.txt'), 'points back to the short index for crawlers that only want that');
  for (const t of TOOLS) {
    assert.ok(full.includes(`### ${t.name}`), `llms-full.txt missing a heading for ${t.slug}`);
    assert.ok(full.includes(`URL: ${SITE.url}${toolPath(t)}`), `llms-full.txt missing ${t.slug}'s canonical URL`);
    assert.ok(full.includes('**How to use**'), `llms-full.txt missing How-to-use content near ${t.slug}`);
  }
  // The "How to use" section must appear exactly once per tool — a regression here previously
  // duplicated it (the <section aria-labelledby="how-to-use"> strip silently failed to match
  // Astro's scoped attribute, so the same steps were emitted twice; see CLAUDE.md).
  const howToUseCount = (full.match(/\*\*How to use\*\*/g) ?? []).length;
  assert.equal(howToUseCount, TOOLS.length, 'exactly one "How to use" per tool, not duplicated');
  // No unconverted HTML structure should leak through the html-to-markdown pass. Checked outside
  // backtick spans, since the HTML-to-Markdown and Markdown-to-Google-Docs tool pages legitimately
  // quote raw tags like `<li>` as inline code when explaining HTML syntax — that's real content,
  // not a leak.
  const outsideCode = full.replace(/`[^`\n]*`/g, '').replace(/```[\s\S]*?```/g, '');
  assert.ok(!/<div class="ad-slot/.test(outsideCode), 'ad-slot markup leaked into llms-full.txt');
  assert.ok(!/<\/?(?:section|article)[\s>]/.test(outsideCode), 'raw block-level HTML leaked into llms-full.txt');
});
