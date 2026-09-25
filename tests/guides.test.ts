/**
 * Source-level rules for src/content/guides/*.md (seo-rules §3B). Runs without a build, so a
 * guide that could never ship fails here first; tests/content.test.ts then checks the built
 * pages. Astro's schema in src/content.config.ts validates front-matter types at build time;
 * this file covers the rules a schema cannot express.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGuideFiles } from '../src/data/guide-files.ts';
import { GUIDE_TOPICS } from '../src/data/guides.ts';
import { TOOLS } from '../src/data/tools.ts';

const guides = readGuideFiles();
const published = guides.filter((g) => !g.draft);
const todayUtc = new Date().toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
/** The Markdown body with fenced and inline code removed, i.e. the prose a reader sees. */
const prose = (body: string) => body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

test('guide file names are lowercase-hyphenated slugs', () => {
  for (const g of guides) assert.match(g.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${g.file}: rename to a lowercase, hyphenated slug`);
});

test('every guide has a title, a known topic, valid dates and known tools', () => {
  const topics = new Set<string>(GUIDE_TOPICS.map((t) => t.slug));
  const tools = new Set(TOOLS.map((t) => t.slug));
  for (const g of guides) {
    assert.ok(g.title.length >= 10 && g.title.length <= 60, `${g.slug}: title must be 10-60 characters (is ${g.title.length})`);
    assert.ok(topics.has(g.topic), `${g.slug}: unknown topic "${g.topic}" (see GUIDE_TOPICS in src/data/guides.ts)`);
    assert.ok(isDate(g.publishedOn), `${g.slug}: publishedOn must be YYYY-MM-DD`);
    if (g.updatedOn) {
      assert.ok(isDate(g.updatedOn), `${g.slug}: updatedOn must be YYYY-MM-DD`);
      assert.ok(g.updatedOn >= g.publishedOn, `${g.slug}: updatedOn is before publishedOn`);
    }
    for (const slug of g.tools) assert.ok(tools.has(slug), `${g.slug}: unknown tool "${slug}" in tools`);
  }
});

test('titles are unique across guides and tools', () => {
  const seen = new Map<string, string>(TOOLS.map((t) => [t.title.toLowerCase(), `tool ${t.slug}`]));
  for (const g of guides) {
    const key = g.title.toLowerCase();
    assert.ok(!seen.has(key), `${g.slug}: title duplicates ${seen.get(key)}`);
    seen.set(key, `guide ${g.slug}`);
  }
});

test('a guide body starts at ## (the page supplies the only <h1>)', () => {
  for (const g of guides) {
    assert.ok(!/^#\s/m.test(prose(g.body)), `${g.slug}: remove the "# " heading; the title in the front matter is the <h1>`);
  }
});

test('published guides: dated today or earlier, no placeholders, no em dashes', () => {
  for (const g of published) {
    // Compared with the UTC date, like reviewedOn in registry.test.ts (IST runs 5.5 h ahead).
    assert.ok(g.publishedOn <= todayUtc, `${g.slug}: publishedOn ${g.publishedOn} is in the future (UTC today is ${todayUtc})`);
    if (g.updatedOn) assert.ok(g.updatedOn <= todayUtc, `${g.slug}: updatedOn is in the future`);
    assert.ok(!/TODO\(maintainer\)|MAINTAINER CHECKLIST/.test(g.body), `${g.slug}: remove the maintainer checklist comment and fill the TODO(maintainer) section before publishing`);
    assert.ok(!prose(g.body).includes('—'), `${g.slug}: em dash in the prose (seo-rules §3A); use a period, comma, colon or parentheses`);
  }
});
