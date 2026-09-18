import type { APIRoute } from 'astro';
import { SITE } from '../site.config';
import { CATEGORIES } from '../data/categories';
import { toolsInCategory, toolPath } from '../data/tools';
import { canonicalUrl } from '../lib/urls';

/**
 * /llms.txt — the informal llmstxt.org convention for giving an LLM crawler a
 * clean, linked summary of the site (Semrush's audit flagged it missing,
 * seo-rules §5). Generated at build time from the same registry every other
 * page reads, as an Astro static endpoint rather than a hand-written
 * public/ file, so a new tool appears here automatically and it can never
 * drift the way a checked-in static copy would (seo-rules §11: one source of
 * truth). tests/content.test.ts asserts every registered tool is listed.
 */
export const GET: APIRoute = () => {
  const lines: string[] = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline}. Every tool runs entirely in the browser, and nothing pasted is uploaded to a server. For full page content (how to use each tool, options, edge cases, FAQ) rather than just links, see /llms-full.txt.`,
    '',
  ];

  for (const cat of CATEGORIES) {
    lines.push(`## ${cat.name}`);
    for (const t of toolsInCategory(cat.slug)) {
      lines.push(`- [${t.name}](${canonicalUrl(toolPath(t))}): ${t.short}`);
    }
    lines.push('');
  }

  lines.push('## Optional');
  lines.push(`- [About](${canonicalUrl('/about')}): who builds and maintains ${SITE.name}, and how each tool is tested before it ships.`);
  lines.push(`- [Privacy Policy](${canonicalUrl('/privacy-policy')}): no accounts, no server-side processing of what you paste.`);

  return new Response(lines.join('\n').trimEnd() + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
