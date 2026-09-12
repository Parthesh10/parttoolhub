/**
 * Single source of truth for brand, domain and monetisation settings.
 * Change these once you own a domain and have an AdSense account.
 */
export const SITE = {
  name: 'DevTools Hub',
  tagline: 'Fast, private text & list utilities that run in your browser',
  url: 'https://example.com',
  /** Shown in the footer and on the About page. */
  author: 'DevTools Hub',
  /** Contact address surfaced on /contact and in the privacy policy. */
  contactEmail: 'hello@example.com',
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
  client: '',
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
  ga4: '',
} as const;

// Header/footer navigation is generated from src/data/categories.ts and
// src/data/tools.ts (the tool registry), not listed here — see those files
// to add a category or a tool.
