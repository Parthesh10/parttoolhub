/**
 * Title-case and general case conversion. Pure, no DOM.
 *
 * Style guides disagree mainly on prepositions: APA and AP capitalize any word
 * of four or more letters, while Chicago and MLA lowercase every preposition
 * regardless of length. All four lowercase articles and coordinating
 * conjunctions, and all capitalize the first and last word.
 */
export type TitleStyle = 'apa' | 'chicago' | 'ap' | 'mla';
export type CaseMode = 'title' | 'sentence' | 'upper' | 'lower' | 'capitalize' | 'alternating' | 'toggle';

const ARTICLES = ['a', 'an', 'the'];
const CONJUNCTIONS = ['and', 'but', 'or', 'nor', 'for', 'so', 'yet'];
const SHORT_PREPS = ['as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'vs', 'v'];
const LONG_PREPS = [
  'from', 'with', 'into', 'onto', 'over', 'than', 'upon', 'out', 'like', 'near', 'till', 'until',
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'before', 'behind',
  'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except', 'inside', 'outside',
  'through', 'toward', 'towards', 'under', 'within', 'without',
];

const MINOR_SHORT = new Set([...ARTICLES, ...CONJUNCTIONS, ...SHORT_PREPS]);
const MINOR_ALL = new Set([...MINOR_SHORT, ...LONG_PREPS]);

function isMinor(word: string, style: TitleStyle): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (style === 'apa' || style === 'ap') return MINOR_SHORT.has(w) && w.length <= 3;
  return MINOR_ALL.has(w);
}

/** Uppercase the first letter, leaving any leading quote/bracket alone. */
function capitalizeWord(word: string): string {
  const m = word.match(/^([^\p{L}\p{N}]*)(\p{L})(.*)$/su);
  if (!m) return word;
  return m[1] + m[2].toUpperCase() + m[3];
}

/** "NASA", "iOS", "eBay" and "macOS" should be left alone in a mixed-case line. */
function looksIntentional(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  const hasUpper = /\p{Lu}/u.test(letters.slice(1));
  return hasUpper; // any capital after the first letter → acronym or brand casing
}

export interface TitleOptions {
  style: TitleStyle;
  /** Leave words like NASA or iPhone unchanged. Default true. */
  preserveIntentionalCase: boolean;
}

export function titleCaseLine(line: string, opts: Partial<TitleOptions> = {}): string {
  const style = opts.style ?? 'apa';
  const preserve = opts.preserveIntentionalCase ?? true;
  if (!line.trim()) return line;

  // An all-caps line carries no casing information; normalise it first.
  const source = line === line.toUpperCase() && /\p{L}/u.test(line) ? line.toLowerCase() : line;

  // Split keeping whitespace so spacing is preserved exactly.
  const tokens = source.split(/(\s+)/);
  const wordIdx = tokens.map((t, i) => (i % 2 === 0 && t.length ? i : -1)).filter((i) => i >= 0);
  const first = wordIdx[0];
  const last = wordIdx[wordIdx.length - 1];

  let afterBreak = true; // start of title, or after ":" "—" "?" "!" "."
  return tokens
    .map((tok, i) => {
      if (i % 2 === 1 || !tok.length) return tok;
      const forceCap = i === first || i === last || afterBreak;
      afterBreak = /[:—–?!.]["')\]]*$/.test(tok);

      if (preserve && looksIntentional(tok)) return tok;

      // Hyphenated compounds: capitalise each part ("Self-Driving", "Out-of-Date").
      const parts = tok.split('-');
      const out = parts.map((p, pi) => {
        const lower = p.toLowerCase();
        const minor = isMinor(lower, style);
        if (forceCap && pi === 0) return capitalizeWord(lower);
        if (minor && !(forceCap && pi === 0)) return lower;
        return capitalizeWord(lower);
      });
      return out.join('-');
    })
    .join('');
}

export function sentenceCaseLine(line: string): string {
  const lower = line.toLowerCase();
  // Capitalise the first letter of the line and after sentence-ending punctuation.
  let out = lower.replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase());
  // The pronoun "I" is always capitalised.
  out = out.replace(/\bi\b(?=['’]|\s|$)/g, 'I');
  return out;
}

export function convertCase(text: string, mode: CaseMode, opts: Partial<TitleOptions> = {}): string {
  const lines = text.split(/\r\n|\r|\n/);
  const map = (fn: (l: string) => string) => lines.map(fn).join('\n');

  switch (mode) {
    case 'title':
      return map((l) => titleCaseLine(l, opts));
    case 'sentence':
      return map(sentenceCaseLine);
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'capitalize':
      return map((l) => l.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase()));
    case 'alternating': {
      let i = 0;
      return text.replace(/\p{L}/gu, (ch) => (i++ % 2 === 0 ? ch.toLowerCase() : ch.toUpperCase()));
    }
    case 'toggle':
      return text.replace(/\p{L}/gu, (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()));
  }
}

export const STYLE_LABELS: Record<TitleStyle, string> = {
  apa: 'APA',
  chicago: 'Chicago',
  ap: 'AP',
  mla: 'MLA',
};
