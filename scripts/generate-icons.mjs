/**
 * Rasterise `public/icon.svg` into every PNG the manifest and iOS ask for.
 *
 * Run with `npm run icons`. The PNGs are committed, so this is not part of the
 * build: it runs when the icon changes and never on CI.
 *
 * Chromium does the rendering because it is already a dev dependency through
 * Playwright, and because it is the same engine that renders the SVG in the
 * app -- so what ships as a PNG matches what the browser would have drawn.
 *
 * The maskable variant is NOT the same image scaled. Android crops a maskable
 * icon to an arbitrary shape and only the middle 80% is guaranteed to survive,
 * so the CHIPS are inset into that safe circle while the felt still runs to
 * the edges. Rendering the plain icon as maskable would put the outer chips'
 * rims under the crop.
 *
 * It is done by shrinking the chip group inside the SVG, not by insetting the
 * whole SVG over a background painted here. That is how it used to work, and
 * the background was a hand-copied duplicate of the gradient in `icon.svg`:
 * when the felt's stops changed, the copy did not, and the two met in a
 * visible step at the inset boundary -- measured at 13 luminance units across
 * 13px where the gradient itself moves 2. The sheen was never copied at all.
 * There is no second gradient now, so there is nothing for it to drift from.
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

/** The safe-zone inset: the chips occupy 80% of the width, centred. */
const MASKABLE_SCALE = 0.8;

/**
 * The one group in `icon.svg` that holds every chip. Shrinking it leaves the
 * felt and its sheen full-bleed, which is exactly what a maskable icon wants.
 */
const CHIP_GROUP = '<g transform="translate(256 250) scale(0.94) translate(-256 -250)">';

/** The same artwork with the chips pulled into the safe zone. */
function insetChips(svgText) {
  if (!svgText.includes(CHIP_GROUP)) {
    throw new Error(
      'the chip group in icon.svg no longer matches CHIP_GROUP, so the ' +
        'maskable icon would silently ship with the chips at full size and ' +
        'their rims under the crop',
    );
  }
  return svgText
    .replace(
      CHIP_GROUP,
      `<g transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)">${CHIP_GROUP}`,
    )
    .replace('</svg>', '</g></svg>');
}

const svg = await readFile(join(pub, 'icon.svg'), 'utf8');
const browser = await chromium.launch();

try {
  for (const { file, size, maskable } of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });

    const inner = maskable ? insetChips(svg) : svg;

    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
         svg{display:block;width:100%;height:100%}
       </style>${inner}`,
      { waitUntil: 'load' },
    );

    const buf = await page.screenshot({ omitBackground: false });
    await writeFile(join(pub, file), buf);
    await page.close();
    console.log(`${file}  ${size}x${size}${maskable ? '  (maskable, 80% safe zone)' : ''}`);
  }
} finally {
  await browser.close();
}
