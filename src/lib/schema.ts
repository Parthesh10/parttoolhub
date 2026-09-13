import { SITE } from '../site.config';

/**
 * Stable @id for the maintainer, so the WebSite on every page and the
 * SoftwareApplication on every tool page point at one Person entity instead
 * of each repeating it. seo-rules.md §2 / §4A.
 */
export const AUTHOR_ID = `${SITE.url}/#author`;

export const authorSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': AUTHOR_ID,
  name: SITE.author,
  url: new URL(SITE.authorUrl, SITE.url).href,
  ...(SITE.github || SITE.linkedin
    ? { sameAs: ([SITE.github, SITE.linkedin] as string[]).filter(Boolean) }
    : {}),
};
