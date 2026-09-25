# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

This is a **live, deployed production site** (https://parttoolhub.com), hosted on **Vercel** (team
`parthesh`, project `parttoolhub`, since 2026-09-15 — migrated off Netlify after its team plan ran out
of build credits), not a prototype — commits get pushed and deployed to real traffic. Before writing or
restructuring anything:

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
5. **All work happens on the `staging` branch, not `main`** (since 2026-09-15). Commit and push to
   `staging` by default. `main` only moves — via merging `staging` into it — when the maintainer
   explicitly asks for a release; never merge or push to `main` on your own initiative. **Vercel's
   Production environment auto-deploys on every push to `main`** (git-triggered, no manual step,
   unlike the old Netlify setup) — so merging to `main` *is* the release, there is no separate deploy
   command to run afterward. Pushes to `staging` only create disconnected Preview deployments (no
   custom domain), so they can never affect the live site. Vercel's Hobby plan has no hard cap on
   deployment count (~6,000 build-minutes/month and ~100GB bandwidth/month are the real ceilings, both
   far above this site's usage) — the old Netlify "ran out of credits" failure mode does not apply
   here, but keep deploys deliberate regardless (per standing instruction to minimize them).
   Note: Vercel's Hobby plan is licensed for non-commercial use; this site carries AdSense, which is
   a ToS gray area worth resolving (e.g. upgrading to Pro) before relying on Hobby long-term.
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
- Structured data that describes only what is visible: tools get `WebPage` + `FAQPage` +
  `BreadcrumbList` from `ToolLayout`; hubs get `CollectionPage` + `ItemList`; never `HowTo`, never
  `SoftwareApplication` (its rich result needs a rating we will not fake — a Semrush audit flagged
  all 20 pages for exactly that on 2026-09-14), never a rating, never anything the visitor cannot
  see. `tests/structured-data.test.ts` holds the type/property allowlist; a new schema type is added
  there deliberately, after checking Google's rich-result requirements for it.
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
2. `npm test` — engine unit tests, `registry.test.ts`, `analytics.test.ts`, `content.test.ts`
   over the fresh `dist/` (sections, order, canonical, OG, JSON-LD ↔ page, sitemap ↔ build,
   robots, internal links, forbidden phrases, titles ≤ 60, descriptions sized) and
   `structured-data.test.ts` (JSON-LD type/property allowlists, banned types and properties,
   `@id` references, URL resolution, dates).
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
`ToolLayout` derives everything mechanical — breadcrumbs, `<h1>`/lead, canonical/OG, `WebPage`
(`@id`/`url` = canonical, name = the `<h1>`, `dateModified` = `reviewedOn`, author → the site-wide
`Person` by `@id`, `isPartOf` → the `WebSite` by `@id`) + `FAQPage` +
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
`jwt-decode.ts`, `SAMPLE_INPUT` in `dedupe-lines.ts`, `SAMPLE_PNG_BASE64` in `base64-image.ts` — a
157-byte PNG generated by a zlib-only script, small enough to print in full on the page) and both the
page and the client import it. Where a page states a behaviour the engine must exhibit (a truncated
sample is flagged, a wrong `data:` prefix is reported), the page's frontmatter asserts it and throws
at build time rather than hedging in prose.

**Tool implementation is a three-file pattern**, repeated per tool:
- `src/lib/<tool>.ts` — pure logic, no DOM, fully unit-testable (`tests/<tool>.test.ts`).
- `src/components/tools/<Name>Tool.astro` — server-rendered markup for the widget.
- `src/components/tools/<name>.client.ts` — a plain `<script>`-loaded module wiring the DOM to the
  lib functions. No shared JS bundle across tools by design (performance rule) — each tool's script
  is standalone, even though it duplicates a little glue code (`plural`, `showToast`, the debounce,
  the `// --- Analytics` helper) with other tools' scripts. That duplication is intentional.

