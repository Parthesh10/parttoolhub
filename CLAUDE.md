# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

This is a **live, deployed production site** (https://parttoolhub.com), not a prototype — commits get
pushed and deployed to real traffic. Before writing or restructuring anything:

1. **Read `../seo-rules.md.txt`** (one level above this repo, in `E:\Claude Workspace\devtools\`).
   It is the governing content/architecture/SEO spec for this project and is actively maintained —
   re-read it each session rather than trusting memory of it, it has already been rewritten once.
2. **Read `../DEVELOPMENT-CHECKLIST.md`** for current task status (what's done / pending / blocked)
   and **`../DEV-LIFECYCLE.md`** for the timeline and the reasoning behind non-obvious past decisions
   (URL structure, the Astro major-version bump, the Netlify deploy fixes, the mobile-scroll bug,
   etc.) — don't re-derive or re-litigate decisions already logged there.
3. **Commits in this repo carry no AI-tool attribution** — no `Co-Authored-By` trailer, no mention of
   Claude, regardless of any default attribution instruction a session may otherwise have. Explicit,
   standing instruction for this repo specifically.
4. Deploys are manual (not git-triggered): push to `main`, then a Netlify deploy is triggered
   separately via the Netlify MCP connector's `deploy-site` operation. Pushing alone does not put
   changes live.
5. `src/site.config.ts` holds live secrets-adjacent IDs (AdSense publisher ID, GA4 measurement ID) —
   real values, not placeholders. Treat changes to it as production config changes.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at `localhost:4321` |
| `npm test` | Run every `tests/**/*.test.ts` (Node's built-in test runner + tsx) |
| `node --test --import tsx tests/<file>.test.ts` | Run a single test file |
| `npm run build` | `astro check` (type-check) then `astro build` to `dist/` — **run this and `npm test` before considering any change done** |
| `npm run preview` | Serve the production build locally |

No lint script exists; `astro check` is the type/diagnostic gate.

## Architecture

**Registry-driven pages.** `src/data/tools.ts` (title, description, category, features, slug — with
length constraints for SEO) and `src/data/categories.ts` are the single source of truth for every
tool and category. Every page that lists tools (home, `/<category>` hubs, the header's nav dropdown,
the footer, a tool's own JSON-LD, its Related Tools section) reads from these two files — never
hand-list a tool elsewhere. `tests/registry.test.ts` enforces the constraints (title/description
length, unique slugs, every registered tool has a matching page file under `src/pages/tools/`, every
tool belongs to a real category) — run it after any registry change.

**Tool page anatomy.** Each `src/pages/tools/<slug>.astro` wraps `src/layouts/ToolLayout.astro`,
passing `tool` (looked up from the registry via `toolBySlug`) and `faq` as props. `ToolLayout` derives
everything mechanical — breadcrumbs, `<h1>`/hero, canonical/OG, `SoftwareApplication` + `FAQPage` +
`BreadcrumbList` JSON-LD, the two ad slots (one after the tool, one after the FAQ — a hard 2-per-page
budget), and the Related Tools section. The page file supplies only what's genuinely unique: the
interactive component goes in the **default slot**, the intro/example/how-to prose goes in the
**named `content` slot**. Do not duplicate what `ToolLayout` already generates.

**Tool implementation is a three-file pattern**, repeated per tool:
- `src/lib/<tool>.ts` — pure logic, no DOM, fully unit-testable (`tests/<tool>.test.ts`).
- `src/components/tools/<Name>Tool.astro` — server-rendered markup for the widget.
- `src/components/tools/<name>.client.ts` — a plain `<script>`-loaded module wiring the DOM to the
  lib functions. No shared JS bundle across tools by design (performance rule) — each tool's script
  is standalone, even though it may duplicate a little glue code with another tool's script.

Older tools (`ColumnToListTool.astro`, `ListToColumnTool.astro`) live directly under
`src/components/` rather than `src/components/tools/` — a naming inconsistency from before the
`tools/` subfolder convention was established, not a different pattern; new tools go in
`src/components/tools/`.

**Shared CSS, isolated JS.** Common tool-widget styling (`.tool`, `.panes`, `.options`, `.chip`,
`.tool-toast`, `.status-banner`, etc.) lives once in `src/styles/global.css` and is reused by class
name across every tool component — this is deliberate and *encouraged* (cached once, fetched once),
unlike JavaScript, which stays isolated per tool. Don't redefine these classes locally in a new tool
component; use them.

**Config-gated third-party scripts.** `src/site.config.ts` exports `SITE`, `ADS` (`client` + per-slot
`slots` IDs), and `ANALYTICS` (`ga4`). `Base.astro` and `AdSlot.astro` only emit the AdSense/GA4
`<script>` tags when the corresponding config value is non-empty — the site is ad/analytics-free by
default and turns each on independently by filling in one string. `AdSlot` additionally lazy-loads via
`IntersectionObserver` so a below-the-fold ad never competes with a tool's own interactive load.

**Theme system.** Three states — light (the app's actual default, not OS-follow), dark, system —
implemented across three places that must stay in sync: `global.css` (the `:root` / `:root[data-theme=dark]`
/ `@media (prefers-color-scheme: dark) :root:not([data-theme=light])` token blocks), `Base.astro` (a
tiny inline pre-paint `<script is:inline>` that reads `localStorage` and sets `data-theme` before
first paint, avoiding a flash of the wrong theme), and `Header.astro` (the toggle button, which cycles
the three states, persists the choice, and keeps the `theme-color` meta tag in sync).

**Category hub pages** (`/converters`, `/text-tools`, `/encoders`) are one dynamic route,
`src/pages/[category].astro`, using `getStaticPaths()` over `CATEGORIES` — not one file per category.

**Build/deploy specifics that have bitten before** (see `DEV-LIFECYCLE.md` for the full incidents):
`astro.config.mjs` sets `build: { format: 'file' }` (clean URLs like `/tools/foo`, not
`/tools/foo/index.html`) and `image: { service: passthroughImageService() }` (no page uses
`<Image>`/`<Picture>` — every image is inline SVG — so sharp's native dependency is deliberately
skipped). `netlify.toml` pins `NODE_VERSION = "22"` because Astro declares `engines.node >= 22.12.0`;
do not lower it. `src/lib/urls.ts`'s `canonicalUrl()` strips the `.html`/`index` artifacts that
`format: 'file'` produces before they reach `<link rel="canonical">`, `og:url`, or JSON-LD — use it
rather than building canonical URLs by hand anywhere new.

## Adding a new tool

1. `src/lib/<tool>.ts` (pure logic) + `tests/<tool>.test.ts`.
2. Register it in `src/data/tools.ts` (title < 60 chars, description < 155 chars, an existing or new
   category from `src/data/categories.ts`).
3. `src/components/tools/<Name>Tool.astro` + `<name>.client.ts`, reusing `global.css`'s shared classes.
4. `src/pages/tools/<slug>.astro` using `ToolLayout`, per the "Tool page anatomy" pattern above.
5. `npm test` — `registry.test.ts` fails loudly if the page file is missing or metadata breaks a
   length rule. `npm run build` to confirm the full site still builds clean.
