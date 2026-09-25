/**
 * The guides collection as plain files, for code that runs outside Astro's content layer:
 * astro.config.mjs (sitemap filter and <lastmod>) and the tests. Pages use
 * src/lib/guides.ts (getCollection) instead. Both read the same files, so they agree on
 * what exists: one Markdown file per guide in src/content/guides/, file name = URL slug,
 * and `draft: true` in the front matter keeps a guide out of production builds.
 *
 * Only reads the few scalar fields these callers need; Astro's schema in
 * src/content.config.ts is what validates a guide's front matter in full.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUIDES_DIR = fileURLToPath(new URL('../content/guides/', import.meta.url));

export interface GuideFile {
  slug: string;
  file: string;
  title: string;
  topic: string;
  /** Tool slugs from the `tools:` list (block `- a` or inline `[a, b]` form). */
  tools: string[];
  draft: boolean;
  /** Raw front-matter value; YYYY-MM-DD when the file is valid. */
  publishedOn: string;
  updatedOn?: string;
  frontmatter: string;
  body: string;
}

function field(frontmatter: string, key: string): string | undefined {
  const m = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm'));
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : undefined;
}

function list(frontmatter: string, key: string): string[] {
  const inline = field(frontmatter, key);
  if (inline && inline.startsWith('[')) {
    return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
  }
  const block = frontmatter.match(new RegExp(`^${key}:[ \\t]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, 'm'));
  return block ? [...block[1].matchAll(/-[ \t]*(.+)/g)].map((m) => m[1].trim().replace(/^(['"])(.*)\1$/, '$2')) : [];
}

export function readGuideFiles(): GuideFile[] {
  if (!existsSync(GUIDES_DIR)) return [];
  return readdirSync(GUIDES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const file = join(GUIDES_DIR, name);
      const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const frontmatter = m?.[1] ?? '';
      return {
        slug: name.replace(/\.md$/, ''),
        file,
        title: field(frontmatter, 'title') ?? '',
        topic: field(frontmatter, 'topic') ?? '',
        tools: list(frontmatter, 'tools'),
        draft: field(frontmatter, 'draft') === 'true',
        publishedOn: field(frontmatter, 'publishedOn') ?? '',
        updatedOn: field(frontmatter, 'updatedOn'),
        frontmatter,
        body: m?.[2] ?? raw,
      };
    });
}

export const publishedGuideFiles = () => readGuideFiles().filter((g) => !g.draft);