**Not every tool is textarea → textarea.** `Image to Base64` takes a file (picker, drag-and-drop, or a
clipboard paste captured at `document` level) and `Base64 to Image` renders into an `<img>` and offers
a Blob download; both still follow the three-file pattern and the same analytics helper, with
`input_source: 'file'` and byte-count `input_size` where there is no typed text (see
`docs/ANALYTICS.md`). The two hand off to each other via `src/lib/transfer.ts` (sessionStorage, never a
URL parameter), and `Base64 to Image` hands plain-text bytes on to `Base64 Encode / Decode`, which
receives them in decode mode. `Markdown to Google Docs` renders into a `<div>` preview (`innerHTML`
of a fragment our own renderer built from escaped text — input HTML never reaches the DOM as markup)
and writes `text/html` + `text/plain` to the clipboard via `ClipboardItem`, falling back to copying a
selection of the preview; `copy_result` `target` is `rich` or `html` there. A pane that holds
something with intrinsic width (that preview's table) relies on the global `.pane { min-width: 0 }`.

**`src/lib/markdown.ts` is the one engine shared by both Markdown tools** — a CommonMark/GFM parser
for the subset AI assistants and READMEs produce (headings, emphasis with the delimiter-run rules,
code spans and fences, links/images/autolinks, quotes, nested/task lists with tight vs loose, GFM
tables, rules, escapes, entities) with three renderers: `renderText` (plain or a per-app `TextStyle`
for Slack, WhatsApp and Google Chat, each checked against the app's own help page), `renderHtml`
(semantic tags plus the two inline styles Docs/Word keep: monospace on code, border on tables) and
`summarize`. No Markdown dependency, by the one-script-per-tool rule.

**`src/lib/html-to-markdown.ts` is the reverse direction**, shared by `Google Docs to Markdown` and
`HTML to Markdown`: a tolerant HTML parser (auto-closing `<p>`/`<li>`/`<td>`, stray closers ignored,
script/style/svg dropped) and a converter that reads inline *styles* as well as tags — bold is
`font-weight ≥ 600`, code is a monospace `font-family`, and Google Docs' `<b style="font-weight:normal">`
wrapper is therefore not bold. It unwraps `google.com/url?q=` redirect links, folds Docs' beside-the-
item nested lists and `aria-level`, merges split spans, promotes a header-less table's first row, and
returns `notes` the widgets show as the status line. `Google Docs to Markdown` takes its input from a
`contenteditable` box: the browser's own paste inserts the clipboard's HTML flavour (handlers and
scripts stripped by the browser), the script converts `innerHTML` on the next tick, and the box's
colours are overridden in CSS because Docs stamps `color:#000000` on every run.

**`src/lib/markdown-to-docx.ts` + `src/lib/zip-writer.ts` build a real `.docx` file**, for
`Markdown to Word` — reuses `markdown.ts`'s `parseMarkdown` AST (not HTML) and walks it straight to
WordprocessingML (OOXML) XML: headings become real `Heading1`-`6` paragraph styles, lists get real
Word numbering (`word/numbering.xml`, one fresh `numId` per *ordered* list instance so separate
numbered lists each restart at 1 — bullets all share a single numId since restart doesn't apply to
them), tables are genuine `<w:tbl>` elements, hyperlinks are real relationships
(`word/_rels/document.xml.rels`). Images are **not embedded**: an `<img>`/`![]()` becomes a
labelled link instead, since fetching + embedding a media part is materially more scope than this
pass covers (documented on the tool page's own edge-cases section, not silently dropped).
`zip-writer.ts` is a from-scratch, store-only (no DEFLATE) ZIP writer — a `.docx` is a ZIP of these
XML parts, and every OOXML reader accepts an uncompressed member exactly as well as a compressed
one, so skipping compression keeps this dependency-free per the one-script-per-tool rule rather
than reaching for a JS zip library. Both are pure/no-DOM and unit-tested with an independent
from-scratch ZIP *reader* (proving round-trips through a second implementation of the format, not
just that the writer agrees with itself) plus a stack-based XML well-formedness checker over every
generated part. Validated beyond the test suite too: a real generated file was opened with
`python-docx` (an independent, real-world OOXML library) and every heading/list/table/hyperlink
came back correctly — worth re-doing that spot check if this module's XML templates ever change,
since well-formed XML is necessary but not sufficient for Word to actually render it right.
**Gotcha if you touch the run-building code**: `w:rStyle` can only appear once per run — a hyperlink
whose text is also inline code needs the Hyperlink style plus the code font added directly (not via
`CodeChar`'s own `rStyle`), not both `rStyle`s at once (see `textRun`'s `style.link` branch).

**`src/lib/json-parse.ts` is the one place `JSON.parse` gets called** when a tool needs a helpful
error, not a raw exception — `parseJson(input, emptyMessage)` returns `{ok:true,value}` or
`{ok:false,error,line?,column?,snippet?}`, translating whatever a given JS engine's SyntaxError
happens to say into a consistent "line N, column M". Pulled out of the JSON Formatter
(`json-format.ts`, which now just re-exports `parseJson`) during a 2026-09-16 error-message audit,
after finding CSV↔JSON's and JSON↔Python-dict's JSON-parsing steps leaked the raw, browser-specific
exception text instead. Both now use it; the client scripts append `` (line ${n}, column ${m})``
after `result.error`, the same display JSON Formatter already used. Also exports
`offsetToLineColumn(text, offset)`, the character-offset → line/column math on its own, for any
parser that tracks a position but not a line/column — `python-dict.ts`'s own hand-written Python
literal parser uses it for `pythonToJson`'s errors.
**Gotcha that bit this exact fix once**: a recursive-descent parser's "current index" is usually a
*token* index, not a *character* offset — `python-dict.ts`'s `Parser.i` counts tokens, so feeding
it straight into `offsetToLineColumn` produced a plausible-looking but *wrong* line/column (silently
pointing at the wrong place, worse than not showing one at all). The fix was giving every `Token` a
`pos: number` (its real starting character offset, recorded once in the tokenizer) and having every
`PyError` in the parser report `token.pos` — never the token index itself. Any future hand-written
parser in this codebase needs the same treatment before its position can drive a line/column display.

**Toolbar controls (wrap, fullscreen, line numbers, etc.) are a duplicated-per-tool pattern, not a
shared component** (2026-09-17, backlog `UX-001`) — the same tradeoff as the `// --- Analytics`
helper block, for the same reason: `no shared JavaScript across tools` is a deliberate performance
rule (seo-rules §4), so a control that several tools want gets its own small, copy-pasted JS snippet
per tool plus one shared CSS class in `global.css`, never an imported module. Reference
implementation: the output-pane wrap/no-wrap toggle in `json-formatter.client.ts` +
`JsonFormatterTool.astro` — a plain button with `aria-pressed`, matching the existing Format/Minify
toggle convention in the same file, that adds/removes the shared `.pane textarea.no-wrap` class
(`white-space: pre; overflow-x: auto`, vs. the textarea's default soft-wrap) and reports through the
existing `trackOption` helper (no new analytics event). Copy this shape — a small event listener
toggling one shared CSS class, wired through the tool's own existing analytics helper — for each new
toolbar control as it's added to a tool; this paragraph gets extended with each one's shared class
name once it exists, not written speculatively ahead of the code.

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

**Design system (2026-09-15 visual refresh).** Tokens in `global.css`'s `:root` blocks, applied
site-wide — a new tool page needs nothing extra to pick this up:
- `--font-display` (Space Grotesk, loaded non-render-blocking in `Base.astro`) is used only by
  `h1`/`h2`/`h3`, `.brand`/`.brand-mark` and `.eyebrow` — body text and every textarea stay on
  `--font` (the system stack) for performance and small-size legibility.
- `--accent` / `--accent-hover` are for **text** (links, the `.eyebrow` label) — deliberately pale
  in dark mode for legibility on a dark page. `--accent-btn` / `--accent-btn-hover` are a separate,
  darker pair for **solid fills with white text on top** (`.btn-primary`, `.chip[aria-pressed]`, a
  tool's own pressed-mode buttons, the skip-link) — using `--accent` there fails 4.5:1 in dark mode
  (measured 2.8:1). Any new "pressed / selected" button state must use `--accent-btn`, not `--accent`.
- `--accent-2` is a sparse second accent — a label dot, a hover glow — never a large fill; also
  passes 4.5:1 as text (it doubles as `--tint-generators`, used as link/eyebrow text).
- **Palettes (2026-09-25).** The default is Ink & Tangerine (`--accent` orange, `--accent-2` sky
  blue). Visitors can switch to Indigo, Mint or Cobalt (the pre-2026-09-25 look) from the header's
  palette picker; the choice is `localStorage 'palette'`, set as `data-palette` on `<html>` by the
  pre-paint script in `Base.astro` (no attribute = Tangerine). Each palette overrides exactly the
  palette tokens `--bg … --grid-dot`; syntax, category, success/danger colours are shared. So never
  hard-code a colour that should follow the palette: use the tokens. `tests/palette-contrast.test.ts`
  resolves every palette in both themes from the real `global.css` and fails on any text pairing
  under 4.5:1, and on drift between the duplicated dark blocks. Adding a palette means three blocks
  in `global.css`, an entry in the picker in `Header.astro`, the pre-paint allow-list in `Base.astro`,
  and the list in that test. The `palette_change` event (docs/ANALYTICS.md) shows which ones people pick.
- **Tools remember their settings (2026-09-26).** `floating-tools.client.ts` (site-wide) snapshots
  every option control inside `.tool[data-tool]` that has an `id` (checkboxes, radios, selects,
  number/range inputs, `button[aria-pressed]`, and text inputs only inside `.options`) when the page
  is left, and restores them on the next visit by driving the real controls (clicks / input+change
  events), with analytics muted during the restore. Saved per tool as `pth:settings:<slug>`, only
  after a visitor changed an option on that page. Exclusions by id: anything matching `sample` or
  `fullscreen`, anything in `.tool-toolbar`, and every textarea/text input outside `.options` (user
  data). So a new tool gets this for free; give option controls stable ids, and never put a
  data-entry text field inside `.options`. A "Reset to defaults" note appears when settings applied.
- **Next steps (UI round 5a, 2026-09-26).** Under the tool card, `NextSteps.astro` links to related
  tools that open with this tool's result filled in. The plan per tool is data, `src/data/next-steps.ts`
  (source element id, target slugs, labels, optional `when: 'json' | 'json-array'`), checked by
  `tests/next-steps.test.ts`. `floating-tools.client.ts` shows the strip once there is a result and
  hands it over through `src/lib/transfer.ts`; on the receiving page a tool's own `receiveTransfer()`
  wins (it runs first), else the text goes into the first editable textarea with an `input` event. Only
  add a chain where the target genuinely takes the result as its input.
- **Empty inputs (UI round 5b, 2026-09-26).** `floating-tools.client.ts` puts Paste / Try a sample
  buttons at the bottom of every empty editable textarea inside a `.code-wrap` (not single-line boxes):
  they press the tool's own `button[id^="btn-paste"]` (same `.pane`) and `#btn-sample` / `#sample-select`,
  so keep those ids for a new tool to get this. Hidden from assistive tech (the real buttons are the
  accessible route) and hidden at the first character.
- **Share links with input (UI round 5c, 2026-09-26).** "Copy link with your input" in the Share menu
  packs the tool's data fields (by element id) and changed options into `#in=` (`src/lib/share-link.ts`,
  deflate + base64url, capped at `MAX_SHARE_CHARS`). **Privacy invariant:** the first inline script in
  `Base.astro`'s `<head>` moves that fragment into sessionStorage and cleans the address bar before any
  analytics or ad script loads, because GA4 reports the full page URL. Keep it first. The recipient's
  view is applied via the settings code's `apply()`, which never marks the recipient's own remembered
  settings as changed.
- **Ctrl/Cmd+Enter = the page's main action (UI round 5d, 2026-09-26).** A tool's own Ctrl+Enter
  handler (on its input, calling `preventDefault`) wins; otherwise `floating-tools.client.ts` presses the
  tool's `[data-primary-action]` button, else `#btn-copy`, from anywhere on the page, and badges that
  button (`data-kbd-hint`, drawn by CSS `::after`, desktop only) with `aria-keyshortcuts`. Mark
  `data-primary-action` when the main action is not `#btn-copy` (a download, JWT's payload copy).
- **`.hl-layer` must be hidden when colouring is off** (`.code-wrap:not(.has-hl) > .hl-layer`): the
  textarea is only positioned while colouring, so an opaque layer left visible paints over it (this
  blanked the JSON Formatter's TS view from 2026-09-24 to 2026-09-26).
- `--tint-<category-slug>` (five hues: accent / teal / violet / accent-2 / rose) via `src/lib/category-tint.ts`
  give each category hub and its cards a consistent identity (top card border, eyebrow color, the
  tool icon chip). Cards are one component, `ToolCard.astro` (home + hubs): icon from
  `ToolIcon.astro` (add a glyph there for a new tool; unknown slugs get a wrench), whole card
  clickable through a stretched link, and a favourite star (same localStorage list as the command
  palette) that feeds the home page's "Your tools" row. Adding a category means adding its tint token *and* an icon
  case in `CategoryIcon.astro` together (the Compare category shipped without either and showed an
  empty square). The tints are in the palette contrast test, so a new one is checked automatically.
- `.eyebrow` (small mono uppercase label with a colored dot) and `.bg-grid` (a CSS-only dot-grid
  texture, no image request, used behind hero sections only — not on dense pages like the footer)
  are the two reusable "hero" primitives; see `index.astro` and `[category].astro` for the pattern.
- Card hover uses a layered `box-shadow: var(--shadow-lg), 0 0 0 1px color-mix(...)` — the plain
  `--shadow-lg` line first as a fallback for browsers without `color-mix()`, the tinted one after so
  it wins where supported. Keep that ordering if you touch it.
- `--ease-spring` (`cubic-bezier(0.34, 1.56, 0.64, 1)`, an overshoot/bounce curve) is reserved for
  "physical" press/entrance feedback — the FABs, the command-palette open animation, and the
  `:active` squish on `.btn`/`.chip`/`.tool-card` — not for ordinary hover transitions, which stay a
  plain ease. `prefers-reduced-motion` is handled globally already (the `*` transition-duration
  override near the top of `global.css`), so a new spring-eased element needs no extra guard.

**Floating controls** (`src/components/FloatingTools.astro` + `floating-tools.client.ts`, rendered
once from `Base.astro`, present on every page): a back-to-top FAB and a search FAB that opens a
command-palette overlay (Ctrl+K/Cmd+K or click) fuzzy-filtering all tools by name/category/short
description, with arrow-key navigation and Enter to jump — keyboard shortcut is modifier-gated
deliberately, never a bare key like `/`, since the whole site is full of textareas a bare shortcut
would hijack mid-typing. The tool index is a JSON island serialised from the registry at build time
(never hand-duplicated). **Gotcha if you touch the palette's result-row styling**: those `<li>`/`<a>`
elements are built with `innerHTML` in the client script, so Astro's automatic style scoping never
reaches them — any selector targeting them needs `:global(...)`, or the rule silently never applies
(no build error; it just does nothing). The same applies to any future component that injects markup
client-side rather than rendering it in the `.astro` file itself.

**Gotcha: a line break directly before an inline tag can silently eat the space.** When prose text
in a `.astro` template ends a line with a word and the *next* line starts immediately with `<a `,
`<strong>`, `<code>`, `<em>` or `<b>` (no other whitespace), Astro's compiler drops the line break
*and* the space it would represent — `the\n<a href="...">Password Generator</a>` compiles to
`the<a href="...">Password Generator</a>` in the built HTML, with zero space, not one. This is
invisible in the source (reads fine) and easy to miss on the live page too (the words often still
look plausible run together). Found 2026-09-15 across 20 files / 47 occurrences this way — always
verify against the actual built `dist/*.html`, not the `.astro` source, if you suspect this. Fix:
never let a line break fall directly between prose text and an inline tag with no other whitespace
between them — keep the tag on the same line as the word before it, or add an explicit `{' '}`
(the pattern `ToolLayout.astro`'s trust-line and a few other spots already use for exactly this).

**Recently used tools** (`src/lib/recent-tools.ts` — pure `pushRecent`/`parseRecent` helpers, unit
tested; storage itself lives in `floating-tools.client.ts`): every tool-page visit pushes the slug
to the front of a capped (`MAX_RECENT_TOOLS` = 8) localStorage list under `pth:recent-tools`. The
command palette's empty-query state shows this list (newest first, under a "Recently used" heading)
instead of the fixed registry order, falling back to the registry when there's no history yet — a
returning visitor's own habits, not editorial order, decide what shows up first. Wrapped in
try/catch throughout: storage can throw in private-browsing/storage-blocked contexts, and recency is
a nicety, not something a page should ever break over.

**Share FAB** (`FloatingTools.astro`'s optional `tool` prop, threaded from `Base.astro`): a third
FAB, rendered only on tool pages, opening a small popover with "Copy link" and "Share to Reddit" —
deliberately just those two, matching what was actually asked for. Both read `window.location.href`/
`document.title` directly rather than needing new props threaded down, since those are always
correct without extra plumbing. Fires `share_click` (`docs/ANALYTICS.md`) with a `channel` param.
**Gotcha**: the popover is positioned differently by viewport — `right: calc(100% + 0.6rem)` beside
the button on desktop (room to the left), but `right: 0; bottom: calc(100% + 0.6rem)` stacked *above*
the button under 640px, because the FAB column sits at `right: 1.1rem` and there usually isn't
enough room to the left of a corner button on a narrow screen — check any new floating popover at
390px and 320px before assuming a side-anchored position works everywhere.

**Mobile spacing gotcha** (global.css's `@media (max-width: 640px)` block near the bottom): a bare
element/class selector in `global.css` cannot reliably override a same-specificity class already set
in a page's own scoped `<style>` — Astro appends a scope attribute to every scoped selector, which
makes even `.category { margin-bottom: 3rem }` in global.css lose to the page's own unconditional
`.category { margin-bottom: 2.5rem }`, media query or not (specificity beats the cascade layer here,
not source order). Page-specific spacing tweaks belong in that page's own `<style>` block, next to
the rule they override — global.css should only carry truly-global, element-level breathing room
(`main` padding, bare `h2`/`h3` margins) plus classes not already re-declared per page (`.options`).
Also watch source order within one scoped block: a `@media` rule declared *before* the plain rule of
the same specificity loses to it regardless of viewport, since CSS only breaks specificity ties by
source position — put the override after the base rule, not before.

**Every interactive element needs an explicit `:focus-visible` ring — checked systematically, not
tool-by-tool.** A 2026-09-16 accessibility audit found three shared selectors with a `:hover` style
but no focus equivalent, meaning a keyboard user tabbing through the site got the browser's raw
default outline (invisible in some browsers, inconsistent with the site's own `--accent` ring
everywhere else): the bare `a` element (fixed once in `global.css`, which by construction covers
every prose/footer/breadcrumb/related-tool link, the header wordmark and the homepage demo CTA —
no per-page changes needed), `.chip` (the preset/mode toggle buttons used across many tools), and
the plain `input`/`select` elements inside an `.options .field` (every tool's own option
controls). `Faq.astro`'s `<summary>` got the same treatment. If you add a new shared interactive
class, grep the codebase for `:hover` without a matching `:focus-visible` before shipping it — that
regex is exactly how these three were found.

**`src/lib/date-diff.ts` computes a real calendar breakdown (years/months/days), not a fixed 30-day
average.** Reuses `timestamp.ts`'s `dateToTimestamp` for parsing both inputs (so it inherits the
same UTC/local "Interpret as" handling for free rather than a second implementation of the same
problem). The interesting part is `calendarBreakdown`: rather than subtracting date fields one at a
time and borrowing from "the previous month" when a field goes negative (the naive approach, and
the one that breaks on inputs like 31 January → 1 March — do you borrow January's 31 days or
February's 28/29? there's no non-arbitrary answer), it finds the largest whole number of months
that fit by advancing the start date month-by-month with the day clamped to what that month can
actually hold (`addMonthsClamped` — Jan 31 + 1 month lands on Feb 28/29, never rolling into March
the way plain `Date` arithmetic would), then decomposes whatever's left as a fixed, unambiguous
duration. `tests/date-diff.test.ts` pins the Jan-31-to-Mar-1 case specifically, in both a leap and
non-leap year, since that's exactly the input a naive implementation gets wrong.

**Theme system.** Three states — dark (the app's own default since 2026-09-15, not OS-follow — it
was light before that date; see DEV-LIFECYCLE.md for why it flipped), light, system — implemented
across three places that must stay in sync: `global.css` (the `:root` / `:root[data-theme=dark]` /
`@media (prefers-color-scheme: dark) :root:not([data-theme=light])` token blocks), `Base.astro` (a
tiny inline pre-paint `<script is:inline>` that reads `localStorage` and sets `data-theme` before
first paint, avoiding a flash of the wrong theme — its own default and `Header.astro`'s toggle
fallback must always agree, or the button shows the wrong icon on first load), and `Header.astro`
(the toggle button, which cycles the three states, persists the choice, and keeps the `theme-color`
meta tag in sync — its initial value in `Base.astro`'s `<head>` is the dark surface color to match).

**Category hub pages** (`/converters`, `/text-tools`, `/encoders`, `/generators`, `/compare`) are one dynamic route,
`src/pages/[category].astro`, using `getStaticPaths()` over `CATEGORIES` — not one file per category.
Adding a category means adding it to `categories.ts` *and* to the URL-structure list in `README.md`
and this paragraph — `tests/registry.test.ts` checks both mention every hub.

**`/llms.txt`** (`src/pages/llms.txt.ts`) is the one non-page route in `src/pages/`: an Astro API
endpoint (`export const GET: APIRoute`) rather than a `.astro` file, returning a `Response` with a
`text/plain` body. Astro's static build calls it once and writes the result as a plain file, the
same as any other page — this is the pattern to reach for anywhere a route needs to emit something
other than HTML (a generated `.txt`/`.json`/`.xml` file) from the registry at build time, rather than
hand-maintaining a file under `public/` that can drift. Content is generated from `CATEGORIES` /
`TOOLS` directly, so a new tool appears in it automatically; `tests/content.test.ts` asserts every
registered tool is listed.

**`/llms-full.txt`** (`scripts/make-llms-full.mts`) is llms.txt's full-content companion — where
llms.txt is one line per tool, this inlines each tool's actual "How to use" steps, prose sections
and FAQ, so an AI answer engine has real text to quote instead of only a link. Structurally
different from llms.txt on purpose: this content only exists once Astro has *rendered* every tool
page (the "How to use" list, the Fragment content, the FAQ), so it can't be an Astro endpoint like
llms.txt — it's a post-build Node script, wired into `npm run build` itself
(`astro build && node --import tsx scripts/make-llms-full.mts`) rather than a manual step, that
reads the already-built `dist/tools/*.html` files and scrapes the real rendered content out of
them. That's deliberate, not a workaround: scraping the actual rendered output (rather than
re-deriving similar text from the registry) guarantees this file can never say something different
from what a visitor sees. It reuses `src/lib/html-to-markdown.ts` (the engine built for the Google
Docs/HTML to Markdown tools) to turn each extracted HTML fragment into clean Markdown — the same
reasoning that engine applies to a browser paste applies here to a build-time fragment.
`tests/content.test.ts` checks it the same way as llms.txt, skipped until `dist/` exists.

**Build/deploy specifics that have bitten before** (see `DEV-LIFECYCLE.md` for the full incidents):
`astro.config.mjs` sets `build: { format: 'file' }` (clean URLs like `/tools/foo`, not
`/tools/foo/index.html`) and `image: { service: passthroughImageService() }` (no page uses
`<Image>`/`<Picture>` — every image is inline SVG — so sharp's native dependency is deliberately
skipped; `scripts/make-og-image.mjs` borrows the copy Astro installs transitively). `vercel.json` carries the cache-control and security headers (Vercel auto-detects the Node version from
`engines.node` in `package.json`, so nothing pins it explicitly the way `netlify.toml` did).
`netlify.toml` is still present but unused now that hosting is on Vercel — kept only as a reference in
case of rollback; do not treat it as the active config.
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
   **Never put a literal `"` or `'` in a FAQ `q` field.** `Faq.astro` renders it as
   `<summary>{i.q}</summary>` — a plain Astro expression, which HTML-escapes both quote characters
   (`"` → `&quot;`, `'` → `&#39;`) — but the same string goes verbatim into the FAQPage JSON-LD's
   `name` field, unescaped. `tests/content.test.ts` compares the two and fails on the mismatch, so
   this is always caught before it ships, but it's cheaper to just not write a question this way in
   the first place: rephrase ("What is" instead of "What's", no quotation marks around a term) —
   the `a` field has no such restriction, since `Faq.astro` renders it with `set:html` (raw, never
   escaped).
5. Work through the **Mandatory rule** checklist above, then `npm run build && npm test`:
   `registry.test.ts` fails on a missing page file or a metadata rule; `analytics.test.ts` on missing
   instrumentation, a PII leak or an undocumented event; `content.test.ts` on a missing/misordered
   section, a forbidden phrase, or JSON-LD that does not match the page; `structured-data.test.ts`
   on a schema type or property outside the allowlist. Then the maintainer does the
   seo-rules §3A read-aloud pass and sets `reviewedOn`, and the docs listed above are updated.
