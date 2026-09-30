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
 * so the artwork is inset into that safe circle and the felt is extended to
 * the edges behind it. Rendering the plain icon as maskable would put the
 * outer chips' rims under the crop.
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

/** The safe-zone inset: 80% of the width, centred. */
const MASKABLE_SCALE = 0.8;

const svg = await readFile(join(pub, 'icon.svg'), 'utf8');
const browser = await chromium.launch();

try {
  for (const { file, size, maskable } of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });

    // The felt gradient is painted as a full-bleed background so a maskable
    // crop never exposes a transparent corner.
    const inner = maskable
      ? `<div style="width:${MASKABLE_SCALE * 100}%;height:${MASKABLE_SCALE * 100}%">${svg}</div>`
      : svg;

    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
         body{display:flex;align-items:center;justify-content:center;
              background:linear-gradient(180deg,#1d6340,#114027 55%,#071e12)}
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
