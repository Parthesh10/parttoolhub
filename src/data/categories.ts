/**
 * Category taxonomy. The slug is the URL of the category hub page (/converters)
 * and the grouping key for the home directory, breadcrumbs and Related Tools.
 */
export interface Category {
  slug: string;
  name: string;
  /** Under 155 chars — used as the hub page's meta description. */
  description: string;
  /** One line shown under the category heading on the home page. */
  blurb: string;
  /**
   * 1–2 paragraphs for the hub page (seo-rules §3.4): when you'd reach for this
   * family of tools and which tool to use for what. HTML allowed for links to
   * the tools; keep it specific — a hub with only cards is a thin page.
   */
  intro: string[];
}

export const CATEGORIES: Category[] = [
  {
    slug: 'converters',
    name: 'Converters & Formatters',
    description: 'Free online converters and formatters: reshape lists, format and validate JSON, and turn Python dicts into JSON — all in your browser.',
    blurb: 'Reshape data from one form into another without leaving the browser.',
    intro: [
      'These tools take data that is already correct and change its <em>shape</em>: a column of IDs into a comma list for a SQL <code>IN</code> clause, a minified API response into indented JSON you can read, a printed Python dict into JSON a config file will accept. None of them alter the values themselves, and each one shows a counter or a status line so you can see what went in and what came out.',
      'Which one you need depends on where the data is going. Moving values between a spreadsheet and code, use <a href="/tools/column-to-comma-separated-list">Column to Comma Separated List</a> or its reverse, <a href="/tools/comma-separated-list-to-column">Comma Separated List to Column</a> — they hand off to each other with one click. If a JSON payload will not parse, the <a href="/tools/json-formatter">JSON Formatter</a> reports the line and column of the fault. If the text only <em>looks</em> like JSON because it came from Python (single quotes, <code>True</code>, <code>None</code>), start with <a href="/tools/python-dict-to-json">Python Dict to JSON</a> instead — or go the other way with <a href="/tools/json-to-python-dict">JSON to Python Dict</a>.',
    ],
  },
  {
    slug: 'text-tools',
    name: 'Text Tools',
    description: 'Free text utilities: convert titles to the correct case, clean AI-generated text, and remove duplicate lines — fast and private.',
    blurb: 'Fix, clean and tidy plain text in one paste.',
    intro: [
      'Plain-text chores that a find-and-replace almost handles but not quite: capitalising a headline by a style guide\'s rules rather than every word, stripping the Markdown and typographic punctuation a chat assistant leaves in pasted text, or reducing a merged list to one copy of each line. Each tool applies a fixed rule set as you type, so the same input always gives the same result.',
      'Use the <a href="/tools/title-case-converter">Title Case Converter</a> when a title has to follow APA, Chicago, AP or MLA capitalisation, or when you need sentence case, UPPERCASE or lowercase. Use the <a href="/tools/ai-text-cleaner">AI Text Cleaner</a> on anything copied out of ChatGPT, Claude or Gemini before it goes into an email, a CMS field or a document. Use <a href="/tools/remove-duplicate-lines">Remove Duplicate Lines</a> on exports, mailing lists and log excerpts; if the duplicates are in a comma-separated line rather than a column, the <a href="/tools/comma-separated-list-to-column">list to column</a> converter has a dedupe option too.',
    ],
  },
  {
    slug: 'encoders',
    name: 'Encoders & Decoders',
    description: 'Decode JWTs, encode and decode Base64 and URL strings instantly. Nothing you paste leaves your device.',
    blurb: 'Encode, decode and inspect tokens and strings.',
    intro: [
      'Encoding turns bytes or text into a form that survives a channel with rules about which characters are allowed — a URL, an HTTP header, a JSON string. None of it is encryption: every encoding here is reversible with no key, which is exactly why a decoder is safe to run in your browser and why it can never tell you whether a token is genuine, only what it says.',
      'Decode a <a href="/tools/jwt-decoder">JWT</a> when an API call returns 401 and you want to see the claims and expiry the server saw. Use <a href="/tools/base64-encode-decode">Base64</a> for <code>Authorization: Basic</code> headers, data URIs and anything that arrived as a block of letters ending in <code>=</code>; a JWT\'s segments are Base64URL, so the two tools overlap deliberately. Use <a href="/tools/url-encode-decode">URL encode/decode</a> for query-string values — the most common mistake it prevents is running a whole URL through component encoding and escaping the slashes that make it a URL.',
    ],
  },
  {
    slug: 'generators',
    name: 'Generators',
    description: 'Generate UUIDs and other values you need on demand, right in your browser — nothing predictable, nothing sent anywhere.',
    blurb: 'Produce a random or structured value on demand, instead of converting one you already have.',
    intro: [
      'Everything else on this site starts from something you paste; these tools start from nothing and hand you a value instead — a random identifier for a new database row, a batch of test IDs, a placeholder to fill in a form. What they generate is either genuinely random (drawn from your browser\'s cryptographically secure random number generator, the same source TLS and password managers use) or built from a stated, checkable rule, never from a predictable counter.',
      'Use the <a href="/tools/uuid-generator">UUID Generator</a> when you need a unique identifier: version 4 for a plain random ID with no hidden structure, or version 7 when the ID also needs to sort roughly by creation time, which matters for database primary keys and anywhere insertion order should still be recoverable from the ID itself.',
    ],
  },
];

export const categoryBySlug = (slug: string): Category => {
  const c = CATEGORIES.find((x) => x.slug === slug);
  if (!c) throw new Error(`Unknown category: ${slug}`);
  return c;
};
