/**
 * Single registry of every tool on the site. Pages, the home grid, category
 * hubs, breadcrumbs, Related Tools, the sitemap's lastmod and the per-page
 * "Last reviewed" line all read from here, and tests/registry.test.ts enforces
 * the SEO constraints (title < 60 chars, description < 155 chars, unique slugs
 * and intents, valid category, review fields present and not in the future).
 *
 * To add a tool: add an entry here, create src/pages/tools/<slug>.astro and
 * the component under src/components/tools/. See seo-rules.md §3 for what
 * the page must contain and §11 for what each field below means.
 */
import { SITE } from '../site.config';

export interface ToolSpec {
  /** Short name of the standard, e.g. "RFC 4648". Shown on the page. */
  name: string;
  /** Canonical URL of the standard. Linked from the page's trust line. */
  url: string;
}

export interface Tool {
  /** URL segment under /tools/. */
  slug: string;
  /** Short display name for grids and links; also the page's <h1>. */
  name: string;
  /** <title> — primary keyword first, under 60 characters. */
  title: string;
  /** <meta description> — states the problem solved, under 155 characters. */
  description: string;
  /** One-line summary for directory cards and the sentence under the <h1> (≤ 25 words). */
  short: string;
  category: string;
  /**
   * 3–5 curated feature bullets, one short phrase each. Not rendered anywhere at
   * the moment: they were the SoftwareApplication `featureList` until that
   * schema type was dropped (seo-rules §2 — no rich result without a rating we
   * won't fake). Kept because they are the obvious content for richer hub or
   * directory cards; if rendered, each must match what the widget actually does.
   */
  features: string[];
  /**
   * The one primary search query this page targets, in the searcher's words.
   * Unique across the registry — two pages chasing the same query cannibalise
   * each other. Mirror-image tools (encode/decode) are different intents.
   */
  intent: string;
  /** Who last read this page against the running tool and edited it (seo-rules §3A). */
  reviewedBy: string;
  /** ISO date of that review. Bump only when the content or tool actually changes. */
  reviewedOn: string;
  /** The standard the tool implements, where one exists (seo-rules §4A). */
  spec?: ToolSpec;
}

