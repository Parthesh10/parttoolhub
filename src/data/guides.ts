/**
 * Guides: long-form articles in src/content/guides/*.md (one file per guide, the file name
 * is the URL slug). This module holds the parts every reader of that collection shares and
 * that need no file system: the topic list and the URL shape. Pages read the guides
 * themselves through src/lib/guides.ts (Astro's content layer); astro.config.mjs and the
 * tests read them through src/data/guide-files.ts (plain fs), since neither runs inside
 * Astro's content layer.
 *
 * Topics group guides on the /guides hub, in this order, and only topics that have a
 * published guide are shown. There are no per-topic pages (seo-rules §5: no tag pages).
 * Add a topic here before writing the first guide that needs it.
 */
export const GUIDE_TOPICS = [
  {
    slug: 'data-formats',
    name: 'Data formats and conversions',
    blurb: 'JSON, CSV, lists and encodings: moving data from one shape to another without losing any of it.',
  },
  {
    slug: 'debugging',
    name: 'Errors and debugging',
    blurb: 'What an error message is actually reporting, and the fix that addresses the cause instead of the symptom.',
  },
  {
    slug: 'system-design',
    name: 'Backend and system design',
    blurb: 'Scaling, load balancing, concurrency and queues, and the trade-off behind each choice.',
  },
  {
    slug: 'cloud',
    name: 'Cloud and AWS',
    blurb: 'How managed services such as Lambda and load balancers behave once real traffic reaches them.',
  },
  {
    slug: 'text-and-docs',
    name: 'Text, Markdown and docs',
    blurb: 'Getting writing between editors, chat apps and AI assistants with the formatting intact.',
  },
] as const;

export type GuideTopicSlug = (typeof GUIDE_TOPICS)[number]['slug'];

export function guideTopic(slug: string) {
  const topic = GUIDE_TOPICS.find((t) => t.slug === slug);
  if (!topic) throw new Error(`Unknown guide topic "${slug}" (add it to GUIDE_TOPICS in src/data/guides.ts)`);
  return topic;
}

export const GUIDES_HUB = '/guides';
export const guidePath = (slug: string) => `${GUIDES_HUB}/${slug}`;

/** Reading time from a Markdown body at ~220 words a minute; code blocks count as one word. */
export function readingMinutes(markdown: string): number {
  const words = markdown.replace(/```[\s\S]*?```/g, ' code ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
