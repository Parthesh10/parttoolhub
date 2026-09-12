# DevTools Hub

A collection of fast, private, browser-only text utilities built with [Astro](https://astro.build).
The first tools are **Column → Comma Separated List** and its reverse, **Comma Separated List → Column**.

Design goals: static HTML, near-zero JavaScript, strong on-page SEO, AdSense-ready.

## Commands

| Command           | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `npm install`     | Install dependencies                                  |
| `npm run dev`     | Start the dev server at `http://localhost:4321`       |
| `npm test`        | Run engine unit tests (Node's built-in test runner)   |
| `npm run build`   | Type-check (`astro check`) and build to `./dist/`     |
| `npm run preview` | Serve the production build locally                    |

## Project layout

```
src/
  site.config.ts        ← brand, domain, AdSense IDs, GA4 ID, nav (edit this first)
  lib/list-convert.ts   ← pure conversion engine, shared by pages, client scripts and tests
  layouts/Base.astro    ← <head> with canonical/OG/JSON-LD, header, footer, ad + analytics loaders
  components/
    ColumnToListTool.astro + column-to-list.client.ts
    ListToColumnTool.astro + list-to-column.client.ts
    AdSlot.astro        ← renders nothing until ADS.client + slot IDs are set
    Faq.astro           ← <details> FAQ + FAQPage schema
    Breadcrumbs.astro   ← breadcrumb nav + BreadcrumbList schema
  pages/                ← one file per URL
public/
  robots.txt, ads.txt, favicon.svg
tests/                  ← *.test.ts
```

## Launch checklist

1. **Domain** — set `SITE.url`, `SITE.name`, `SITE.contactEmail` in `src/site.config.ts`; update the `Sitemap:` line in `public/robots.txt`.
2. **Deploy** — Vercel, Netlify and Cloudflare Pages all auto-detect Astro. Build command `npm run build`, output `dist`.
3. **Search Console** — verify the domain and submit `/sitemap-index.xml`.
4. **AdSense** — apply once the site is live with its content pages. After approval, fill in `ADS.client` and the slot IDs, and paste the exact `ads.txt` line Google gives you into `public/ads.txt`.
5. **Consent** — if you expect EU/UK traffic, enable Google's consent message (Privacy & messaging in the AdSense dashboard) so the privacy policy's promise holds.
6. **OG image** — add a 1200×630 `public/og-default.png` for social previews.

## Adding a new tool

1. Put the pure logic in `src/lib/<tool>.ts` and cover it with a test in `tests/`.
2. Create `src/components/<Tool>.astro` for markup and `<tool>.client.ts` for DOM wiring.
3. Add `src/pages/<slug>.astro` with original explanatory content, FAQ and schema.
4. Register it in `NAV_TOOLS` in `src/site.config.ts` and the `tools` list on the home page.
