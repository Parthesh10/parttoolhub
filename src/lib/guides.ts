import { getCollection, type CollectionEntry } from 'astro:content';

export type Guide = CollectionEntry<'guides'>;

/**
 * Guides that exist on this build, newest first. Drafts are included only under
 * `astro dev`, so a draft can be read in the browser but never reaches production.
 */
export async function visibleGuides(): Promise<Guide[]> {
  const all = await getCollection('guides', (g) => import.meta.env.DEV || !g.data.draft);
  return all.sort((a, b) => b.data.publishedOn.localeCompare(a.data.publishedOn) || a.id.localeCompare(b.id));
}

/** The date a reader should see as "last changed". */
export const guideModified = (g: Guide) => g.data.updatedOn ?? g.data.publishedOn;
