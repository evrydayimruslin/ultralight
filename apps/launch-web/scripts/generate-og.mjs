// Rasterize public/og.svg → public/og.png at 1200×630 for social share cards.
// Social platforms don't render SVG og:image, so this bakes a PNG on every build.
// Fonts are bundled (static Newsreader cuts in scripts/fonts/) so the card
// renders identically on any machine — CI Linux boxes have no Newsreader, and
// resvg ignores variable-font axes, so we ship pre-instanced static weights:
// a Display Bold (700/72pt) for the headline and a Text Regular (400) for body.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const svgPath = join(root, 'public', 'og.svg');
const pngPath = join(root, 'public', 'og.png');
const fontFiles = [
  join(here, 'fonts', 'Newsreader-Display.ttf'), // headline (family "Newsreader Display")
  join(here, 'fonts', 'Newsreader-Text.ttf'), // body + url (family "Newsreader")
];

const svg = readFileSync(svgPath, 'utf8');

const resvg = new Resvg(svg, {
  // Render at the SVG's intrinsic 1200×630 (no upscaling needed for og).
  fitTo: { mode: 'width', value: 1200 },
  font: {
    fontFiles,
    loadSystemFonts: false, // deterministic across machines
    defaultFontFamily: 'Newsreader',
    serifFamily: 'Newsreader',
  },
});

const png = resvg.render().asPng();
writeFileSync(pngPath, png);
console.log(`generate-og: wrote ${pngPath} (${png.length} bytes)`);