export const TOOLS: Tool[] = [
  // ---- Converters & Formatters --------------------------------------------
  {
    slug: 'column-to-comma-separated-list',
    name: 'Column to Comma Separated List',
    title: 'Column to Comma Separated List Converter',
    description: 'Turn a column of values into a comma separated list instantly. Custom separators, quotes, dedupe and sort — runs in your browser, nothing uploaded.',
    short: 'Join one-per-line values into a single delimited line, with presets for SQL, JSON and Python.',
    category: 'converters',
    features: ['Custom separators', 'Quote or wrap each item', 'Remove duplicates', 'Sort alphabetically or numerically', 'Presets for SQL, JSON and Python'],
    intent: 'column to comma separated list',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
  },
  {
    slug: 'comma-separated-list-to-column',
    name: 'Comma Separated List to Column',
    title: 'Comma Separated List to Column Converter',
    description: 'Split a comma, semicolon, pipe or tab separated list into one item per line. Auto-detects the separator, strips quotes, removes duplicates and sorts.',
    short: 'Split any delimited text into one item per line; separator detected automatically.',
    category: 'converters',
    features: ['Automatic separator detection', 'Strip quotes and brackets', 'Remove duplicates', 'Sort and change case'],
    intent: 'comma separated list to column',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
  },
  {
    slug: 'json-formatter',
    name: 'JSON Formatter & Validator',
    title: 'JSON Formatter, Validator & Beautifier',
    description: 'Format, validate and minify JSON online. Pinpoints syntax errors by line and column, sorts keys, and never sends your data to a server.',
    short: 'Beautify or minify JSON and see exactly where a syntax error is.',
    category: 'converters',
    features: ['Beautify with 2 or 4 spaces or tabs', 'Minify', 'Error line and column', 'Sort keys alphabetically'],
    intent: 'json formatter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 8259 (JSON)', url: 'https://www.rfc-editor.org/rfc/rfc8259' },
  },
  {
    slug: 'python-dict-to-json',
    name: 'Python Dict to JSON',
    title: 'Python Dict to JSON Converter',
    description: 'Convert a Python dictionary or list literal into valid JSON. Handles single quotes, True/False/None, tuples, sets, comments and trailing commas.',
    short: 'Paste a printed Python dict and get valid JSON with proper quotes, true/false and null.',
    category: 'converters',
    features: ['Single-quoted strings', 'True/False/None to true/false/null', 'Tuples and sets to arrays', 'Trailing commas and comments'],
    intent: 'python dict to json',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'Python language reference: literals', url: 'https://docs.python.org/3/reference/lexical_analysis.html#literals' },
  },
  {
    slug: 'json-to-python-dict',
    name: 'JSON to Python Dict',
    title: 'JSON to Python Dict Converter',
    description: 'Convert JSON into a Python dict or list literal. Outputs single quotes, True/False/None, with adjustable indent and key sorting.',
    short: 'Paste JSON and get a Python literal back, ready to assign to a variable or paste into a REPL.',
    category: 'converters',
    features: ['2, 4 or tab indent, or single line', 'true/false/null to True/False/None', 'Sort keys alphabetically', 'Same parser errors as Python\'s json module'],
    intent: 'json to python dict',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'Python language reference: literals', url: 'https://docs.python.org/3/reference/lexical_analysis.html#literals' },
  },
  {
    slug: 'unix-timestamp-converter',
    name: 'Unix Timestamp Converter',
    title: 'Unix Timestamp Converter',
    description: 'Convert a Unix timestamp to a readable date and back. Auto-detects seconds vs milliseconds, shows UTC, your local time and a relative time.',
    short: 'Convert between Unix time and a human date, with explicit control over seconds/milliseconds and time zone.',
    category: 'converters',
    features: ['Auto-detects seconds vs milliseconds', 'UTC, local and relative time shown together', 'Explicit UTC/local interpretation for dates with no offset', 'Works with negative (pre-1970) timestamps'],
    intent: 'unix timestamp converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'ECMA-262: the Date object', url: 'https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-objects' },
  },
  {
    slug: 'date-difference-calculator',
    name: 'Date Difference Calculator',
    title: 'Date Difference Calculator — Years, Months, Days',
    description: 'Calculate the exact difference between two dates or date-times: years, months and days, plus totals in weeks, days, hours and weekdays.',
    short: 'Find the exact gap between two dates — a calendar breakdown plus totals in weeks, days, hours and weekdays.',
    category: 'converters',
    features: ['Calendar breakdown (years, months, days, hours, minutes, seconds) using real month lengths', 'Totals in weeks, days, hours, minutes and seconds', 'Weekday-only (Mon-Fri) count', 'Explicit UTC/local interpretation, matching the Unix Timestamp Converter', 'Works whichever date comes first'],
    intent: 'date difference calculator',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
    spec: { name: 'ECMA-262: the Date object', url: 'https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-objects' },
  },
  {
    slug: 'csv-to-json-converter',
    name: 'CSV to JSON Converter',
    title: 'CSV to JSON Converter',
    description: 'Convert CSV to JSON online. Handles quoted fields, commas inside values, custom delimiters and automatic number/boolean detection.',
    short: 'Turn a CSV file into a JSON array of objects, with type detection and a custom delimiter.',
    category: 'converters',
    features: ['RFC 4180 quoting (commas and newlines inside fields)', 'Comma, semicolon or tab delimiter', 'Optional number/boolean/null detection', 'Works with or without a header row'],
    intent: 'csv to json converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 4180 (CSV)', url: 'https://www.rfc-editor.org/rfc/rfc4180' },
  },
  {
    slug: 'json-to-csv-converter',
    name: 'JSON to CSV Converter',
    title: 'JSON to CSV Converter',
    description: 'Convert a JSON array of objects or arrays into CSV. Quotes fields that need it, supports a custom delimiter, and flattens nested values.',
    short: 'Turn a JSON array into a CSV file, ready to open in a spreadsheet.',
    category: 'converters',
    features: ['Header row from the union of all keys', 'Comma, semicolon or tab delimiter', 'Correct RFC 4180 quoting', 'Nested objects/arrays embedded as JSON text'],
    intent: 'json to csv converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 4180 (CSV)', url: 'https://www.rfc-editor.org/rfc/rfc4180' },
  },
  {
    slug: 'color-converter',
    name: 'Color Converter',
    title: 'Color Converter — HEX, RGB, HSL & Contrast',
    description: 'Convert a color between HEX, RGB and HSL, with a live swatch and WCAG contrast ratio against black and white text.',
    short: 'Paste a HEX, RGB or HSL color and get every format back, plus its contrast ratio against black and white.',
    category: 'converters',
    features: ['HEX, RGB(A) and HSL(A), all shown at once', 'Live color swatch', 'WCAG 2.x contrast ratio vs. black/white text', 'Accepts 3/4/6/8-digit hex and percentage or slash syntax'],
    intent: 'hex rgb hsl color converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'CSS Color Module Level 4', url: 'https://www.w3.org/TR/css-color-4/' },
  },
  {
    slug: 'number-base-converter',
    name: 'Number Base Converter',
    title: 'Number Base Converter — Binary, Octal, Decimal, Hex',
    description: 'Convert an integer between binary, octal, decimal and hexadecimal. Auto-detects the base from a 0x/0b/0o prefix, with two’s complement for negatives.',
    short: 'Paste an integer in any base and get binary, octal, decimal and hex back at once.',
    category: 'converters',
    features: ['Auto-detects base from 0x/0b/0o prefix', 'Exact for numbers beyond 2^53 (uses BigInt)', 'Optional two’s complement for negative numbers', 'Binary, octal, decimal and hex shown together'],
    intent: 'binary octal decimal hex converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
  },
  {
    slug: 'html-to-markdown',
    name: 'HTML to Markdown',
    title: 'HTML to Markdown Converter',
    description: 'Convert HTML to Markdown: headings, emphasis, links, images, nested lists, tables, code blocks and quotes, with stray symbols escaped. Runs in the browser.',
    short: 'Paste HTML source and get GitHub-flavored Markdown back, with the structure kept and stray symbols escaped.',
    category: 'converters',
    features: ['Headings, emphasis, code, links, images, nested lists, tables, quotes, rules', 'Tolerant of unclosed tags, stray closers and inline styles', 'Scripts, styles and comments removed', 'Markdown-significant characters escaped so the text reads as written', 'Nothing is uploaded — conversion runs in the browser'],
    intent: 'html to markdown',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
    spec: { name: 'GitHub Flavored Markdown', url: 'https://github.github.com/gfm/' },
  },

  // ---- Generators ------------------------------------------------------------
  {
    slug: 'uuid-generator',
    name: 'UUID Generator',
    title: 'UUID Generator — Version 4 and 7',
    description: 'Generate random UUIDs (version 4) or time-sortable UUIDs (version 7) in bulk, with hyphen, uppercase and brace formatting options.',
    short: 'Generate one or many UUIDs — version 4 for random, version 7 for time-sortable IDs.',
    category: 'generators',
    features: ['Version 4 (random) and version 7 (time-sortable)', 'Generate 1–1000 at once', 'Uppercase, no-hyphens and braces formatting', 'Uses the browser’s cryptographically secure random source'],
    intent: 'uuid generator',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 9562 (UUID)', url: 'https://www.rfc-editor.org/rfc/rfc9562' },
  },
  {
    slug: 'password-generator',
    name: 'Password Generator',
    title: 'Password Generator — Strong, Random & Private',
    description: 'Generate strong, random passwords with the character types and length you choose, using a cryptographically secure source. Nothing is ever sent anywhere.',
    short: 'Pick the length, character types and quantity, then generate cryptographically random passwords with a real entropy and strength readout.',
    category: 'generators',
    features: ['Cryptographically secure randomness (Web Crypto, not Math.random)', 'Uppercase, lowercase, numbers and symbols, individually toggled', 'Guarantees at least one of each selected type when length allows', 'Optional exclusion of ambiguous characters (0, O, 1, l, I)', 'Real entropy in bits and a strength label, not a cosmetic meter'],
    intent: 'password generator',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
  },
  {
    slug: 'lorem-ipsum-generator',
    name: 'Lorem Ipsum Generator',
    title: 'Lorem Ipsum Generator — Words, Sentences & Paragraphs',
    description: 'Generate classic Lorem Ipsum placeholder text by words, sentences or paragraphs, with or without the traditional opening line.',
    short: 'Generate placeholder Latin text by words, sentences or paragraphs for mockups, layouts and templates.',
    category: 'generators',
    features: ['Words, sentences or paragraphs, 1–50 at once', 'Optional classic "Lorem ipsum dolor sit amet…" opening', 'Traditional word bank, not gibberish', 'Copy to clipboard or download as .txt'],
    intent: 'lorem ipsum generator',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
  },

  // ---- Text Tools ----------------------------------------------------------
  {
    slug: 'code-case-converter',
    name: 'Code Case Converter',
    title: 'Code Case Converter — camelCase, snake_case & More',
    description: 'Convert an identifier or phrase into camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case and dot.case all at once.',
    short: 'Paste one identifier or phrase and get every common programming case style back at once.',
    category: 'text-tools',
    features: ['camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case, dot.case', 'Detects camelCase/acronym boundaries automatically', 'All six styles shown together', 'Click any result to copy it'],
    intent: 'code case converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
  },
  {
    slug: 'title-case-converter',
    name: 'Title Case Converter',
    title: 'Title Case Converter — APA, Chicago, AP, MLA',
    description: 'Capitalize titles correctly in APA, Chicago, AP or MLA style, or switch to sentence case, UPPERCASE or lowercase. Free, instant, private.',
    short: 'Capitalize headlines and titles by style guide, or switch to sentence, upper or lower case.',
    category: 'text-tools',
    features: ['APA, Chicago, AP and MLA rules', 'Sentence case', 'UPPERCASE and lowercase', 'Keeps acronyms intact'],
    intent: 'title case converter',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'APA Style: title case', url: 'https://apastyle.apa.org/style-grammar-guidelines/capitalization/title-case' },
  },
  {
    slug: 'ai-text-cleaner',
    name: 'AI Text Cleaner',
    title: 'AI Text Cleaner — Remove Markdown & Hidden Characters',
    description: 'Clean up ChatGPT and other AI output: strip Markdown symbols, replace em dashes, straighten smart quotes, and delete invisible characters and citations.',
    short: 'Strip Markdown, em dashes, smart quotes, emoji, citations and hidden characters from AI output.',
    category: 'text-tools',
    features: ['Remove Markdown formatting', 'Replace em and en dashes', 'Straighten curly quotes', 'Delete zero-width and invisible characters', 'Remove emoji and citation markers'],
    intent: 'ai text cleaner',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'CommonMark (the Markdown syntax it strips)', url: 'https://spec.commonmark.org/' },
  },
  {
    slug: 'remove-duplicate-lines',
    name: 'Remove Duplicate Lines',
    title: 'Remove Duplicate Lines Online',
    description: 'Delete duplicate lines from any text or list in one paste. Case-insensitive matching, trim before comparing, keep first or last, and optional sorting.',
    short: 'Keep only unique lines from a list, with case-insensitive and trimming options.',
    category: 'text-tools',
    features: ['Case-insensitive matching', 'Trim before comparing', 'Keep first or last occurrence', 'Sort the result'],
    intent: 'remove duplicate lines',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
  },
  {
    slug: 'markdown-to-plain-text',
    name: 'Markdown to Plain Text',
    title: 'Markdown to Plain Text Converter — Chat-Ready',
    description: 'Turn Markdown into plain text that keeps bullets, numbering, tables and links, or into Slack, WhatsApp and Google Chat markup. Paste AI answers anywhere.',
    short: 'Strip Markdown from an AI answer but keep its structure, or rewrite it as Slack, WhatsApp or Google Chat markup.',
    category: 'text-tools',
    features: ['Keeps bullets, numbering, nesting, quotes and tables as readable text', 'Links as "text (url)", the URL only, or the text only', 'Slack, WhatsApp and Google Chat markup modes', 'Tables aligned in columns', 'Nothing is uploaded — conversion runs in the browser'],
    intent: 'markdown to plain text',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
    spec: { name: 'GitHub Flavored Markdown', url: 'https://github.github.com/gfm/' },
  },
  {
    slug: 'markdown-to-google-docs',
    name: 'Markdown to Google Docs',
    title: 'Markdown to Google Docs — Copy & Paste',
    description: 'Paste Markdown, copy it as formatted text, paste into Google Docs with headings, bold, lists, tables, links and code intact. Works for Word and Gmail too.',
    short: 'Convert Markdown to formatted text you can paste straight into Google Docs, Word, Gmail or Teams.',
    category: 'text-tools',
    features: ['Headings, bold, italic, strikethrough, links, lists, tables, code and quotes', 'Copy as rich text: one paste into Google Docs, Word, Gmail, Outlook, Teams or Notion', 'Live preview of exactly what will be pasted', 'Copy or download the HTML', 'Nothing is uploaded — conversion runs in the browser'],
    intent: 'markdown to google docs',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
    spec: { name: 'GitHub Flavored Markdown', url: 'https://github.github.com/gfm/' },
  },
  {
    slug: 'markdown-to-word',
    name: 'Markdown to Word',
    title: 'Markdown to Word — Download a Real .docx',
    description: 'Convert Markdown to a real, downloadable .docx file with headings, bold, lists, tables and links — no copy-paste, no upload, built in your browser.',
    short: 'Paste Markdown and download an actual .docx file — headings, lists, tables and links all real Word elements, not a pasted approximation.',
    category: 'text-tools',
    features: ['Downloads a real .docx (OOXML), not a copy-paste approximation', 'Headings, bold, italic, strikethrough, links, lists, tables, quotes and code blocks', 'Nested bullet and numbered lists, each numbered list restarting correctly', 'Live preview before you download', 'Built by hand in the browser — no upload, no server, no third-party library'],
    intent: 'markdown to word docx',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
    spec: { name: 'GitHub Flavored Markdown', url: 'https://github.github.com/gfm/' },
  },
  {
    slug: 'google-docs-to-markdown',
    name: 'Google Docs to Markdown',
    title: 'Google Docs to Markdown Converter',
    description: 'Copy from Google Docs, paste here, get clean Markdown: headings, bold, lists, tables, links and code kept. Also works for Word, Notion and web pages.',
    short: 'Paste formatted text copied from Google Docs, Word or a web page and get Markdown with its structure intact.',
    category: 'text-tools',
    features: ['Reads the formatting of a paste, not just its text', 'Docs quirks handled: styled spans, redirect links, nested lists', 'Headings, bold, italic, strikethrough, code, links, lists, tables', 'Notes tell you what was unwrapped, dropped or approximated', 'Nothing is uploaded — conversion runs in the browser'],
    intent: 'google docs to markdown',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-15',
    spec: { name: 'GitHub Flavored Markdown', url: 'https://github.github.com/gfm/' },
  },

  // ---- Encoders & Decoders -------------------------------------------------
  {
    slug: 'jwt-decoder',
    name: 'JWT Decoder',
    title: 'JWT Decoder — Decode JSON Web Tokens Online',
    description: 'Decode a JWT to see its header, payload and expiry in plain JSON. Runs entirely in your browser — the token is never sent anywhere.',
    short: 'Inspect the header, claims and expiry of a JSON Web Token without sending it anywhere.',
    category: 'encoders',
    features: ['Header and payload as formatted JSON', 'Human-readable exp, iat and nbf', 'Expiry status', 'Fully client-side'],
    intent: 'jwt decoder',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 7519 (JSON Web Token)', url: 'https://www.rfc-editor.org/rfc/rfc7519' },
  },
  {
    slug: 'base64-encode-decode',
    name: 'Base64 Encode / Decode',
    title: 'Base64 Encode and Decode Online',
    description: 'Encode text to Base64 or decode Base64 back to text, with full Unicode support and URL-safe mode. Instant and private — nothing is uploaded.',
    short: 'Convert text to Base64 and back, including UTF-8 and URL-safe variants.',
    category: 'encoders',
    features: ['UTF-8 safe', 'URL-safe alphabet', 'Optional padding removal', 'Clear error on invalid input'],
    intent: 'base64 encode decode',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-14',
    spec: { name: 'RFC 4648 (Base64)', url: 'https://www.rfc-editor.org/rfc/rfc4648' },
  },
  {
    slug: 'base64-to-image',
    name: 'Base64 to Image',
    title: 'Base64 to Image Converter & Decoder',
    description: 'Paste a Base64 string or data URI and see the image. Detects PNG, JPEG, GIF, WebP and SVG from the bytes, shows its size and downloads it correctly named.',
    short: 'Paste Base64 or a data URI, see the image, check its real format and size, and download it.',
    category: 'encoders',
    features: ['Accepts raw Base64, a data: URI, or an <img> or CSS snippet containing one', 'Detects PNG, JPEG, GIF, WebP, SVG, BMP, ICO and AVIF from the bytes', 'Shows pixel dimensions and file size', 'Downloads with the correct extension', 'Warns when the string is truncated or mislabelled'],
    intent: 'base64 to image',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-14',
    spec: { name: 'RFC 2397 (data: URLs)', url: 'https://www.rfc-editor.org/rfc/rfc2397' },
  },
  {
    slug: 'image-to-base64',
    name: 'Image to Base64',
    title: 'Image to Base64 Encoder — Data URI & CSS',
    description: 'Convert an image to Base64 in the browser: drop, pick or paste a PNG, JPEG, GIF, WebP or SVG and copy it as a data URI, <img> tag, CSS url() or raw Base64.',
    short: 'Drop, pick or paste an image and copy it as raw Base64, a data URI, an <img> tag or a CSS url().',
    category: 'encoders',
    features: ['Drag and drop, file picker, or paste from the clipboard', 'Raw Base64, data URI, <img> tag and CSS url() outputs', 'MIME type taken from the file bytes, not the file name', 'Shows the size before and after encoding', 'Nothing is uploaded — encoding runs in the browser'],
    intent: 'image to base64',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-14',
    spec: { name: 'RFC 2397 (data: URLs)', url: 'https://www.rfc-editor.org/rfc/rfc2397' },
  },
  {
    slug: 'url-encode-decode',
    name: 'URL Encode / Decode',
    title: 'URL Encode and Decode Online',
    description: 'Percent-encode text for URLs or decode an encoded URL back to readable text. Choose component or full-URL encoding. Free and private.',
    short: 'Percent-encode query values or whole URLs, or decode them back to plain text.',
    category: 'encoders',
    features: ['Encode a query parameter value', 'Encode a full URL', 'Decode with + as space', 'Clear error on malformed input'],
    intent: 'url encode decode',
    reviewedBy: SITE.author,
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 3986 §2.1 (percent-encoding)', url: 'https://www.rfc-editor.org/rfc/rfc3986#section-2.1' },
  },
];

