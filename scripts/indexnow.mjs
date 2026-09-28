// Tells IndexNow search engines (Bing, and through it DuckDuckGo and Yahoo; also Yandex, Seznam, Naver)
// that the site's pages changed, so they recrawl in minutes instead of days. Google does not use IndexNow.
//
// Run after each release, once Vercel shows the new deployment as live:
//   node scripts/indexnow.mjs              submit every URL in the live sitemap
//   node scripts/indexnow.mjs --dry-run    list what would be submitted, send nothing
//   node scripts/indexnow.mjs tools/json-formatter guides   submit only these paths (no leading slash:
//                                          Git Bash rewrites /paths into C:/Program Files/Git/...)
//
// The key is the name of public/<32 hex>.txt, whose content is the same key. It is public by design:
// engines fetch it to confirm the submitter controls the site. Submitting the whole sitemap is fine at
// this size (the API takes up to 10,000 URLs per call); unchanged URLs are simply recrawled.
//
// Exit status goes through process.exitCode, never process.exit(): exiting while fetch sockets are
// still closing trips a libuv assertion on Windows.

import { readdirSync } from 'node:fs';

const SITE = 'https://parttoolhub.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const keyFile = readdirSync(new URL('../public/', import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('No IndexNow key file (public/<32 hex chars>.txt) found.');
const key = keyFile.slice(0, -4);
const keyLocation = `${SITE}/${keyFile}`;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const paths = args.filter((a) => !a.startsWith('--'));

async function text(url) {
  const res = await fetch(url, { redirect: 'manual' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function sitemapUrls() {
  const index = await text(`${SITE}/sitemap-index.xml`);
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const sitemap of locs(index)) urls.push(...locs(await text(sitemap)));
  return urls;
}

async function main() {
  // Engines reject every submission until the key file is live, so check it first: the release that
  // adds a new key has to finish deploying before this can succeed.
  const live = await text(keyLocation).catch((e) => e.message);
  if (live.trim() !== key) {
    console.error(`Key file not live yet: ${live.slice(0, 100)}\nRelease first, wait for the deploy, then rerun.`);
    if (!dryRun) return (process.exitCode = 1);
  }

  let urls = paths.length ? paths.map((p) => `${SITE}/${p.replace(/^\/+/, '')}`) : await sitemapUrls();
  urls = [...new Set(urls)].filter((u) => u === SITE || u.startsWith(`${SITE}/`));
  if (!urls.length) throw new Error('No URLs to submit.');

  console.log(`${urls.length} URL(s)${dryRun ? ' (dry run, nothing sent)' : ''}:`);
  for (const u of urls) console.log(`  ${u}`);
  if (dryRun) return;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation, urlList: urls }),
  });
  // 200 = accepted, 202 = accepted while the key is still being validated. Anything else failed:
  // 400 bad request, 403 key not valid, 422 URLs not on this host, 429 too many requests.
  console.log(`IndexNow answered ${res.status} ${res.statusText}`);
  if (res.status !== 200 && res.status !== 202) {
    console.error(await res.text());
    process.exitCode = 1;
  }
}

await main();
