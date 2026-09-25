/**
 * Structured-data lint over the production build (seo-rules.md §2).
 *
 * Why this exists: a Semrush site audit on 2026-09-14 reported every tool
 * page's `SoftwareApplication` item as invalid — Google's Software App rich
 * result requires an `aggregateRating` or `review`, which this site will never
 * fabricate, and `browserRequirements` is not a property Google recognises on
 * it. The item earned nothing and cost 20 errors. This test makes that class
 * of mistake impossible to ship again:
 *
 *  - every JSON-LD object's @type is on an allowlist of types that carry no
 *    rich-result requirement the site cannot honestly meet;
 *  - every property on it is one schema.org defines for that type and Google
 *    reads, and the required ones are present;
 *  - no rating, review, offer or price property appears anywhere, at any depth;
 *  - `{ "@id": … }` references resolve to an entity on the same page;
 *  - every URL that points at this site resolves to a built page;
 *  - dates are ISO YYYY-MM-DD; list positions are 1..n.
 *
 * To add a schema type: add it to TYPES below *after* reading its Google
 * Search Central page — if the rich result requires data the page cannot show
 * (ratings, prices, dates, durations), do not add the type.
 *
 * Needs a build first: `npm run build && npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SITE } from '../src/site.config.ts';

const dist = resolve(import.meta.dirname, '../dist');
const skip = existsSync(dist) ? false : 'dist/ not found — run `npm run build` first';

/** Property allowlist per type. `@context`, `@type` and `@id` are always allowed. */
const TYPES: Record<string, { required: string[]; allowed: string[] }> = {
  WebSite: { required: ['name', 'url'], allowed: ['description', 'inLanguage', 'author'] },
  Person: { required: ['name'], allowed: ['url', 'sameAs'] },
  WebPage: { required: ['name', 'url', 'dateModified', 'author'], allowed: ['description', 'inLanguage', 'isAccessibleForFree', 'isPartOf'] },
  CollectionPage: { required: ['name', 'url', 'mainEntity'], allowed: ['description', 'inLanguage', 'isPartOf'] },
  // Guides (/guides/<slug>). Google's Article markup has no required properties and no rating or
  // price requirement; headline, dates, author and image are its recommended ones, all of which the
  // page shows (headline = <h1>, dates = the byline, author = the named maintainer).
  Article: {
    required: ['headline', 'url', 'datePublished', 'dateModified', 'author'],
    allowed: ['description', 'inLanguage', 'publisher', 'image', 'isAccessibleForFree', 'isPartOf'],
  },
  ItemList: { required: ['itemListElement'], allowed: [] },
  ListItem: { required: ['position', 'name'], allowed: ['item', 'url'] },
  BreadcrumbList: { required: ['itemListElement'], allowed: [] },
  FAQPage: { required: ['mainEntity'], allowed: [] },
  Question: { required: ['name', 'acceptedAnswer'], allowed: [] },
  Answer: { required: ['text'], allowed: [] },
};
const ALWAYS = new Set(['@context', '@type', '@id']);

/**
 * Types that are banned outright, with the reason, so the failure message can
 * say why rather than only "unknown type". Anything else not in TYPES fails too.
 */
const BANNED: Record<string, string> = {
  HowTo: 'deprecated by Google in 2023 (seo-rules §2)',
  SoftwareApplication: 'Google requires aggregateRating or review for its rich result; the site will not fake a rating',
  WebApplication: 'same rich-result rules as SoftwareApplication',
  MobileApplication: 'same rich-result rules as SoftwareApplication',
  VideoGame: 'same rich-result rules as SoftwareApplication',
  Product: 'requires offers/review/rating; nothing here is a product',
  Offer: 'nothing on the site is for sale, so a price is a claim the page cannot show',
  Review: 'no reviews exist; a self-written one is a spam signal',
  AggregateRating: 'no user ratings exist; a fabricated one is a spam signal',
  Rating: 'no user ratings exist',
  Recipe: 'not a recipe site',
  Event: 'no events',
  Course: 'not a course',
  JobPosting: 'no jobs',
  LocalBusiness: 'not a local business',
  Organization: 'the maintainer is a Person (seo-rules §4A); keep one author entity',
};

/** Properties that must never appear at any depth — each is a claim the page cannot back. */
const BANNED_PROPS = ['aggregateRating', 'review', 'reviews', 'ratingValue', 'ratingCount', 'reviewCount', 'reviewRating', 'offers', 'price', 'priceCurrency'];

type Node = Record<string, unknown>;
const isObj = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every HTML page in the build, as `[route, html]`. */
function pages(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(resolve(dir, e.name), `${prefix}/${e.name}`);
      else if (e.name.endsWith('.html')) out.push([`${prefix}/${e.name.replace(/\.html$/, '')}`, readFileSync(resolve(dir, e.name), 'utf8')]);
    }
  };
  walk(dist, '');
  return out;
}

/** Every top-level JSON-LD object on a page, parsed. Throws on malformed JSON. */
function blocks(html: string): Node[] {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const v = JSON.parse(m[1]) as unknown;
    return (Array.isArray(v) ? v : [v]) as Node[];
  });
}

/** Depth-first over every object in a block, with a JSON-pointer-ish path for messages. */
function* objects(node: unknown, path = '$'): Generator<[Node, string]> {
  if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) yield* objects(v, `${path}[${i}]`);
  } else if (isObj(node)) {
    yield [node, path];
    for (const [k, v] of Object.entries(node)) yield* objects(v, `${path}.${k}`);
  }
}

