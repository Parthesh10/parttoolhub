/**
 * Programming identifier case conversion (camelCase, PascalCase, snake_case,
 * CONSTANT_CASE, kebab-case, dot.case). Pure, no DOM.
 *
 * Distinct from title-case.ts, which handles prose headlines and style-guide
 * capitalization rules (APA/Chicago/AP/MLA), not identifier tokens — the two
 * tools solve different problems even though both "change casing".
 *
 * The whole input is treated as one phrase: existing separators (spaces,
 * `_`, `-`, `.`, line breaks) and camelCase/PascalCase boundaries are all
 * normalised into word tokens, then rejoined in each target style. A
 * multi-line paste is not converted line by line — every line break is just
 * another word boundary, the same as a space.
 */

export type CaseStyle = 'camel' | 'pascal' | 'snake' | 'constant' | 'kebab' | 'dot';

export const CASE_LABELS: Record<CaseStyle, string> = {
  camel: 'camelCase',
  pascal: 'PascalCase',
  snake: 'snake_case',
  constant: 'CONSTANT_CASE',
  kebab: 'kebab-case',
  dot: 'dot.case',
};

export const SAMPLE_INPUT = 'userFirstName';

/**
 * Split into word tokens. Order matters: first split at a lower/digit → upper
 * boundary ("myVariable" → "my Variable"), then at an acronym → word boundary
 * ("XMLHttp" → "XML Http", so "XMLHttpRequest" tokenises as XML/Http/Request
 * rather than X/M/L/Http/Request), then normalise every remaining separator.
 */
export function tokenize(input: string): string[] {
  let s = input.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  s = s.replace(/[_\-.\s]+/g, ' ').trim();
  if (!s) return [];
  return s.split(' ');
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function toCase(tokens: string[], style: CaseStyle): string {
  if (!tokens.length) return '';
  switch (style) {
    case 'camel':
      return tokens[0].toLowerCase() + tokens.slice(1).map(cap).join('');
    case 'pascal':
      return tokens.map(cap).join('');
    case 'snake':
      return tokens.map((t) => t.toLowerCase()).join('_');
    case 'constant':
      return tokens.map((t) => t.toUpperCase()).join('_');
    case 'kebab':
      return tokens.map((t) => t.toLowerCase()).join('-');
    case 'dot':
      return tokens.map((t) => t.toLowerCase()).join('.');
  }
}

export function convertCase(input: string, style: CaseStyle): string {
  return toCase(tokenize(input), style);
}

/** Every style at once, for the widget's result grid. */
export function convertAll(input: string): Record<CaseStyle, string> {
  const tokens = tokenize(input);
  const out = {} as Record<CaseStyle, string>;
  for (const style of Object.keys(CASE_LABELS) as CaseStyle[]) out[style] = toCase(tokens, style);
  return out;
}
