# Analytics (GA4)

How PartToolHub measures use without ever seeing what people paste. This file is the reference
for `tests/analytics.test.ts`, which fails the build if an event is used in code but not listed
here (or listed here but no longer used), if any tool script is missing instrumentation, if a
`track()` call could carry visitor text, or if GA4 is initialised anywhere but `Base.astro`.

## Initialisation

- **One tracker, one place.** `src/layouts/Base.astro` loads `gtag.js` (`async`,
  `fetchpriority="low"`) and calls `gtag('config', G-…)` once per page. The measurement ID is
  `ANALYTICS.ga4` in `src/site.config.ts`. That single config call produces GA4's automatic
  `page_view`; there is no client-side routing, so a page view is always a full page load and can
  never double-fire.
- **Production only.** The tracker is emitted only when `ANALYTICS.ga4` is set **and**
  `import.meta.env.PROD` is true. `npm run dev` never sends data. In dev (or with analytics off)
  the same `window.pth.track` API exists but logs to the browser console as `[analytics] …`, so
  instrumentation can be checked locally before deploying.
- **The API is `window.pth.track(name, params)`**, defined inline in `Base.astro`. Tool scripts
  call it through optional chaining (`window.pth?.track(...)`), and `track` itself wraps `gtag` in
  `try/catch`, so a blocked script, an ad blocker or a missing tracker can never break a tool.
- **Acquisition is untouched.** Source/medium, landing page, UTM parameters, referrer and the
  `page_location` on every event are GA4's own; nothing here re-implements them. Enhanced
  measurement (property setting) covers 90 % scroll, outbound clicks and file downloads — the site
  deliberately sends no custom scroll or outbound events to avoid duplicates.
- **Consent.** Personalised ads are gated by the Google CMP configured in AdSense (3-choice, EEA/UK/CH).
  GA4 does not log or store IP addresses. No Consent Mode signals are sent from this code; if
  EEA analytics consent becomes a requirement, add `gtag('consent', 'default', …)` before the
  config call in `Base.astro` — that is the only file to touch.

## Event taxonomy

Ten events, all with `tool_slug` and `tool_category` where a tool is involved. Each row is one
event name in code; the test enforces the list.

