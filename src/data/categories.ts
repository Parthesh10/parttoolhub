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
    description: 'Free online converters and formatters: reshape lists, format and validate JSON, turn Python dicts into JSON, HTML into Markdown, all in your browser.',
    blurb: 'Reshape data from one form into another without leaving the browser.',
    intro: [
      'These tools take data that is already correct and change its <em>shape</em>: a column of IDs into a comma list for a SQL <code>IN</code> clause, a minified API response into indented JSON you can read, a printed Python dict into JSON a config file will accept. None of them alter the values themselves, and each one shows a counter or a status line so you can see what went in and what came out.',
      'Which one you need depends on where the data is going. Moving values between a spreadsheet and code, use <a href="/tools/column-to-comma-separated-list">Column to Comma Separated List</a> or its reverse, <a href="/tools/comma-separated-list-to-column">Comma Separated List to Column</a>; they hand off to each other with one click. If a JSON payload will not parse, the <a href="/tools/json-formatter">JSON Formatter</a> reports the line and column of the fault. If the text only <em>looks</em> like JSON because it came from Python (single quotes, <code>True</code>, <code>None</code>), start with <a href="/tools/python-dict-to-json">Python Dict to JSON</a> instead, or go the other way with <a href="/tools/json-to-python-dict">JSON to Python Dict</a>. Page source that needs to become a README or a note is a job for <a href="/tools/html-to-markdown">HTML to Markdown</a>, which keeps headings, lists, tables and links and escapes the characters Markdown would otherwise misread.',
    ],
  },
  {
    slug: 'text-tools',
    name: 'Text Tools',
    description: 'Free text utilities: fix title case, clean AI text, remove duplicate lines, and turn Markdown into plain text, a Google Docs paste, or a .docx file.',
    blurb: 'Fix, clean and tidy plain text in one paste.',
    intro: [
      'Plain-text chores that a find-and-replace almost handles but not quite: capitalising a headline by a style guide\'s rules rather than every word, stripping the Markdown and typographic punctuation a chat assistant leaves in pasted text, or reducing a merged list to one copy of each line. Each tool applies a fixed rule set as you type, so the same input always gives the same result.',
      'Use the <a href="/tools/title-case-converter">Title Case Converter</a> when a title has to follow APA, Chicago, AP or MLA capitalisation, or when you need sentence case, UPPERCASE or lowercase. Use the <a href="/tools/ai-text-cleaner">AI Text Cleaner</a> on anything copied out of ChatGPT, Claude or Gemini before it goes into an email, a CMS field or a document. Use <a href="/tools/remove-duplicate-lines">Remove Duplicate Lines</a> on exports, mailing lists and log excerpts; if the duplicates are in a comma-separated line rather than a column, the <a href="/tools/comma-separated-list-to-column">list to column</a> converter has a dedupe option too. When the AI answer is going somewhere that does not render Markdown, <a href="/tools/markdown-to-plain-text">Markdown to Plain Text</a> keeps the bullets, numbering and tables as readable text (or as Slack, WhatsApp and Google Chat markup); when it is going into a document, <a href="/tools/markdown-to-google-docs">Markdown to Google Docs</a> puts formatted text on the clipboard so headings, lists and tables paste intact, <a href="/tools/markdown-to-word">Markdown to Word</a> downloads an actual .docx file when a paste isn\'t practical (email attachments, a file a colleague expects, uploading to a system that wants a real document). <a href="/tools/google-docs-to-markdown">Google Docs to Markdown</a> is the way back: it reads the formatting of whatever you copied from Docs, Word or a web page.',
    ],
  },
  {
    slug: 'encoders',
    name: 'Encoders & Decoders',
    description: 'Decode JWTs, encode and decode Base64 and URL strings, and turn images into data URIs and back. Nothing you paste leaves your device.',
    blurb: 'Encode, decode and inspect tokens and strings.',
    intro: [
      'Encoding turns bytes or text into a form that survives a channel with rules about which characters are allowed (a URL, an HTTP header, a JSON string). None of it is encryption: every encoding here is reversible with no key, which is exactly why a decoder is safe to run in your browser and why it can never tell you whether a token is genuine, only what it says.',
      'Decode a <a href="/tools/jwt-decoder">JWT</a> when an API call returns 401 and you want to see the claims and expiry the server saw. Use <a href="/tools/base64-encode-decode">Base64</a> for <code>Authorization: Basic</code> headers, data URIs and anything that arrived as a block of letters ending in <code>=</code>; a JWT\'s segments are Base64URL, so the two tools overlap deliberately. Use <a href="/tools/url-encode-decode">URL encode/decode</a> for query-string values. The most common mistake it prevents is running a whole URL through component encoding and escaping the slashes that make it a URL. When the Base64 is an image rather than text, the text decoder can only say “not UTF-8”: <a href="/tools/base64-to-image">Base64 to Image</a> shows the picture, names its real format and downloads it, and <a href="/tools/image-to-base64">Image to Base64</a> goes the other way, from a file to a data URI, <code>&lt;img&gt;</code> tag or CSS <code>url()</code>.',
    ],
  },
  {
    slug: 'generators',
    name: 'Generators',
    description: 'Generate UUIDs, strong passwords and Lorem Ipsum placeholder text on demand, right in your browser. Nothing is sent anywhere.',
    blurb: 'Produce a random or structured value on demand, instead of converting one you already have.',
    intro: [
      'Everything else on this site starts from something you paste; these tools start from nothing and hand you a value instead: a random identifier for a new database row, a password for a new account, filler text for a layout you\'re still designing. Randomness quality here depends on what the value is for: an identifier or password draws from your browser\'s cryptographically secure random number generator (the same source TLS and password managers use, never <code>Math.random()</code>), because predictability there is a real security risk. Placeholder text has no such requirement (nothing depends on an attacker being unable to guess the next Lorem Ipsum word), so that generator uses the ordinary, faster random source instead.',
      'Use the <a href="/tools/uuid-generator">UUID Generator</a> when you need a unique identifier: version 4 for a plain random ID with no hidden structure, or version 7 when the ID also needs to sort roughly by creation time, which matters for database primary keys and anywhere insertion order should still be recoverable from the ID itself. Use the <a href="/tools/password-generator">Password Generator</a> when the value is for a person to type or a password manager to store. It reports the real entropy in bits, not just a length, and can guarantee at least one of each character type you ask for. Use the <a href="/tools/lorem-ipsum-generator">Lorem Ipsum Generator</a> when you need filler text for a mockup, a CMS template or a print layout, by words, sentences or paragraphs.',
    ],
  },
];

export const categoryBySlug = (slug: string): Category => {
  const c = CATEGORIES.find((x) => x.slug === slug);
  if (!c) throw new Error(`Unknown category: ${slug}`);
  return c;
};
