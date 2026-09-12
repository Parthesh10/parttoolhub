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
}

export const CATEGORIES: Category[] = [
  {
    slug: 'converters',
    name: 'Converters & Formatters',
    description: 'Free online converters and formatters: reshape lists, format and validate JSON, and turn Python dicts into JSON — all in your browser.',
    blurb: 'Reshape data from one form into another without leaving the browser.',
  },
  {
    slug: 'text-tools',
    name: 'Text Tools',
    description: 'Free text utilities: convert titles to the correct case, clean AI-generated text, and remove duplicate lines — fast and private.',
    blurb: 'Fix, clean and tidy plain text in one paste.',
  },
  {
    slug: 'encoders',
    name: 'Encoders & Decoders',
    description: 'Decode JWTs, encode and decode Base64 and URL strings instantly. Nothing you paste leaves your device.',
    blurb: 'Encode, decode and inspect tokens and strings.',
  },
];

export const categoryBySlug = (slug: string): Category => {
  const c = CATEGORIES.find((x) => x.slug === slug);
  if (!c) throw new Error(`Unknown category: ${slug}`);
  return c;
};