| Event | Trigger | Parameters | Purpose |
| --- | --- | --- | --- |
| `tool_view` | A `/tools/<slug>` page loads (`Base.astro`, from `ToolLayout`'s `tool` prop) | `tool_slug`, `tool_category` | Tool discovery; `page_view` with tool context for simple reports |
| `tool_use` | **Once per page load**, the first time the engine runs on non-empty input | `action` (e.g. `format`, `minify`, `encode`, `decode`, `title:apa`, `join`, `convert:slack`), `success`, `input_source` (`typed` / `pasted` / `sample` / `transfer` / `file`), `input_size` (`xs` <100 chars … `xl` ≥100k; bytes for a file input) | Which tools are used, how input arrives, how big it is |
| `tool_result` | **Once per page load**, the first successful run on non-empty input | `action` | **Primary conversion** — the tool did its job for a real input |
| `tool_error` | **Once per page load**, the first failed run | `action`, `error_type` — a fixed category (`syntax`, `alphabet`, `length`, `utf8`, `bad_escape`, `segments`, `base64url`, `json`, `object`, `unsupported_name`, `unterminated_string`, `text`, `other_file`, `not_image`, `data_uri`, `render`, `too_large`, `empty`, …), never the message | Reliability; tools that attract input they cannot handle |
| `tool_option` | A control is changed — once per control per page load | `option` (control id such as `opt-sort`, `mode`, `preset`, `swap`), `value` (the select's visible label, `true`/`false` for a checkbox, the preset id, or `(text)` for a free-text box) | Which options and presets earn their place in the UI |
| `copy_result` | Copy button pressed with a non-empty result | `target` (`output`, `header`, `payload`; on the image tools `data_uri`, `base64`, `html`, `css`; on Markdown to Google Docs `rich` for the formatted clipboard write and `html` for the source; on the Password and UUID generators `row` for one item copied from a batch list; on the Color Converter `hex`, `rgb`, `hsl`, `tint`; on the Unix Timestamp Converter `seconds`, `milliseconds`, `iso`, `utc`, `local` for a result row and `now_s` / `now_ms` for the live clock) | Secondary conversion — output was useful enough to take |
| `download_result` | Download button pressed with a non-empty result | `target` (`output`; on Base64 to Image `image`, or `file` for non-image bytes saved anyway; on Markdown to Google Docs `html`) | Secondary conversion |
| `reset_tool` | Clear button pressed | — | Re-use within one visit |
| `navigation_click` | Any internal link click, captured by delegation in `Base.astro`; plus the two cross-tool hand-off buttons | `link_placement` (`header`, `footer`, `breadcrumb`, `related`, `home-directory`, `hub-cards`, `content`, `handoff`, `not-found`), `link_to` (path only, no query or hash) | Which internal pathways move people between tools |
| `share_click` | Share FAB (`floating-tools.client.ts`, tool pages only) — Copy link or Share to Reddit chosen from the popover | `channel` (`copy_link`, `reddit`) | Secondary conversion — a visitor found the tool worth sending elsewhere |
| `palette_change` | A colour scheme is picked from the header's palette menu (`Header.astro`) | `palette` (`tangerine`, `indigo`, `mint`, `cobalt`) | Which colour schemes visitors prefer over the Tangerine default |

"Once per page load" is implemented with a per-script `fired` set: `tool_use`, `tool_result` and
`tool_error` each fire at most once, so a page load can produce at most one of each regardless of
how much the visitor types. That keeps event volume proportional to visits, not keystrokes.

**Generator-shaped tools are the one deliberate exception.** A tool with no text input at all (the
UUID Generator; any future tool that produces a value instead of transforming one) has no keystroke
stream to dedupe against — clicking "Generate" again for a fresh batch is the entire point, and each
click is as meaningful as the first, not a burst to collapse into one event. These tools drop the
`fired`-set dedup on `tool_use`/`tool_result`/`tool_error` and fire on every deliberate click instead,
while still never firing for their own automatic first paint on page load (an initial batch is shown
immediately for a working first impression, but that isn't a "use" any more than another tool's empty
starting state is). `input_source` is always `'sample'` for these tools — the closest existing enum
value to "generated, not typed or pasted" — and `input_size` buckets the generated result's size
instead of an input's, since there is no input to measure.

**File-input tools** (Image to Base64) have no keystroke stream either, but unlike a generator each
file is one transform of one input, so they keep the once-per-page-load dedup. `input_source` is
`file` for the picker and drag-and-drop, `pasted` for a clipboard image, `sample` for the built-in
one; `input_size` buckets the file's byte count. On Base64 to Image, `error_type: render` is the one
error reported by the browser rather than the engine — the header was valid but the `<img>` could
not decode the rest.

Outbound links, scroll depth and file downloads are **not** custom events — GA4 enhanced measurement
already reports them. Do not add `outbound_click` or `scroll_depth` events without first turning
those off in the property, or every click will count twice.

## Conversions (mark as key events in the GA4 property)

- **Primary:** `tool_result` — a successful run on real input. Count per `tool_slug` to rank tools by
  value delivered, and compare with `tool_view` for a conversion rate per tool.
- **Secondary:** `copy_result`, `download_result` (the result was worth taking), `share_click` (the
  page was worth sending elsewhere), and `navigation_click` with `link_placement = handoff` or
  `related` (the visitor moved to a next tool).

The journey GA4 can then answer: *traffic source → landing page → `tool_view` → `tool_use` →
`tool_result` or `tool_error` → `copy_result` → `navigation_click` → exit.*

## Privacy rules (enforced by `tests/analytics.test.ts`)

Never send: the text in any input or output box, error *messages* (they can quote the input),
file contents, URLs typed by the visitor, tokens, emails, names. The tools handle JWTs, Base64,
URLs, JSON and free text — any of it can be secret.

Always send instead: `tool_slug`, `tool_category`, action names, control ids, enumerated option
values or select labels, size **buckets**, error **categories**, internal link paths.

The static guard rejects any `track(...)` call whose arguments mention `.value` (other than
`.value.length`), `raw`, `output`, `error`, `message`, `textContent` or `src`, and rejects any use of
`el.value` in the option tracker. Free-text inputs report `(text)`, never their contents.

## Adding analytics to a new tool

1. Copy the `// --- Analytics` helper block from any existing `*.client.ts` into the new script
   (duplication is deliberate — seo-rules §4 forbids shared JS across tools). It needs a variable
   named `input` (the main textarea) to exist above it.
2. After the engine runs on non-empty input, call `trackRun(action, ok, errorCategory)`. Derive
   `errorCategory` with regex tests on the engine's message; never pass the message.
3. In `copyOutput` / `downloadOutput`, after the empty-output early return, call
   `track('copy_result', { target: 'output' })` / `track('download_result', { target: 'output' })`.
4. In the Clear handler call `track('reset_tool')`; in the Load sample handler set
   `inputSource = 'sample'`; if the tool receives a transfer, set `inputSource = 'transfer'`.
5. For each option control add `c.addEventListener('change', () => trackOption(c))`.
6. Nothing to do for `tool_view` or `navigation_click` — `ToolLayout` and `Base.astro` handle them.
7. Run `npm test`: `analytics.test.ts` checks the script for every button the widget has.

## Reading the data

Useful GA4 explorations:

- **Tool ranking:** event count of `tool_result` by `tool_slug`; divide by `tool_view` for a per-tool
  success rate. A high `tool_view` / low `tool_use` ratio means the page attracts searchers the tool
  does not serve — a content or intent problem.
- **Error hot-spots:** `tool_error` by `tool_slug` + `error_type`. A dominant category is a candidate
  for a friendlier message or a new option.
- **Input shape:** `tool_use` by `input_source` and `input_size` — whether people paste big things
  (INP budget) or type small ones.
- **Discovery paths:** `navigation_click` by `link_placement` → `link_to` to see which internal links
  actually move people; pair with landing page to find strong entry → next-tool routes.
- **Options:** `tool_option` by `option` + `value` to find controls nobody touches.
