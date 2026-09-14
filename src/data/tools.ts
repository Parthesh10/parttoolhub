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
  /** Feature bullets for SoftwareApplication schema. */
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
    reviewedOn: '2026-09-13',
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
    reviewedOn: '2026-09-13',
    spec: { name: 'RFC 4648 (Base64)', url: 'https://www.rfc-editor.org/rfc/rfc4648' },
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

/**
 * 3–5 related tools: same category first, then fill from the rest so the
 * section is never thin on a small category.
 */
export function relatedTools(tool: Tool, max = 4): Tool[] {
  const same = TOOLS.filter((t) => t.category === tool.category && t.slug !== tool.slug);
  const others = TOOLS.filter((t) => t.category !== tool.category);
  return [...same, ...others].slice(0, Math.max(3, Math.min(max, 5)));
}

/** The most recent review date across all tools — used as the site-level dateModified. */
export const latestReviewDate = (): string => TOOLS.map((t) => t.reviewedOn).sort().at(-1) ?? SITE.launched;
