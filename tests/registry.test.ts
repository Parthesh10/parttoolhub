/**
 * Enforces the SEO constraints from seo-rules.md at build time so a new tool
 * can't ship with an over-long title or a slug that has no page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS, relatedTools } from '../src/data/tools.ts';
import { CATEGORIES } from '../src/data/categories.ts';

const catSlugs = new Set(CATEGORIES.map((c) => c.slug));

test('every tool has a unique, URL-safe slug', () => {
  const seen = new Set<string>();
  for (const t of TOOLS) {
    assert.match(t.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad slug: ${t.slug}`);
    assert.ok(!seen.has(t.slug), `duplicate slug: ${t.slug}`);
    seen.add(t.slug);
  }
});

test('title under 60 chars, description under 155 chars', () => {
  for (const t of TOOLS) {
    assert.ok(t.title.length <= 60, `${t.slug}: title is ${t.title.length} chars`);
    assert.ok(t.description.length <= 155, `${t.slug}: description is ${t.description.length} chars`);
    assert.ok(t.description.length >= 70, `${t.slug}: description is too short to be useful`);
  }
  for (const c of CATEGORIES) {
    assert.ok(c.description.length <= 155, `${c.slug}: description is ${c.description.length} chars`);
  }
});

test('every tool belongs to a known category', () => {
  for (const t of TOOLS) assert.ok(catSlugs.has(t.category), `${t.slug}: unknown category ${t.category}`);
});

test('every category has at least one tool', () => {
  for (const c of CATEGORIES) assert.ok(TOOLS.some((t) => t.category === c.slug), `empty category: ${c.slug}`);
});

test('every registered tool has a page file', () => {
  for (const t of TOOLS) {
    const page = resolve(import.meta.dirname, '../src/pages/tools', `${t.slug}.astro`);
    assert.ok(existsSync(page), `missing page: src/pages/tools/${t.slug}.astro`);
  }
});

test('related tools returns 3–5 entries and never the tool itself', () => {
  for (const t of TOOLS) {
    const rel = relatedTools(t);
    assert.ok(rel.length >= 3 && rel.length <= 5, `${t.slug}: ${rel.length} related`);
    assert.ok(!rel.some((r) => r.slug === t.slug));
  }
});

// ---- seo-rules.md §11/§12: intent, review fields, spec ------------------

/** Normalise to lower-case words in order: "JSON Formatter Online" → "json formatter online". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

test('every tool has a unique intent, and no two intents are near-duplicates', () => {
  // Word order matters: "column to comma separated list" and its reverse are
  // different intents (seo-rules §3.2 allows mirror-image tools). What is not
  // allowed is one intent equalling, containing or being contained by another
  // ("json formatter" vs "json formatter online" would cannibalise each other).
  const seen: { slug: string; n: string }[] = [];
  for (const t of TOOLS) {
    assert.ok(t.intent && t.intent.trim().length >= 3, `${t.slug}: missing intent`);
    assert.equal(t.intent, t.intent.toLowerCase().trim(), `${t.slug}: intent should be lower-case searcher words`);
    const n = norm(t.intent);
    for (const prev of seen) {
      const overlap = n === prev.n || n.includes(prev.n) || prev.n.includes(n);
      assert.ok(!overlap, `${t.slug} ("${t.intent}") and ${prev.slug} ("${prev.n}") target overlapping intents`);
    }
    seen.push({ slug: t.slug, n });
  }
});

test('every tool records who reviewed it and when (ISO date, not in the future)', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const t of TOOLS) {
    assert.ok(t.reviewedBy && t.reviewedBy.trim().length > 1, `${t.slug}: missing reviewedBy`);
    assert.match(t.reviewedOn, /^\d{4}-\d{2}-\d{2}$/, `${t.slug}: reviewedOn must be YYYY-MM-DD`);
    assert.ok(!Number.isNaN(Date.parse(t.reviewedOn)), `${t.slug}: reviewedOn is not a real date`);
    assert.ok(t.reviewedOn <= today, `${t.slug}: reviewedOn ${t.reviewedOn} is in the future`);
  }
});

test('spec, where present, has a name and an https URL', () => {
  for (const t of TOOLS) {
    if (!t.spec) continue;
    assert.ok(t.spec.name.length > 2, `${t.slug}: spec name`);
    assert.match(t.spec.url, /^https:\/\//, `${t.slug}: spec url must be https`);
  }
});

test('the one-line summary under the <h1> is 25 words or fewer', () => {
  for (const t of TOOLS) {
    const words = t.short.trim().split(/\s+/).length;
    assert.ok(words <= 25, `${t.slug}: short is ${words} words`);
  }
});

test('every category has hub intro prose, not just cards', () => {
  for (const c of CATEGORIES) {
    assert.ok(c.intro.length >= 1 && c.intro.length <= 2, `${c.slug}: intro should be 1–2 paragraphs`);
    for (const p of c.intro) assert.ok(p.replace(/<[^>]+>/g, '').split(/\s+/).length >= 40, `${c.slug}: intro paragraph too thin`);
  }
});

// ---- Documentation stays in step with the registry -------------------------

test('README.md and CLAUDE.md name every category hub route', () => {
  const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');
  const claude = readFileSync(resolve(import.meta.dirname, '../CLAUDE.md'), 'utf8');
  for (const c of CATEGORIES) {
    assert.ok(readme.includes(`/${c.slug}`), `README.md does not mention /${c.slug} — update the URL structure section`);
    assert.ok(claude.includes(`/${c.slug}`), `CLAUDE.md does not mention /${c.slug} — update the category hub note`);
  }
});

test('the rules file referenced by CLAUDE.md exists', () => {
  const claude = readFileSync(resolve(import.meta.dirname, '../CLAUDE.md'), 'utf8');
  const m = claude.match(/Read `\.\.\/(seo-rules[^`]*)`/);
  assert.ok(m, 'CLAUDE.md must point at the rules file');
  assert.ok(existsSync(resolve(import.meta.dirname, '../..', m![1])), `CLAUDE.md points at ../${m![1]} which does not exist`);
});
