/**
 * Content collections. One so far: `guides`, the long-form articles under /guides.
 * The schema is the contract a guide file must meet before it builds at all; the prose rules
 * (seo-rules §3A and §3B) are checked over the built HTML by tests/content.test.ts.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { TOOLS } from './data/tools';
import { GUIDE_TOPICS } from './data/guides';

/** YAML turns an unquoted 2026-10-05 into a Date; accept that or a string, keep YYYY-MM-DD. */
const isoDate = z.union([z.date(), z.string()]).transform((v, ctx) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    ctx.addIssue({ code: 'custom', message: `"${s}" is not a YYYY-MM-DD date` });
    return z.NEVER;
  }
  return s;
});

const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/guides' }),
  schema: z.object({
    /** The <title>: 60 characters at most, primary search phrase near the front. */
    title: z.string().min(10).max(60),
    /** The visible <h1> and Article headline, when it should be longer than the title. */
    headline: z.string().min(10).max(110).optional(),
    /** Meta description and the lead under the <h1>. */
    description: z.string().min(70).max(155),
    topic: z.enum(GUIDE_TOPICS.map((t) => t.slug) as [string, ...string[]]),
    publishedOn: isoDate,
    /** Set only when the content changes after publishing (never to look fresh). */
    updatedOn: isoDate.optional(),
    /** Tool slugs the guide uses; each gets a card on the guide and a link back from the tool page. */
    tools: z.array(z.enum(TOOLS.map((t) => t.slug) as [string, ...string[]])).default([]),
    /** true = not built for production; visible only under `npm run dev`. */
    draft: z.boolean().default(false),
  }),
});

export const collections = { guides };
