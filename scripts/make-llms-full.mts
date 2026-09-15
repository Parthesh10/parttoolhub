/**
 * Post-build step: generates dist/llms-full.txt, the "full content" companion
 * to /llms.txt (src/pages/llms.txt.ts). Where llms.txt is a one-line-per-tool
 * index, this file inlines each tool's actual How-to-use steps, prose
 * sections and FAQ — real text an AI answer engine can quote or cite,
 * instead of just a link it may never follow.
 *
 * Deliberately NOT an Astro endpoint like llms.txt: the content it needs
 * (the rendered "How to use" list, the Fragment content sections, the FAQ)
 * only exists once Astro has already rendered every tool page to HTML, so
 * this reads the already-built dist/tools/*.html files rather than
 * re-deriving that content from the registry. That also guarantees it can
 * never drift from what a visitor actually sees — it's scraped from the
 * real rendered output, not a second copy of it. Wired into `npm run build`
 * (package.json) so it always regenerates, never a manual step to forget.
 *
 * Reuses src/lib/html-to-markdown.ts (built for the Google Docs/HTML to
 * Markdown tools) to turn each extracted HTML fragment into clean Markdown —
 * the same reasoning that engine already applies to a browser paste applies
 * here to a build-time HTML fragment.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/site.config.ts';
import { CATEGORIES } from '../src/data/categories.ts';
import { toolsInCategory, toolPath, type Tool } from '../src/data/tools.ts';
import { canonicalUrl } from '../src/lib/urls.ts';
import { htmlToMarkdown } from '../src/lib/html-to-markdown.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const dist = resolve(root, 'dist');

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

/**
 * htmlToMarkdown preserves the source's literal heading level (an <h2>
 * becomes exactly "##"), which is right for a standalone page but collides
 * with the ## Category / ### Tool structure this file wraps every fragment
 * in. Shifting every heading down by `by` levels (capped at h6) keeps each
 * tool's own Example/Options/Edge-cases headings correctly nested under it.
 */
function shiftHeadings(markdown: string, by: number): string {
  return markdown.replace(/^(#{1,6})(?=\s)/gm, (hashes) => '#'.repeat(Math.min(6, hashes.length + by)));
}

/** The "How to use" numbered list, as Markdown, from its <ol class="steps">...</ol>. */
function extractSteps(articleHtml: string): string {
  const m = articleHtml.match(/<ol class="steps"[^>]*>([\s\S]*?)<\/ol>/);
  if (!m) return '';
  return htmlToMarkdown(`<ol>${m[1]}</ol>`).markdown;
}

/** Everything in the prose article except the "How to use" section and any ad slot. */
function extractContentSections(articleHtml: string): string {
  // Astro appends a data-astro-cid-* attribute to every scoped element, so the opening tag
  // is never the exact literal from the source .astro file — match it loosely, as content.test.ts's
  // own inner() helper does for the same reason (see CLAUDE.md's scoped-markup gotcha).
  const withoutSteps = articleHtml.replace(/<section aria-labelledby="how-to-use"[^>]*>[\s\S]*?<\/section>/, '');
  const withoutAds = withoutSteps.replace(/<div class="ad-slot[\s\S]*?<\/div>\s*(?:<\/div>\s*)*/g, '');
  // These sections' own headings start at <h2> ("Example", "Options explained", …) — shift by
  // 2 so they land at #### under this file's ## Category / ### Tool wrapper, not competing with it.
  return shiftHeadings(htmlToMarkdown(withoutAds).markdown, 2);
}

/** Every FAQ entry as { q, a } (a converted to Markdown, since answers can carry <code>/<a>/<strong>). */
function extractFaq(html: string): { q: string; a: string }[] {
  const section = html.match(/<section class="faq"[^>]*>([\s\S]*?)<\/section>/);
  if (!section) return [];
  const out: { q: string; a: string }[] = [];
  const detailsRe = /<details[^>]*>([\s\S]*?)<\/details>/g;
  let m: RegExpExecArray | null;
  while ((m = detailsRe.exec(section[1]))) {
    const summary = m[1].match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
    const answer = m[1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!summary || !answer) continue;
    out.push({ q: stripTags(summary[1]), a: htmlToMarkdown(answer[1]).markdown });
  }
  return out;
}

function buildToolSection(tool: Tool): string {
  const file = resolve(dist, `.${toolPath(tool)}.html`);
  const html = readFileSync(file, 'utf8');
  const article = html.match(/<article class="prose"[^>]*>([\s\S]*?)<\/article>/);
  if (!article) throw new Error(`${tool.slug}: could not find the prose article in dist HTML`);
  const steps = extractSteps(article[1]);
  const content = extractContentSections(article[1]);
  const faq = extractFaq(html);

  const lines: string[] = [];
  lines.push('**How to use**', '', steps, '', content);
  if (faq.length) {
    lines.push('', '#### FAQ');
    for (const { q, a } of faq) lines.push('', `**${q}**`, '', a);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function main() {
  if (!existsSync(dist)) {
    console.error('make-llms-full: dist/ not found — run `astro build` first.');
    process.exit(1);
  }

  const out: string[] = [
    `# ${SITE.name} — Full Content`,
    '',
    `> ${SITE.tagline}. This file inlines each tool's full page content (how to use it, options, edge cases, FAQ) for deep indexing. For a short linked index instead, see /llms.txt.`,
    '',
  ];

  for (const cat of CATEGORIES) {
    const tools = toolsInCategory(cat.slug);
    if (!tools.length) continue;
    out.push(`## ${cat.name}`, '');
    for (const t of tools) {
      out.push(`### ${t.name}`, `URL: ${canonicalUrl(toolPath(t))}`, t.description, '');
      out.push(buildToolSection(t));
      out.push('', '---', '');
    }
  }

  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  writeFileSync(resolve(dist, 'llms-full.txt'), text, 'utf8');
  console.log(`make-llms-full: wrote dist/llms-full.txt (${(text.length / 1024).toFixed(0)} KB)`);
}

main();
