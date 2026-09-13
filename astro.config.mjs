// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE } from './src/site.config.ts';

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
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
});
