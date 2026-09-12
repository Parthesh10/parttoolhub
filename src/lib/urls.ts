import { SITE } from '../site.config';

/**
 * Absolute, canonical URL for a route. With `build.format: 'file'` Astro reports
 * pathnames like "/about.html" during the build; the sitemap and hosts serve the
 * clean "/about", so we normalise here to keep canonical, OG and schema URLs in sync.
 */
export function canonicalUrl(pathname: string): string {
  const clean = pathname.replace(/\.html$/, '').replace(/^\/index$/, '/');
  return new URL(clean, SITE.url).href;
}
