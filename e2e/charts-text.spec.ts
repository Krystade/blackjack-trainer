import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * F9 (W2-20): bigger Charts text -- cells at 13px or more, the corner label
 * at 11px or more -- on a 13 mini (375x812, 47/34 notch insets) with nothing
 * scrolling sideways: not the page, not a grid, and no label or code spilling
 * out of its own track.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS = process.env.SHOT_DIR ?? 'e2e/screenshots';

async function notch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important;--safe-bottom:34px !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
}

async function openCharts(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-heading')).toHaveText('Strategy charts');
}

/** Smallest computed font size, in px, over every match. */
async function minFontPx(page: Page, sel: string): Promise<{ n: number; min: number }> {
  return page.locator(sel).evaluateAll((els) => ({
    n: els.length,
    min: Math.min(...els.map((el) => parseFloat(getComputedStyle(el).fontSize))),
  }));
}

/**
 * Every match whose text is wider than its content box.
 *
 * Measured from the text itself (a Range over the element's contents), not
 * from scrollWidth: the row labels are right-aligned, and text that overflows
 * to the LEFT adds nothing to scrollWidth, so a label spilling out of its
 * column passed that check.
 */
async function spilling(page: Page, sel: string): Promise<string[]> {
  return page.locator(sel).evaluateAll((els) =>
    els.flatMap((el) => {
      const cs = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect().width;
      return text > room + 0.5 ? [`${(el as HTMLElement).innerText.trim()} ${text.toFixed(1)}>${room.toFixed(1)}`] : [];
    }),
  );
}

const RULESETS = [
  { name: '6D H17 DAS LS', rules: {} },
  // Different collapses: no surrender folds 17 into the stand tail, S17 and
  // 1D move the soft rows.
  { name: '1D S17 no DAS no LS', rules: { decks: 1, s17: true, das: false, ls: false } },
] as const;

for (const rs of RULESETS) {
  test(`F9: ${rs.name}: cells >= 13px, corner >= 11px, no sideways scroll at 375x812 notch`, async ({ page }) => {
    await notch(page);
    await withProfile(page, { rules: rs.rules });
    await openCharts(page);

    const cells = await minFontPx(page, '.chart-table .chart-cell');
    expect(cells.n, 'vacuity: the grids rendered').toBeGreaterThan(200);
    expect(cells.min).toBeGreaterThanOrEqual(13);
    // The indexed cells' buttons inherit the cell's size rather than a UA 13.33px.
    const buttons = await minFontPx(page, '.chart-cell-btn');
    expect(buttons.n).toBeGreaterThan(5);
    expect(buttons.min).toBeGreaterThanOrEqual(13);
    const corner = await minFontPx(page, '.chart-corner');
    expect(corner.n).toBe(3);
    expect(corner.min).toBeGreaterThanOrEqual(11);

    // Nothing scrolls sideways: the document, the screen, each grid...
    const widths = await page.evaluate(() => ({
      doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      screen: [document.querySelector('.charts-screen')!.scrollWidth, document.querySelector('.charts-screen')!.clientWidth],
      grids: [...document.querySelectorAll('.chart-grid')].map((g) => [g.scrollWidth, g.clientWidth]),
    }));
    expect(widths.doc[0]).toBeLessThanOrEqual(widths.doc[1]!);
    expect(widths.screen[0]).toBeLessThanOrEqual(widths.screen[1]!);
    expect(widths.grids).toHaveLength(3);
    for (const [sw, cw] of widths.grids) expect(sw).toBeLessThanOrEqual(cw!);
    // ...and no text overflows its own track (a clipped "DEALER" or "A,8-9"
    // would pass every check above).
    expect(await spilling(page, '.chart-table th, .chart-table .chart-cell, .chart-cell-btn')).toEqual([]);
    // The test machine's mono (Consolas/Cascadia, ~0.55em) is narrower than
    // the phone's SF Mono (~0.6em): measure again in a forced 0.6em face so a
    // fit that only holds on Windows fails here.
    await page.addStyleTag({ content: '.chart-table { font-family: "Courier New", monospace !important }' });
    expect(await spilling(page, '.chart-table th, .chart-table .chart-cell, .chart-cell-btn')).toEqual([]);
    // Ten dealer columns, all on screen.
    const last = (await page.locator('[data-section="HARD"] thead .chart-up').last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(375);
  });
}

test('F9 screenshot: the hard chart at 375x812 with notch insets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await notch(page);
  await withProfile(page);
  await openCharts(page);
  await page.locator('[data-section="HARD"] .chart-frame').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/f9-charts-hard.png` });
  await page.locator('[data-section="SOFT"] .chart-frame').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/f9-charts-soft.png` });
  await expect(page.locator('.chart-corner').first()).toBeVisible();
});
