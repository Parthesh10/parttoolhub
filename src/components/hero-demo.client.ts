import { cleanText, DEFAULT_CLEAN } from '../lib/text-clean';
import { detectFormat } from '../lib/detect-format';
import { toolBySlug, toolPath } from '../data/tools';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('demo-input');
const output = $<HTMLTextAreaElement>('demo-output');
const summary = $('demo-summary');
const detectBanner = $('demo-detect');
const detectLink = $<HTMLAnchorElement>('demo-detect-link');

// Same labels/wording as ai-text-cleaner.client.ts's CHANGE_LABELS — duplicated on
// purpose (seo-rules §4: no shared JS across widgets), kept short for the hero card.
const CHANGE_LABELS: Record<string, string> = {
  markdown: 'markdown stripped',
  citations: 'citations removed',
  straightenQuotes: 'quotes straightened',
  emDash: 'dashes replaced',
  ellipsis: 'ellipses replaced',
  invisible: 'hidden characters removed',
  emoji: 'emoji removed',
  whitespace: 'whitespace tidied',
};

function renderDetection(raw: string) {
  const detection = raw.trim() ? detectFormat(raw) : null;
  if (!detection) {
    detectBanner.hidden = true;
    return;
  }
  const tool = toolBySlug(detection.slug);
  detectBanner.hidden = false;
  detectLink.href = toolPath(tool);
  detectLink.textContent = `${detection.label}: try ${tool.name} instead →`;
}

function render() {
  const raw = input.value;
  if (!raw.trim()) {
    output.value = '';
    summary.textContent = '';
    detectBanner.hidden = true;
    return;
  }
  const result = cleanText(raw, DEFAULT_CLEAN);
  output.value = result.output;
  const applied = Object.keys(result.changes);
  summary.textContent = applied.length ? `Fixed: ${applied.map((k) => CHANGE_LABELS[k] ?? k).join(', ')}` : 'Already clean, nothing to fix';
  renderDetection(raw);
}

// No debounce: cleanText() is a handful of regex passes over a short paste, far
// under the 50 ms budget, and instant feedback is the whole point of a demo.
input.addEventListener('input', render);

render();
