# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

This is a **live, deployed production site** (https://parttoolhub.com), not a prototype — commits get
pushed and deployed to real traffic. Before writing or restructuring anything:

1. **Read `../seo-rules.md`** (one level above this repo, in `E:\Claude Workspace\devtools\`).
   It is the governing content/architecture/SEO spec for this project and is actively maintained —
   re-read it each session rather than trusting memory of it, it has already been rewritten once.
   `tests/registry.test.ts` fails if this file points at a rules file that does not exist.
2. **Read `../DEVELOPMENT-CHECKLIST.md`** for current task status (what's done / pending / blocked)
   and **`../DEV-LIFECYCLE.md`** for the timeline and the reasoning behind non-obvious past decisions
   (URL structure, the Astro major-version bump, the Netlify deploy fixes, the mobile-scroll bug,
   etc.) — don't re-derive or re-litigate decisions already logged there.
3. **Read `docs/ANALYTICS.md`** before touching anything that fires an event or adds a tool.
4. **Commits in this repo carry no AI-tool attribution** — no `Co-Authored-By` trailer, no mention of
   Claude, regardless of any default attribution instruction a session may otherwise have. Explicit,
   standing instruction for this repo specifically.
5. Deploys are manual (not git-triggered): push to `main`, then a Netlify deploy is triggered
   separately via the Netlify MCP connector's `deploy-site` operation. Pushing alone does not put
   changes live.
6. `src/site.config.ts` holds live secrets-adjacent IDs (AdSense publisher ID, GA4 measurement ID) —
   real values, not placeholders. Treat changes to it as production config changes.

## Mandatory rule: a new or changed public page is not done until it passes every check below

A route that renders and a widget that works are the *start* of a page, not the end. **Every new or
substantially modified public page must pass the project's SEO, content, internal-linking,
indexability, structured-data, analytics, AdSense-readiness, performance, accessibility, responsive
UX, testing and documentation checks before it is considered complete.** Most of these are enforced
by `npm run build && npm test`; the rest are your responsibility to check by hand. Work through the
checklist in order and do not skip a heading because "it's just a small page".

### Page
- The route follows §1 of `../seo-rules.md`: tools at flat `/tools/<slug>`, hubs at `/<category>`,
  no query strings, no per-option landing pages, no pages "for their own sake".
- One primary search intent, recorded in the registry `intent` field, not already served by an
  existing page (mirror-image tools are fine; same-query pages cannibalise each other).
- The page has a purpose a searcher would type, and content that answers it better than the
  competing results — not a thin wrapper around a widget.
- It sits in the hierarchy: home → category hub → page, reachable in ≤ 2 clicks.

### SEO
- `<title>` unique, ≤ 60 chars with the brand suffix (the layout drops the suffix if it would not
  fit); `<meta name="description">` unique, 70–155 chars; exactly one `<h1>` containing the intent.
- Heading hierarchy h1 → h2 → h3 with no skipped levels; the §3.1 sections in order for tools.
- Canonical on the real domain via `canonicalUrl()`; `og:url` equals it; OG + Twitter tags come from
  `Base.astro` automatically — do not hand-write them.
- Indexable (no `noindex` except 404) and present in the sitemap (automatic for any page under
  `src/pages/` except 404).
- Structured data that describes only what is visible: tools get `SoftwareApplication` + `FAQPage` +
  `BreadcrumbList` from `ToolLayout`; hubs get `CollectionPage` + `ItemList`; never `HowTo`, never a
  rating, never anything the visitor cannot see.
- Breadcrumbs on every page except home; the `BreadcrumbList` schema matches them exactly.

### Content (`../seo-rules.md` §3 and §3A)
- Tool pages: How to use (3–5 steps) → What this tool does → Example (**generated from the engine at
  build time**) → Options explained (exact UI labels) → Edge cases and common errors (**written from
  actually running the engine against broken input**) → Do the same thing in code → FAQ (3–6) →
  Related tools → trust/review line. Hubs: 1–2 intro paragraphs before the cards.
- No filler, no forbidden phrases (`tests/content.test.ts` lists them), no keyword repetition, no
  claim the code does not back. Every claim about the UI must match the client script — including
  what happens on empty input, what "Load sample" inserts and which options exist.
- `reviewedBy` / `reviewedOn` set in the registry after the maintainer's read-aloud pass; `spec`
  linked where the tool implements a standard.

### Internal linking
Ask, and act on the answers: *Which existing pages should link to this one?* (its hub card, the home
directory and the footer are automatic from the registry; add a mid-content link from any tool that
hands off to it). *Which pages should it link to?* (its hub via breadcrumb, 3–5 related tools, and
mid-content links to the next step — e.g. "…then validate it in the JSON Formatter"). *Is it orphaned?*
`tests/content.test.ts` requires ≥ 3 outbound tool links and a hub link, and that every internal link
in the whole build resolves.

### Analytics (`docs/ANALYTICS.md`)
- Tools: copy the `// --- Analytics` helper block into the client script and wire `trackRun`,
  `copy_result` / `download_result`, `reset_tool`, `inputSource = 'sample'` and `trackOption` —
  `tests/analytics.test.ts` checks the script against every button the widget has.
- Non-tool pages: nothing to add. `tool_view` and `navigation_click` come from `Base.astro`;
  page views come from the single `gtag('config')`.
- Never initialise GA anywhere else, never call `gtag` directly, never pass visitor text, error
  messages, `.value` of a text box or anything typed. The static PII guard in `analytics.test.ts`
  rejects `track()` calls that reference them. Only slugs, action names, control ids, enumerated
  values, size buckets and error categories.
- Use the existing event names; add a new one only if none fits, and document it in the table in
  `docs/ANALYTICS.md` in the same change (the test fails on an undocumented or unused event).

### AdSense readiness (`../seo-rules.md` §8)
- Enough original, useful content around the widget that the page would survive a "low value
  content" review on its own.
- Ad slots only where `ToolLayout` puts them (after "How to use", after the FAQ). Never above the
  tool, never between input and output, never a third unit. Nothing renders until slot IDs exist.
- Trust signals present: breadcrumb, review line with the named maintainer, links to /about.
- If a page would be thin by nature (a utility page, a state page), it should not exist as an
  indexable page at all rather than exist unmonetised.

### Performance (`../seo-rules.md` §4)
- Only the tool's own client script hydrates; no shared JS across tools; no framework islands.
- Textarea `input` handlers debounced (~120 ms); option toggles render immediately; nothing blocks
  the main thread > 50 ms on a keystroke — measure with a large paste.
- Reserved dimensions for anything that appears later (ad slots, result panes) so CLS stays < 0.1.
- No new dependencies, images or fonts without a reason that survives §4 ("disable it rather than
  carry it").

### Accessibility (`../seo-rules.md` §7)
- Semantic landmarks (`<main>`, `<nav>`, `<article>`, `<section>`), every input labelled, every
  icon button named, visible focus rings, contrast ≥ 4.5:1 in both themes, `prefers-reduced-motion`
  respected (global), 44 px tap targets on touch (global `pointer: coarse` rules — reuse the shared
  classes so a new control inherits them).
- No horizontal scroll at 320 px; check a real 390 px render, not only the desktop view.
- Error and empty states are visible text, not colour alone.

### Validation — run all of it, in this order
1. `npm run build` — `astro check` (0 errors) then the static build. The layout throws on wrong
   step/FAQ counts.
2. `npm test` — engine unit tests, `registry.test.ts`, `analytics.test.ts`, and `content.test.ts`
   over the fresh `dist/` (sections, order, canonical, OG, JSON-LD ↔ page, sitemap ↔ build,
   robots, internal links, forbidden phrases, titles ≤ 60, descriptions sized).
3. Look at the page: desktop and a 390 px frame, light and dark, with the tool empty, with a sample,
   with broken input, with a huge paste, and with the analytics console log open in dev.
4. Paste every JSON-LD block into the Rich Results Test if the schema shape changed.

### Documentation — update in the same change, never "later"
`README.md` (routes, layout, commands), this file (architecture/rules), `docs/ANALYTICS.md` (any
event or parameter), `../DEVELOPMENT-CHECKLIST.md` (status) and `../DEV-LIFECYCLE.md` (the why)
whenever a route, the registry shape, analytics, SEO behaviour, navigation or content rules change.
**Code, rendered behaviour, tests and documentation must stay synchronised** — a change to one
without the others is an unfinished change. `tests/registry.test.ts` and `tests/analytics.test.ts`
enforce the parts of this they can (category routes in README/CLAUDE.md, event names in
`docs/ANALYTICS.md`, the rules-file path).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at `localhost:4321`; analytics logs to the console instead of sending |
| `npm test` | Run every `tests/**/*.test.ts` (Node's built-in test runner + tsx) |
| `node --test --import tsx tests/<file>.test.ts` | Run a single test file |
| `npm run build` | `astro check` (type-check) then `astro build` to `dist/` — **run this and then `npm test` before considering any change done** |
| `npm run preview` | Serve the production build locally (Astro 7 runs it as a background daemon; `npx astro preview stop` ends it) |
| `node scripts/make-og-image.mjs [--from img.png]` | Regenerate `public/og-default.png` (1200×630), or centre-crop an external image to it |

No lint script exists; `astro check` is the type/diagnostic gate. The order matters: `tests/content.test.ts`
and the build-level half of `tests/analytics.test.ts` scan `dist/` and are skipped (with a note) when
there is no build, so a green `npm test` on an unbuilt tree has not checked page content.

## Architecture

**Registry-driven pages.** `src/data/tools.ts` (slug, title, description, category, features, plus
`intent`, `reviewedBy`, `reviewedOn` and optional `spec` — see seo-rules §11) and
`src/data/categories.ts` (which also carries each hub's `intro` prose) are the single source of truth
for every tool and category. Every page that lists tools (home, `/<category>` hubs, the header's nav
dropdown, the footer, a tool's own JSON-LD, its Related Tools section, the sitemap's `lastmod`, the
"Last reviewed" line, the analytics `tool_slug`) reads from these two files — never hand-list a tool
elsewhere. `tests/registry.test.ts` enforces the constraints (title/description length, unique
slugs, unique non-overlapping `intent`, `reviewedOn` a real date not in the future, page file
exists, valid category, hub intro present, README/CLAUDE.md mention every hub) — run it after any
registry change. **Any content change to a tool page bumps that tool's `reviewedOn`; nothing else
does** (fake freshness is detectable and harmful).

**Tool page anatomy.** Each `src/pages/tools/<slug>.astro` wraps `src/layouts/ToolLayout.astro`,
passing `tool` (from the registry via `toolBySlug`), `steps` (3–5 one-line "How to use" steps, HTML
allowed) and `faq` (3–6 entries) as props — the layout throws at build time if the counts are off.
`ToolLayout` derives everything mechanical — breadcrumbs, `<h1>`/lead, canonical/OG, `SoftwareApplication`
(name = the `<h1>`, `dateModified` = `reviewedOn`, author → the site-wide `Person` by `@id`) + `FAQPage` +
`BreadcrumbList` JSON-LD, the "How to use" list, the two ad slots (one *after* "How to use", one after
the FAQ — never above the tool, hard 2-per-page budget), Related Tools, the trust/review line, and
the `tool` prop to `Base` that exposes `data-tool-slug` / `data-tool-category` on `<body>` and fires
`tool_view`. The page file supplies only what's unique: the interactive component in the **default
slot**, and in the **named `content` slot** the prose sections in this order (seo-rules §3.1): *What
this tool does* (any specific heading) → `## Example` (generated from the engine at build time, never
typed) → `## Options explained` (one line per control, exact UI labels; output-only tools may use
`## Reading the result`) → `## Edge cases and common errors` (written from actually running the
engine against broken input) → `## Do the same thing in code` (where relevant).
`tests/content.test.ts` enforces the headings, their order, one `<h1>`, canonical, JSON-LD/page
agreement, ≥ 3 other-tool links, and the §3A forbidden-phrase list against the built HTML.

**Sample inputs are shared, not duplicated.** Where a page's worked example claims to be "the same
text the Load sample button inserts", the sample lives in the engine module (`SAMPLE_TOKEN` in
`jwt-decode.ts`, `SAMPLE_INPUT` in `dedupe-lines.ts`) and both the page and the client import it.

**Tool implementation is a three-file pattern**, repeated per tool:
- `src/lib/<tool>.ts` — pure logic, no DOM, fully unit-testable (`tests/<tool>.test.ts`).
- `src/components/tools/<Name>Tool.astro` — server-rendered markup for the widget.
- `src/components/tools/<name>.client.ts` — a plain `<script>`-loaded module wiring the DOM to the
  lib functions. No shared JS bundle across tools by design (performance rule) — each tool's script
  is standalone, even though it duplicates a little glue code (`plural`, `showToast`, the debounce,
  the `// --- Analytics` helper) with other tools' scripts. That duplication is intentional.

Older tools (`ColumnToListTool.astro`, `ListToColumnTool.astro`) live directly under
`src/components/` rather than `src/components/tools/` — a naming inconsistency from before the
`tools/` subfolder convention was established, not a different pattern; new tools go in
`src/components/tools/`.

**Shared CSS, isolated JS.** Common tool-widget styling (`.tool`, `.panes`, `.options`, `.chip`,
`.tool-toast`, `.status-banner`, etc.) lives once in `src/styles/global.css` and is reused by class
name across every tool component — this is deliberate and *encouraged* (cached once, fetched once),
unlike JavaScript, which stays isolated per tool. Don't redefine these classes locally in a new tool
component; use them. `global.css` also carries the site-wide `[hidden] { display: none !important }`
(so a class's `display` can never un-hide an element), the `prefers-reduced-motion` block and the
`pointer: coarse` 44 px tap-target rules.

**Analytics.** One GA4 tracker, initialised once in `Base.astro`, production builds only. The site's
only event API is `window.pth.track(name, params)`; tool scripts call it through the duplicated
helper (`track` / `trackRun` / `trackOption`), never `gtag` directly. `tool_use`, `tool_result` and
`tool_error` fire at most once per page load each. Internal-link clicks are captured by delegation
using `data-nav` zones on the header, footer, breadcrumbs, related-tools aside, home directory and
hub cards. Everything else — taxonomy, parameters, conversions, privacy rules, how to instrument a
new tool — is in `docs/ANALYTICS.md`, which `tests/analytics.test.ts` keeps in sync with the code.

**Identity.** `SITE.author` is a real person (seo-rules §4A), shown in the footer, the review line on
every tool page, `/about` and the `Person` JSON-LD (`src/lib/schema.ts`). `SITE.github` is empty while
the repo is private; setting it makes the GitHub link appear in the footer, `/about`, `/contact` and
`Person.sameAs` — never link the repo while it is private.

**Config-gated third-party scripts.** `src/site.config.ts` exports `SITE`, `ADS` (`client` + per-slot
`slots` IDs), and `ANALYTICS` (`ga4`). `Base.astro` and `AdSlot.astro` only emit the AdSense/GA4
`<script>` tags when the corresponding config value is non-empty (and, for GA4, only in production
builds) — the site is ad/analytics-free by default and turns each on independently by filling in one
string. Both loaders carry `fetchpriority="low"` so they never compete with a tool's own script.
`AdSlot` additionally lazy-loads via `IntersectionObserver` so a below-the-fold ad never competes
with a tool's own interactive load.

**Theme system.** Three states — light (the app's actual default, not OS-follow), dark, system —
implemented across three places that must stay in sync: `global.css` (the `:root` / `:root[data-theme=dark]`
/ `@media (prefers-color-scheme: dark) :root:not([data-theme=light])` token blocks), `Base.astro` (a
tiny inline pre-paint `<script is:inline>` that reads `localStorage` and sets `data-theme` before
first paint, avoiding a flash of the wrong theme), and `Header.astro` (the toggle button, which cycles
the three states, persists the choice, and keeps the `theme-color` meta tag in sync).

**Category hub pages** (`/converters`, `/text-tools`, `/encoders`) are one dynamic route,
`src/pages/[category].astro`, using `getStaticPaths()` over `CATEGORIES` — not one file per category.
Adding a category means adding it to `categories.ts` *and* to the URL-structure list in `README.md`
and this paragraph — `tests/registry.test.ts` checks both mention every hub.

**Build/deploy specifics that have bitten before** (see `DEV-LIFECYCLE.md` for the full incidents):
`astro.config.mjs` sets `build: { format: 'file' }` (clean URLs like `/tools/foo`, not
`/tools/foo/index.html`) and `image: { service: passthroughImageService() }` (no page uses
`<Image>`/`<Picture>` — every image is inline SVG — so sharp's native dependency is deliberately
skipped; `scripts/make-og-image.mjs` borrows the copy Astro installs transitively). `netlify.toml`
pins `NODE_VERSION = "22"` because Astro declares `engines.node >= 22.12.0`; do not lower it.
`src/lib/urls.ts`'s `canonicalUrl()` strips the `.html`/`index` artifacts that `format: 'file'`
produces before they reach `<link rel="canonical">`, `og:url`, or JSON-LD — use it rather than
building canonical URLs by hand anywhere new. Astro 7's `astro preview` is a detached daemon bound
to `localhost` over IPv6 — use `http://localhost:<port>`, not `127.0.0.1`.

## Adding a new tool

1. `src/lib/<tool>.ts` (pure logic) + `tests/<tool>.test.ts`. Probe it with empty, malformed, huge
   and odd-Unicode input *now* — those results become the "Edge cases" section.
2. Register it in `src/data/tools.ts` (title < 60 chars, description < 155 chars, unique `intent`,
   `reviewedBy`/`reviewedOn`, `spec` if it implements a standard, an existing or new category from
   `src/data/categories.ts`).
3. `src/components/tools/<Name>Tool.astro` + `<name>.client.ts`, reusing `global.css`'s shared classes.
   Debounce the textarea `input` handler (~120 ms) like the existing scripts do; option toggles render
   immediately. Copy the `// --- Analytics` helper and wire it per `docs/ANALYTICS.md`.
4. `src/pages/tools/<slug>.astro` using `ToolLayout`, per the "Tool page anatomy" pattern above.
   Compute every example from the engine in the frontmatter; describe only options the widget has.
5. Work through the **Mandatory rule** checklist above, then `npm run build && npm test`:
   `registry.test.ts` fails on a missing page file or a metadata rule; `analytics.test.ts` on missing
   instrumentation, a PII leak or an undocumented event; `content.test.ts` on a missing/misordered
   section, a forbidden phrase, or JSON-LD that does not match the page. Then the maintainer does the
   seo-rules §3A read-aloud pass and sets `reviewedOn`, and the docs listed above are updated.
