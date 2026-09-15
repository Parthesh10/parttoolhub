/**
 * Lorem Ipsum placeholder text generation. Unlike this site's other two
 * Generators (UUID, Password), nothing here is security-sensitive — the
 * output only needs to look like plausible filler text, never to be
 * unpredictable to an attacker — so `Math.random()` is the *correct* choice
 * here, not `crypto.getRandomValues()`. Pure, no DOM.
 */

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';

export interface LoremOptions {
  unit: LoremUnit;
  count: number;
  startWithLorem: boolean;
}

export const DEFAULT_LOREM_OPTIONS: LoremOptions = { unit: 'paragraphs', count: 3, startWithLorem: true };

export const MIN_COUNT = 1;
export const MAX_COUNT = 50;

// The traditional Lorem Ipsum word bank (from Cicero's De Finibus, via the
// standard scrambled passage every Lorem Ipsum generator descends from) —
// public domain Latin, not copyrighted content.
export const WORD_BANK = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi',
  'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit',
  'voluptate', 'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
  'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
  'mollit', 'anim', 'id', 'est', 'laborum', 'at', 'vero', 'eos', 'accusamus', 'iusto', 'odio',
  'dignissimos', 'ducimus', 'blanditiis', 'praesentium', 'voluptatum', 'deleniti', 'atque',
  'corrupti', 'quos', 'quas', 'molestias', 'excepturi', 'sint', 'occaecati', 'cupiditate',
  'similique', 'rerum', 'facilis', 'expedita', 'distinctio', 'nam', 'libero', 'tempore', 'cum',
  'soluta', 'nobis', 'eligendi', 'optio', 'cumque', 'nihil', 'impedit', 'quo', 'minus', 'quod',
  'maxime', 'placeat', 'facere', 'possimus', 'omnis', 'assumenda', 'repellendus', 'temporibus',
  'quibusdam', 'officiis', 'debitis', 'necessitatibus', 'saepe', 'eveniet', 'voluptates',
  'repudiandae', 'recusandae', 'itaque', 'earum', 'hic', 'tenetur', 'sapiente', 'delectus',
  'reiciendis', 'voluptatibus', 'maiores', 'alias', 'perferendis', 'doloribus', 'asperiores',
  'repellat',
];

const LOREM_OPENING = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function pickWord(): string {
  return WORD_BANK[randomInt(WORD_BANK.length)];
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** `n` lowercase words, no punctuation — the raw material every other unit builds from. */
export function makeWords(n: number, startWithLorem = false): string[] {
  const words: string[] = [];
  if (startWithLorem) words.push(...LOREM_OPENING.slice(0, Math.min(n, LOREM_OPENING.length)));
  while (words.length < n) words.push(pickWord());
  return words.slice(0, n);
}

/** One sentence: 6-18 words, capitalized, comma inserted once past word 3 on longer sentences, period-terminated. */
function makeSentence(startWithLorem = false): string {
  const length = 6 + randomInt(13);
  const words = makeWords(length, startWithLorem);
  let text = words.join(' ');
  // The comma must land after the forced opening phrase, or it would cut "Lorem
  // ipsum dolor sit amet" in two and break the literal-prefix guarantee callers rely on.
  const minCommaAt = startWithLorem ? Math.min(LOREM_OPENING.length, length - 1) : 3;
  if (length >= 10 && minCommaAt < length - 1) {
    const commaAt = minCommaAt + randomInt(length - 1 - minCommaAt);
    const parts = text.split(' ');
    parts[commaAt] += ',';
    text = parts.join(' ');
  }
  return capitalize(text) + '.';
}

export function makeSentences(n: number, startWithLorem = false): string[] {
  return Array.from({ length: n }, (_, i) => makeSentence(startWithLorem && i === 0));
}

/** One paragraph: 3-7 sentences joined with single spaces. */
function makeParagraph(startWithLorem = false): string {
  const count = 3 + randomInt(5);
  return makeSentences(count, startWithLorem).join(' ');
}

export function makeParagraphs(n: number, startWithLorem = false): string[] {
  return Array.from({ length: n }, (_, i) => makeParagraph(startWithLorem && i === 0));
}

export type LoremResult = { ok: true; value: { text: string; unitCount: number; wordCount: number } } | { ok: false; error: string };

export function generateLorem(options: Partial<LoremOptions> = {}): LoremResult {
  const opts = { ...DEFAULT_LOREM_OPTIONS, ...options };
  const count = Math.floor(opts.count);
  if (!Number.isFinite(count) || count < MIN_COUNT || count > MAX_COUNT) {
    return { ok: false, error: `Choose a count between ${MIN_COUNT} and ${MAX_COUNT}.` };
  }

  let parts: string[];
  if (opts.unit === 'words') parts = makeWords(count, opts.startWithLorem).map((w, i) => (i === 0 ? capitalize(w) : w));
  else if (opts.unit === 'sentences') parts = makeSentences(count, opts.startWithLorem);
  else parts = makeParagraphs(count, opts.startWithLorem);

  const text = opts.unit === 'words' ? parts.join(' ') : parts.join(opts.unit === 'sentences' ? ' ' : '\n\n');
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { ok: true, value: { text, unitCount: count, wordCount } };
}