/** A site URL (or the site-relative path in it) resolves to a page or file in dist/. */
function builtPathExists(url: string): boolean {
  const u = new URL(url);
  const path = u.pathname;
  if (path === '/' || path === '') return true;
  return existsSync(resolve(dist, `.${path}.html`)) || existsSync(resolve(dist, `.${path}`));
}

test('every page: JSON-LD parses, has the schema.org context, and uses only allowlisted types with valid properties', { skip }, () => {
  for (const [route, html] of pages()) {
    const top = blocks(html);
    assert.ok(top.length > 0, `${route}: no JSON-LD`);
    for (const b of top) assert.equal(b['@context'], 'https://schema.org', `${route}: top-level block without @context`);

    const ids = new Set<string>();
    const refs: [string, string][] = [];
    for (const [obj, path] of objects(top)) {
      const type = obj['@type'];
      if (type === undefined) {
        // A bare reference: { "@id": "…" } and nothing else.
        assert.deepEqual(Object.keys(obj), ['@id'], `${route}: ${path} has no @type and is not a pure @id reference`);
        refs.push([obj['@id'] as string, path]);
        continue;
      }
      assert.equal(typeof type, 'string', `${route}: ${path} @type must be a single string (no multi-typed entities)`);
      const t = type as string;
      if (t in BANNED) assert.fail(`${route}: ${path} uses banned type ${t} — ${BANNED[t]}`);
      const spec = TYPES[t];
      assert.ok(spec, `${route}: ${path} uses type ${t}, which is not in the allowlist — add it to tests/structured-data.test.ts deliberately, after checking Google's rich-result requirements for it`);
      if (typeof obj['@id'] === 'string') ids.add(obj['@id']);

      for (const key of Object.keys(obj)) {
        if (ALWAYS.has(key)) continue;
        assert.ok(spec.required.includes(key) || spec.allowed.includes(key), `${route}: ${path} — property "${key}" is not allowed on ${t}`);
        assert.ok(!BANNED_PROPS.includes(key), `${route}: ${path} — "${key}" is banned (seo-rules §2: no ratings, reviews, offers or prices)`);
      }
      for (const key of spec.required) {
        const v = obj[key];
        assert.ok(v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0), `${route}: ${path} — ${t} is missing required "${key}"`);
      }

      // Value-level checks for the properties that carry claims.
      for (const key of ['dateModified', 'datePublished']) {
        if (key in obj) {
          assert.match(String(obj[key]), /^\d{4}-\d{2}-\d{2}$/, `${route}: ${path}.${key} must be YYYY-MM-DD`);
          assert.ok(!Number.isNaN(Date.parse(String(obj[key]))), `${route}: ${path}.${key} is not a real date`);
        }
      }
      for (const key of ['url', 'item', '@id']) {
        const v = obj[key];
        if (typeof v === 'string' && v.startsWith(SITE.url)) {
          assert.ok(builtPathExists(v), `${route}: ${path}.${key} = ${v} does not resolve to a built page`);
        }
      }
      if (t === 'ItemList' || t === 'BreadcrumbList') {
        const items = obj.itemListElement as Node[];
        assert.ok(Array.isArray(items) && items.length > 0, `${route}: ${path} has no items`);
        items.forEach((it, i) => assert.equal(it.position, i + 1, `${route}: ${path} positions must run 1..n`));
      }
      if (t === 'Answer') assert.ok(String(obj.text).trim().split(/\s+/).length >= 10, `${route}: ${path} answer is too short to be an answer`);
    }
    for (const [id, path] of refs) {
      assert.ok(ids.has(id), `${route}: ${path} references @id ${id}, which no entity on this page defines`);
    }
  }
});

test('every page carries exactly one WebSite and one Person, and at most one page-level entity', { skip }, () => {
  for (const [route, html] of pages()) {
    const top = blocks(html);
    const count = (t: string) => top.filter((b) => b['@type'] === t).length;
    assert.equal(count('WebSite'), 1, `${route}: one WebSite`);
    assert.equal(count('Person'), 1, `${route}: one Person`);
    assert.ok(count('WebPage') + count('CollectionPage') + count('Article') <= 1, `${route}: more than one page entity`);
    const site = top.find((b) => b['@type'] === 'WebSite')!;
    assert.equal(site['@id'], `${SITE.url}/#website`);
    const person = top.find((b) => b['@type'] === 'Person')!;
    assert.equal(person['@id'], `${SITE.url}/#author`);
  }
});

test('no JSON-LD anywhere in the build mentions a rating, review, offer or price, even as text', { skip }, () => {
  // Belt and braces over the property check above: catches a banned word smuggled in as a
  // nested key the walker did not reach (a malformed object) or a future serializer change.
  for (const [route, html] of pages()) {
    for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const p of BANNED_PROPS) assert.ok(!m[1].includes(`"${p}"`), `${route}: JSON-LD contains "${p}"`);
    }
  }
});

test('the source never emits a banned schema type', () => {
  // Source-level, so it runs without a build and points at the file to fix.
  const src = resolve(import.meta.dirname, '../src');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : /\.(astro|ts)$/.test(e.name) ? [resolve(dir, e.name)] : []));
  for (const f of walk(src)) {
    const s = readFileSync(f, 'utf8');
    for (const t of Object.keys(BANNED)) {
      assert.ok(!new RegExp(`'@type':\\s*'${t}'`).test(s), `${f} emits @type ${t} — ${BANNED[t]}`);
    }
  }
});
