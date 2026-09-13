// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE } from './src/site.config.ts';
import { TOOLS, toolPath } from './src/data/tools.ts';

// /tools/<slug> → the ISO review date from the registry, so the sitemap's
// <lastmod> only moves when a page's content actually changed (seo-rules §5/§13).
const lastmodByPath = new Map(TOOLS.map((t) => [toolPath(t), new Date(`${t.reviewedOn}T00:00:00Z`)]));

export default defineConfig({
  site: SITE.url,
  trailingSlash: 'never',
  build: { format: 'file' },
  // No page uses Astro's <Image>/<Picture> (every image here is inline SVG),
  // so skip the sharp-based image service entirely rather than carry a heavy
  // native dependency — and its Linux build step — for a feature we never use.
  image: { service: passthroughImageService() },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const lastmod = lastmodByPath.get(path);
        return lastmod ? { ...item, lastmod: lastmod.toISOString() } : item;
      },
    }),
  ],
});
