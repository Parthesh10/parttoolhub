/**
 * Enforces the SEO constraints from seo-rules.md at build time so a new tool
 * can't ship with an over-long title or a slug that has no page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
