import { SITE } from '../site.config';

/**
 * Stable @ids so every page's JSON-LD points at one Person and one WebSite
 * entity instead of repeating them: the WebSite (Base.astro) and each tool
 * page's WebPage (ToolLayout.astro) reference AUTHOR_ID; each page's WebPage /
 * CollectionPage references WEBSITE_ID via isPartOf. seo-rules.md §2 / §4A.
 */
export const AUTHOR_ID = `${SITE.url}/#author`;
export const WEBSITE_ID = `${SITE.url}/#website`;

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
