/**
 * Command palette intent-synonym matching (UX-012): the tool's own name,
 * short description and category are checked first (see floating-tools.
 * client.ts's score()), but a lot of real queries use words that never
 * appear on the page at all -- "pretty json" for the JSON Formatter,
 * "epoch" for the Unix Timestamp Converter, "dedupe" for Remove Duplicate
 * Lines. This is the list of those alternate phrasings, keyed by slug.
 */

export const TOOL_SYNONYMS: Record<string, string[]> = {
  'json-formatter': ['pretty json', 'beautify json', 'minify json', 'json validator', 'json lint', 'json viewer'],
  'python-dict-to-json': ['python to json', 'dict to json'],
  'json-to-python-dict': ['json to python', 'json to dict'],
  'csv-to-json-converter': ['csv to json'],
  'json-to-csv-converter': ['json to csv'],
  'unix-timestamp-converter': ['unix time', 'epoch', 'epoch converter', 'epoch time', 'timestamp to date'],
  'date-difference-calculator': ['days between dates', 'date diff', 'date calculator'],
  'data-size-converter': ['bytes to mb', 'file size converter', 'kb to mb', 'gb to mb', 'byte converter'],
  'color-converter': ['hex to rgb', 'rgb to hex', 'hex to hsl', 'hsl to hex', 'color picker'],
  'number-base-converter': ['binary to decimal', 'hex to binary', 'decimal to hex', 'hex to decimal', 'binary converter'],
  'html-to-markdown': ['html to md'],
  'uuid-generator': ['guid generator', 'generate uuid', 'random id generator'],
  'password-generator': ['random password', 'strong password', 'secure password generator'],
  'lorem-ipsum-generator': ['placeholder text', 'dummy text', 'filler text'],
  'code-case-converter': ['camelcase converter', 'snake case', 'kebab case', 'pascal case', 'case converter'],
  'title-case-converter': ['capitalize', 'capitalize words'],
  'ai-text-cleaner': ['clean chatgpt text', 'remove ai formatting', 'strip em dash', 'remove curly quotes'],
  'remove-duplicate-lines': ['dedupe', 'dedup', 'unique lines', 'deduplicate'],
  'markdown-to-plain-text': ['strip markdown', 'markdown to text', 'remove markdown formatting'],
  'markdown-to-google-docs': ['md to docs', 'paste markdown into docs'],
  'markdown-to-word': ['markdown to docx', 'md to word', 'markdown to doc'],
  'google-docs-to-markdown': ['docs to markdown', 'docs to md'],
  'jwt-decoder': ['decode jwt', 'jwt parser', 'jwt viewer'],
  'base64-encode-decode': ['base64 decode', 'base64 encode', 'atob', 'btoa'],
  'base64-to-image': ['base64 to png', 'decode base64 image', 'base64 to jpg'],
  'image-to-base64': ['image to data uri', 'png to base64', 'image to base64 string'],
  'url-encode-decode': ['percent encoding', 'uri encode', 'urlencode', 'uri decode'],
  'column-to-comma-separated-list': ['column to csv line', 'lines to comma list', 'rows to comma list'],
  'comma-separated-list-to-column': ['csv to column', 'split comma list', 'comma list to lines'],
};

/** True if `query` and any of the slug's synonym phrases overlap, in either direction. */
export function matchesSynonym(slug: string, query: string): boolean {
  const phrases = TOOL_SYNONYMS[slug];
  if (!phrases || !query) return false;
  return phrases.some((phrase) => phrase.includes(query) || query.includes(phrase));
}
