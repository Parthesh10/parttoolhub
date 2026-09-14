# PartToolHub

A multi-tool site of fast, private, browser-only converters, text tools and encoders, built with
[Astro](https://astro.build). Every tool runs client-side — nothing pasted into a tool is ever uploaded.

Design goals: static HTML, near-zero JavaScript per page, strong on-page SEO, AdSense-ready.
Architecture and content rules for this project are defined in `../seo-rules.md` (one level up)
and this README should stay consistent with it as the site grows.

## Commands

| Command           | What it does                                          |
| ----------------- | ------------------------------------------------------ |
| `npm install`     | Install dependencies                                  |
| `npm run dev`     | Start the dev server at `http://localhost:4321`       |
| `npm test`        | Run engine + registry unit tests (Node's test runner) |
| `npm run build`   | Type-check (`astro check`) and build to `./dist/`     |
| `npm run preview` | Serve the production build locally                    |

## URL structure

- `/` — full tool directory, grouped by category
- `/<category>` — one hub page per category (`/converters`, `/text-tools`, `/encoders`,
  `/generators`), generated from `src/data/categories.ts` by `src/pages/[category].astro`
- `/tools/<slug>` — one page per tool. Every tool is reachable in at most 2 clicks from home
  (home → category hub → tool, or directly from the home directory).

The header shows only **Home** + a **Tools** dropdown of categories — never the full tool list — to
keep the content-to-clutter ratio high as the tool count grows. The footer lists a few tools per
category plus legal pages.

## Project layout

```
src/
  site.config.ts          ← brand, domain, AdSense IDs, GA4 ID (edit this first)
  data/
    categories.ts         ← category taxonomy (slug, name, description, blurb)
    tools.ts               ← registry of every tool: slug, title, description, category, features
  lib/                     ← pure conversion engines, one per tool family, no DOM — unit tested
    list-convert.ts         column ↔ comma-separated list
    json-format.ts          JSON format/minify/validate with line:column errors
    python-dict.ts          Python literal → JSON (and back)
    title-case.ts           title/sentence/upper/lower/APA/Chicago/AP/MLA
    text-clean.ts            AI text cleanup (Markdown, dashes, invisible chars, citations)
    dedupe-lines.ts          duplicate-line removal
    jwt-decode.ts            JWT header/payload/claims decoding (no verification)
    encoding.ts              Base64 and URL/percent encode-decode
    timestamp.ts             Unix timestamp ↔ date/time, explicit UTC/local interpretation
    csv-json.ts              CSV ↔ JSON (RFC 4180 quoting)
    case-convert.ts          camelCase/PascalCase/snake_case/CONSTANT_CASE/kebab-case/dot.case
    color-convert.ts         HEX/RGB/HSL parsing, conversion, WCAG contrast
    base-convert.ts          binary/octal/decimal/hex (BigInt, exact past 2^53)
    uuid-generate.ts         UUID v4/v7 generation (Web Crypto API)
  analytics.d.ts          ← type of window.pth, the site's one analytics entry point
  layouts/
    Base.astro             ← <head>: canonical/OG/Twitter/JSON-LD, header, footer, ad + GA loaders,
                              window.pth.track, tool_view and delegated navigation_click
    ToolLayout.astro        ← shared tool-page shell: breadcrumbs, hero, ad slots, FAQ, related tools
  components/
    Header.astro, Footer.astro, Breadcrumbs.astro, Faq.astro, AdSlot.astro, RelatedTools.astro
    ColumnToListTool.astro / ListToColumnTool.astro   ← the original two tools
    tools/                  ← one <Name>Tool.astro + <name>.client.ts pair per newer tool
  pages/
    index.astro             ← home directory
    [category].astro        ← category hub (getStaticPaths from data/categories.ts)
    tools/<slug>.astro       ← one file per tool: intro copy, worked example, FAQ, uses ToolLayout
    about.astro, contact.astro, privacy-policy.astro, terms.astro, 404.astro
public/
  robots.txt, ads.txt, favicon.svg, og-default.png
scripts/
  make-og-image.mjs         ← regenerates / crops the social preview image (not part of the build)
docs/
  ANALYTICS.md              ← GA4 architecture, event taxonomy, privacy rules, how to instrument a tool
tests/
  *.test.ts                 ← one file per lib module
  analytics.test.ts         ← every tool script instrumented, static PII guard on track() calls,
                               single GA init, event names ↔ docs/ANALYTICS.md
  registry.test.ts          ← enforces the SEO rules on data/tools.ts and data/categories.ts:
                               title < 60 chars, description < 155 chars, unique slugs and intents,
                               review fields, every tool has a page file and a real category
  content.test.ts           ← scans dist/ after a build: required sections and order, one <h1>,
                               canonical + OG on every page, JSON-LD matches the page and registry,
                               sitemap ↔ build parity, robots, forbidden phrases, titles, link check
```

## Analytics

One GA4 tracker, initialised once in `src/layouts/Base.astro`, production builds only (`npm run dev`
logs events to the console instead). Tool scripts report usage through `window.pth.track(...)` with
non-PII parameters only — slugs, action names, option ids, size buckets, error categories; never the
text a visitor typed. The event taxonomy, conversions, privacy rules and the recipe for instrumenting
a new tool are in [`docs/ANALYTICS.md`](docs/ANALYTICS.md); `tests/analytics.test.ts` keeps that
document and the code in step.

## SEO & content rules baked into the structure

- **Per-page metadata**: `ToolLayout` derives `<title>`, `<meta description>`, canonical URL, OG/Twitter
  tags and `SoftwareApplication` + `FAQPage` + `BreadcrumbList` JSON-LD from the tool's registry entry —
  an individual page file only supplies unique content (intro paragraphs, one worked example, FAQ).
- **Content depth**: every tool page has "How to use" steps, an explanatory section, a worked example
  generated from the engine at build time, "Options explained", "Edge cases and common errors", code
  equivalents where relevant, 3–6 FAQ entries, and a "Last reviewed" line. `tests/content.test.ts`
  checks all of that against the built HTML; `tests/registry.test.ts` checks the registry fields.
- **Ads**: `AdSlot` renders nothing until `ADS.client` + a slot ID are set in `site.config.ts`, so pages
  are ad-free until AdSense approval. Budget is 2 slots per tool page (`toolTop`, `toolBottom`), and
  `toolBottom` lazy-loads via `IntersectionObserver` so an ad below the fold never competes with the
  tool's own interactive load.
- **Performance**: each tool's interactivity is a separate `<script>` compiled from its own
  `*.client.ts` — no shared JS bundle across tools. Shared *presentational* CSS (`.tool`, `.panes`,
  `.options`, …) lives once in `src/styles/global.css` so it's cached across pages without needing JS.
- **Related Tools**: `RelatedTools.astro` is required at the bottom of every tool page — same-category
  tools first, backfilled from other categories so it's never thin (3–5 links).

## Launch checklist

1. **Domain** — set `SITE.url`, `SITE.name` in `src/site.config.ts`; update the
   `Sitemap:` line in `public/robots.txt`.
2. **Deploy** — Vercel, Netlify and Cloudflare Pages all auto-detect Astro. Build command
   `npm run build`, output `dist`. `vercel.json` enables clean URLs (`/tools/foo`, not
   `/tools/foo.html`); Netlify and Cloudflare Pages do this by default.
3. **Search Console** — verify the domain and submit `/sitemap-index.xml`.
4. **AdSense** — apply once the site has real content live. After approval, fill in `ADS.client` and
   the slot IDs in `site.config.ts`, and paste the exact `ads.txt` line Google gives you into
   `public/ads.txt`.
5. **Consent** — if you expect EU/UK traffic, enable Google's consent message (Privacy & messaging in
   the AdSense dashboard) so the privacy policy's promise holds.
6. **OG image** — `public/og-default.png` (1200×630) is generated by `node scripts/make-og-image.mjs`;
   pass `--from some.png` to centre-crop a designed image to the right size instead.

## Adding a new tool

1. Add the pure logic to `src/lib/<tool>.ts` with a test file in `tests/`.
2. Register it in `src/data/tools.ts` (title < 60 chars, description < 155 chars, pick a category
   from `src/data/categories.ts` or add a new one there).
3. Build `src/components/tools/<Name>Tool.astro` (markup) + `<name>.client.ts` (behaviour) — reuse the
   shared `.tool`/`.panes`/`.options` classes from `global.css` rather than redefining them, debounce
   the textarea input, and copy the `// --- Analytics` helper block (see `docs/ANALYTICS.md`).
4. Create `src/pages/tools/<slug>.astro` using `ToolLayout`: pass `tool` (from the registry), `steps`
   and `faq` as props, put the interactive component in the default slot, and the explanation /
   example / options / edge-cases / code sections in the `content` named slot.
5. Run `npm run build && npm test` — `registry.test.ts` fails on a missing page or a metadata rule;
   `analytics.test.ts` on missing instrumentation or a PII leak; `content.test.ts` on a missing
   section, a forbidden phrase or mismatched structured data. Then work through the "Mandatory rule"
   checklist in `CLAUDE.md` — a page is not done when the route renders.
