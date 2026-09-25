import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NEXT_STEPS } from '../src/data/next-steps.ts';
import { TOOLS } from '../src/data/tools.ts';

const SLUGS = new Set(TOOLS.map((t) => t.slug));

/** The tool component a tool page renders, and the client script that component loads. */
function toolFiles(slug: string): { markup: string; script: string } {
  const page = resolve('src/pages/tools', `${slug}.astro`);
  const m = readFileSync(page, 'utf8').match(/^import \w+Tool from '([^']+\.astro)';$/m);
  assert.ok(m, `${slug}: page imports no *Tool component`);
  const componentPath = resolve(dirname(page), m[1]);
  const markup = readFileSync(componentPath, 'utf8');
  const s = markup.match(/<script src="([^"]+)"/);
  const script = s ? readFileSync(resolve(dirname(componentPath), s[1]), 'utf8') : '';
  return { markup, script };
}

test('every next-step plan belongs to a real tool and links only to other real tools', () => {
  for (const [slug, plan] of Object.entries(NEXT_STEPS)) {
    assert.ok(SLUGS.has(slug), `unknown tool ${slug}`);
    assert.ok(plan.steps.length > 0 && plan.steps.length <= 3, `${slug}: 1-3 next steps`);
    const labels = new Set<string>();
    for (const step of plan.steps) {
      assert.ok(SLUGS.has(step.to), `${slug} -> unknown tool ${step.to}`);
      assert.notEqual(step.to, slug, `${slug} links to itself`);
      assert.ok(!labels.has(step.label), `${slug}: duplicate label ${step.label}`);
      labels.add(step.label);
    }
  }
});

test("each plan's source is an element id that exists in that tool's markup", () => {
  for (const [slug, plan] of Object.entries(NEXT_STEPS)) {
    const id = plan.source.match(/^#([\w-]+)$/)?.[1];
    assert.ok(id, `${slug}: source must be a plain #id, got ${plan.source}`);
    assert.match(toolFiles(slug).markup, new RegExp(`id="${id}"`), `${slug}: no element with id="${id}"`);
  }
});

test('every target can take the handed-over text: an editable textarea, or its own receiveTransfer()', () => {
  const targets = new Set(Object.values(NEXT_STEPS).flatMap((p) => p.steps.map((s) => s.to)));
  for (const slug of targets) {
    const { markup, script } = toolFiles(slug);
    const editable = [...markup.matchAll(/<textarea([\s\S]*?)>/g)].some((m) => !/\breadonly\b/.test(m[1]));
    assert.ok(editable || script.includes('receiveTransfer('), `${slug} has nowhere to put the text`);
  }
});
