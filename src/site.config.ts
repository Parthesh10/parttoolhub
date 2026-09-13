/**
 * Single source of truth for brand, domain and monetisation settings.
 * Change these once you own a domain and have an AdSense account.
 */
export const SITE = {
  name: 'PartToolHub',
  tagline: 'Fast, private tools for text, data and code that run in your browser',
  url: 'https://parttoolhub.com',
  /**
   * The person who builds and reviews the site. A real name, not the brand:
   * it appears in the footer, the "Last reviewed by" line on every tool page,
   * the Person JSON-LD, and on /about (seo-rules.md §4A — an unnamed
   * maintainer is the most common AdSense "low value content" trigger).
   */
  author: 'Parthesh Motorwala',
  /** Path of the page that introduces the maintainer; linked from the review line. */
  authorUrl: '/about',
  /**
   * Public source repository. Leave empty while the repo is private — an
   * empty value renders no link anywhere (a dead GitHub link is worse than
   * none). Fill in once the repo is public: it backs the "nothing is uploaded"
   * claim with inspectable code, and feeds the Person schema's sameAs.
   */
  github: '',
  /** Contact address surfaced on /contact and in the privacy policy. */
  contactEmail: 'hello@parttoolhub.com',
  /** Default social preview image, relative to /public. */
  ogImage: '/og-default.png',
  /** ISO date the site launched — used in schema.org markup. */
  launched: '2026-09-13',
  locale: 'en_US',
} as const;

export const ADS = {
  /**
   * Google AdSense publisher ID, e.g. "ca-pub-1234567890123456".
   * Leave empty to disable every ad slot and skip loading the AdSense script.
   * Remember to also update /public/ads.txt when you fill this in.
   */
  client: 'ca-pub-1131275888668306',
  /** Individual ad-unit slot IDs. Create these in the AdSense dashboard. */
  slots: {
    toolTop: '',
    toolBottom: '',
    sidebar: '',
    article: '',
  },
} as const;

export const ANALYTICS = {
  /** Google Analytics 4 measurement ID, e.g. "G-XXXXXXXXXX". Empty = disabled. */
  ga4: 'G-8M3K4P1SDC',
} as const;

// Header/footer navigation is generated from src/data/categories.ts and
// src/data/tools.ts (the tool registry), not listed here — see those files
// to add a category or a tool.
