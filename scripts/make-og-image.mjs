/**
 * Generates or normalises public/og-default.png, the 1200×630 social preview.
 * Not part of the build. Uses the `sharp` that astro already installs
 * transitively; the site itself never depends on it (see astro.config.mjs).
 *
 *   node scripts/make-og-image.mjs                 → render the built-in brand SVG
 *   node scripts/make-og-image.mjs --from some.png → centre-crop/resize any image
 *                                                    (e.g. one from an AI generator)
 *                                                    to exactly 1200×630
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const from = fromIdx >= 0 ? args[fromIdx + 1] : null;
const out = args.find((a, i) => !a.startsWith('--') && (fromIdx < 0 || i !== fromIdx + 1)) ?? 'public/og-default.png';

const W = 1200;
const H = 630;

// Brand colours from global.css (--accent #2563eb) and the favicon mark.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <!-- logo mark: the favicon's rounded square with three lines, scaled up -->
  <g transform="translate(96 150) scale(5.2)">
    <rect width="32" height="32" rx="7" fill="#ffffff" fill-opacity="0.16"/>
    <path d="M9 11h14M9 16h9M9 21h12" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
  </g>
  <text x="300" y="235" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="96" font-weight="800" fill="#ffffff" letter-spacing="-2">PartToolHub</text>
  <text x="302" y="312" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="38" font-weight="400" fill="#dbe4ff">Free text, JSON and encoding tools</text>
  <text x="302" y="366" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="38" font-weight="400" fill="#dbe4ff">that run entirely in your browser</text>
  <text x="96" y="548" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="30" font-weight="600" fill="#ffffff" fill-opacity="0.85">parttoolhub.com</text>
</svg>`;

const source = from ? sharp(from) : sharp(Buffer.from(svg));
const png = await source
  .resize(W, H, { fit: 'cover', position: 'centre' }) // no-op for the SVG; centre-crops an external image
  // 256-colour palette with dithering: the flat SVG stays ~25 KB and a designed
  // image with gradients lands around 300 KB with no visible banding — versus
  // > 1 MB for full-colour PNG, which social crawlers fetch on every share.
  .png({ compressionLevel: 9, palette: true, quality: 90, dither: 1 })
  .toBuffer();
writeFileSync(out, png);
const meta = await sharp(png).metadata();
console.log(`wrote ${out} ${meta.width}x${meta.height} ${png.length} bytes${from ? ` (from ${from})` : ''}`);
