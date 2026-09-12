/**
 * Single registry of every tool on the site. Pages, the home grid, category
 * hubs, breadcrumbs and Related Tools all read from here, and tests/registry
 * enforces the SEO constraints (title < 60 chars, description < 155 chars,
 * unique slugs, valid category).
 *
 * To add a tool: add an entry here, create src/pages/tools/<slug>.astro and
 * the component under src/components/tools/.
 */
export interface Tool {
  /** URL segment under /tools/. */
  slug: string;
  /** Short display name for grids and links. */
  name: string;
  /** <title> — primary keyword first, under 60 characters. */
  title: string;
  /** <meta description> — states the problem solved, under 155 characters. */
  description: string;
  /** One-line summary for directory cards. */
  short: string;
  category: string;
  /** Feature bullets for SoftwareApplication schema. */
  features: string[];
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
  },
  {
    slug: 'comma-separated-list-to-column',
    name: 'Comma Separated List to Column',
    title: 'Comma Separated List to Column Converter',
    description: 'Split a comma, semicolon, pipe or tab separated list into one item per line. Auto-detects the separator, strips quotes, removes duplicates and sorts.',
    short: 'Split any delimited text into one item per line; separator detected automatically.',
    category: 'converters',
    features: ['Automatic separator detection', 'Strip quotes and brackets', 'Remove duplicates', 'Sort and change case'],
  },
  {
    slug: 'json-formatter',
    name: 'JSON Formatter & Validator',
    title: 'JSON Formatter, Validator & Beautifier',
    description: 'Format, validate and minify JSON online. Pinpoints syntax errors by line and column, sorts keys, and never sends your data to a server.',
    short: 'Beautify or minify JSON and see exactly where a syntax error is.',
    category: 'converters',
    features: ['Beautify with 2 or 4 spaces or tabs', 'Minify', 'Error line and column', 'Sort keys alphabetically'],
  },
  {
    slug: 'python-dict-to-json',
    name: 'Python Dict to JSON',
    title: 'Python Dict to JSON Converter',
    description: 'Convert a Python dictionary or list literal into valid JSON. Handles single quotes, True/False/None, tuples, sets, comments and trailing commas.',
    short: 'Paste a printed Python dict and get valid JSON with proper quotes, true/false and null.',
    category: 'converters',
    features: ['Single-quoted strings', 'True/False/None to true/false/null', 'Tuples and sets to arrays', 'Trailing commas and comments'],
  },

  // ---- Text Tools ----------------------------------------------------------
  {
    slug: 'title-case-converter',
    name: 'Title Case Converter',
    title: 'Title Case Converter — APA, Chicago, AP, MLA',
    description: 'Capitalize titles correctly in APA, Chicago, AP or MLA style, or switch to sentence case, UPPERCASE or lowercase. Free, instant, private.',
    short: 'Capitalize headlines and titles by style guide, or switch to sentence, upper or lower case.',
    category: 'text-tools',
    features: ['APA, Chicago, AP and MLA rules', 'Sentence case', 'UPPERCASE and lowercase', 'Keeps acronyms intact'],
  },
  {
    slug: 'ai-text-cleaner',
    name: 'AI Text Cleaner',
    title: 'AI Text Cleaner — Remove Markdown & Hidden Characters',
    description: 'Clean up ChatGPT and other AI output: strip Markdown symbols, replace em dashes, straighten smart quotes, and delete invisible characters and citations.',
    short: 'Strip Markdown, em dashes, smart quotes, emoji, citations and hidden characters from AI output.',
    category: 'text-tools',
    features: ['Remove Markdown formatting', 'Replace em and en dashes', 'Straighten curly quotes', 'Delete zero-width and invisible characters', 'Remove emoji and citation markers'],
  },
  {
    slug: 'remove-duplicate-lines',
    name: 'Remove Duplicate Lines',
    title: 'Remove Duplicate Lines Online',
    description: 'Delete duplicate lines from any text or list in one paste. Case-insensitive matching, trim before comparing, keep first or last, and optional sorting.',
    short: 'Keep only unique lines from a list, with case-insensitive and trimming options.',
    category: 'text-tools',
    features: ['Case-insensitive matching', 'Trim before comparing', 'Keep first or last occurrence', 'Sort the result'],
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
  },
  {
    slug: 'base64-encode-decode',
    name: 'Base64 Encode / Decode',
    title: 'Base64 Encode and Decode Online',
    description: 'Encode text to Base64 or decode Base64 back to text, with full Unicode support and URL-safe mode. Instant and private — nothing is uploaded.',
    short: 'Convert text to Base64 and back, including UTF-8 and URL-safe variants.',
    category: 'encoders',
    features: ['UTF-8 safe', 'URL-safe alphabet', 'Optional padding removal', 'Clear error on invalid input'],
  },
  {
    slug: 'url-encode-decode',
    name: 'URL Encode / Decode',
    title: 'URL Encode and Decode Online',
    description: 'Percent-encode text for URLs or decode an encoded URL back to readable text. Choose component or full-URL encoding. Free and private.',
    short: 'Percent-encode query values or whole URLs, or decode them back to plain text.',
    category: 'encoders',
    features: ['Encode a query parameter value', 'Encode a full URL', 'Decode with + as space', 'Clear error on malformed input'],
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