export const toolBySlug = (slug: string): Tool => {
  const t = TOOLS.find((x) => x.slug === slug);
  if (!t) throw new Error(`Unknown tool: ${slug}`);
  return t;
};

export const toolPath = (t: Tool) => `/tools/${t.slug}`;

export const toolsInCategory = (category: string) => TOOLS.filter((t) => t.category === category);

const RELATED_STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'to', 'for', 'of', 'in', 'with', 'from', 'online',
  'converter', 'convert', 'decoder', 'decode', 'encoder', 'encode', 'generator', 'tool',
]);

/** Lower-cased, stopword-filtered word tokens from a tool's intent and name — what
 * two tools have "in common" for the purpose of ranking related tools. */
function relatedKeywords(t: Tool): Set<string> {
  return new Set(
    `${t.intent} ${t.name}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !RELATED_STOPWORDS.has(w)),
  );
}

/**
 * 3–5 related tools, ranked by topic first, category second — so a page about
 * JSON surfaces the other JSON tools before an unrelated tool that only
 * happens to share a category (seo-rules' categories group by *shape of
 * job* — Converters holds JSON, CSV, color and number tools side by side —
 * not by topic, so "same category" alone was a weak signal: JSON Formatter's
 * related section used to lead with Column↔List tools, ahead of CSV↔JSON,
 * purely because of registry order). Same category still breaks a tie
 * between two topically-unrelated tools, and the original registry order
 * settles any tie beyond that (Array#sort is stable).
 */
export function relatedTools(tool: Tool, max = 4): Tool[] {
  const mine = relatedKeywords(tool);
  const scored = TOOLS.filter((t) => t.slug !== tool.slug).map((t) => {
    let overlap = 0;
    for (const word of relatedKeywords(t)) if (mine.has(word)) overlap++;
    return { t, score: overlap * 10 + (t.category === tool.category ? 1 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(3, Math.min(max, 5))).map((s) => s.t);
}

/** The most recent review date across all tools — used as the site-level dateModified. */
export const latestReviewDate = (): string => TOOLS.map((t) => t.reviewedOn).sort().at(-1) ?? SITE.launched;
