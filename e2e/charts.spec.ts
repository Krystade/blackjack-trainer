import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { shot, withProfile } from './helpers';

/**
 * Operator item #6: viewable strategy charts.
 *
 * The screen renders getChart(activeProfile.rules) -- the SAME assembled chart
 * src/engine/strategy.ts grades against -- so most correctness lives in
 * src/ui/screens/chartRows.test.ts (pure, 37 cases). What only a browser can
 * prove is asserted here: the row-order toggle and its persistence, the sticky
 * row-label column under horizontal scroll, that the page body itself never
 * scrolls sideways on a 390px phone, and the highlight API opening scrolled to
 * one ringed cell with its neighbours still on screen.
 */

async function openCharts(page: Page, url = '/?e2e=1'): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-heading')).toHaveText('Strategy Charts');
}

/** The visible row labels of one section, top to bottom. */
function rowLabels(page: Page, section: string) {
  return page.locator(`[data-section="${section}"] .chart-rowlabel`);
}

test('Home offers a Charts destination that opens the viewer', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  await expect(page.locator('[data-section="HARD"]')).toBeVisible();
  await expect(page.locator('[data-section="SOFT"]')).toBeVisible();
  await expect(page.locator('[data-section="PAIRS"]')).toBeVisible();

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});

test('the header names the ACTIVE profile ruleset, so which chart is on screen is unambiguous', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2, s17: true, das: false, ls: false } });
  await openCharts(page);

  await expect(page.locator('.charts-ruleset')).toHaveText('2 deck · S17 · No DAS · No surrender');
});

test('a different ruleset renders a different chart, not a relabelled one', async ({ page }) => {
  // 6D H17 with surrender: hard 17 vs A is Rs, so the all-stand tail is 18+.
  await withProfile(page);
  await openCharts(page);
  await expect(rowLabels(page, 'HARD').first()).toHaveText('18+');

  // Drop surrender and the 17 row becomes all-stand, folding into a 17+ tail.
  await withProfile(page, { rules: { ls: false } });
  await openCharts(page);
  await expect(rowLabels(page, 'HARD').first()).toHaveText('17+');
});

test('row order defaults to descending and the toggle flips every section', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  await expect(rowLabels(page, 'HARD').first()).toHaveText('18+');
  await expect(rowLabels(page, 'SOFT').first()).toHaveText('A,9-10');
  await expect(rowLabels(page, 'PAIRS').first()).toHaveText('A,A');

  await page.getByRole('button', { name: 'Ascending', exact: true }).click();

  await expect(rowLabels(page, 'HARD').first()).toHaveText('4-8');
  await expect(rowLabels(page, 'SOFT').first()).toHaveText('A,2');
  await expect(rowLabels(page, 'PAIRS').first()).toHaveText('2,2');
});

test('the chosen row order survives a reload in its own storage key', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);
  await page.getByRole('button', { name: 'Ascending', exact: true }).click();
  await expect(rowLabels(page, 'HARD').first()).toHaveText('4-8');

  expect(await page.evaluate(() => window.localStorage.getItem('bjtrainer.chartOrder.v1'))).toBe('ascending');

  await openCharts(page);
  await expect(rowLabels(page, 'HARD').first()).toHaveText('4-8');
});

test('cells are colour-coded by action and always keep their letter', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  const hard16 = page.locator('[data-section="HARD"] [data-row="HARD:16"]');
  await expect(hard16.locator('[data-up="2"]')).toHaveText('S');
  await expect(hard16.locator('[data-up="10"]')).toHaveText('Rh');

  // Different actions must not share a background -- colour carries the shape.
  const bg = (sel: string) =>
    page.locator(sel).evaluate((el) => window.getComputedStyle(el).backgroundColor);
  const stand = await bg('[data-section="HARD"] [data-row="HARD:16"] [data-up="2"]');
  const hit = await bg('[data-section="HARD"] [data-row="HARD:16"] [data-up="7"]');
  const surrender = await bg('[data-section="HARD"] [data-row="HARD:16"] [data-up="10"]');
  expect(new Set([stand, hit, surrender]).size).toBe(3);

  // The legend spells out every code, fallbacks included.
  await expect(page.locator('.chart-legend-item')).toHaveCount(8);
  await expect(page.locator('.chart-legend-item', { hasText: 'Dh' })).toContainText('Double if allowed, else hit');
  await expect(page.locator('.chart-legend-item', { hasText: 'Rp' })).toContainText(
    'Surrender if allowed, else split',
  );
});

test('the page body never scrolls sideways, but the grid does, with a sticky row label', async ({ page }) => {
  await withProfile(page);
  await openCharts(page);

  const bodyOverflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(bodyOverflows).toBe(false);

  const scroller = page.locator('[data-section="HARD"] .chart-scroller');
  const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflows).toBe(true);

  const label = page.locator('[data-section="HARD"] .chart-rowlabel').first();
  const before = (await label.boundingBox())!.x;
  await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const after = (await label.boundingBox())!.x;
  expect(Math.abs(after - before)).toBeLessThan(2);

  // The ace column is only reachable by scrolling; it must be reachable.
  await expect(page.locator('[data-section="HARD"] [data-row="HARD:16"] [data-up="A"]')).toBeInViewport();
});

test('the highlight API opens on one ringed cell with its neighbours still visible', async ({ page }) => {
  await withProfile(page);
  await openCharts(page, '/?e2e=1&cell=HARD:16:9');

  const marked = page.locator('[data-highlight="true"]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveAttribute('data-up', '9');
  await expect(marked).toBeInViewport();

  // Anchoring is the whole point: the cells around it must still be readable.
  await expect(page.locator('[data-row="HARD:16"] [data-up="8"]')).toBeInViewport();
  await expect(page.locator('[data-row="HARD:16"] [data-up="10"]')).toBeInViewport();
  await expect(page.locator('[data-row="HARD:15"] [data-up="9"]')).toBeInViewport();
  await expect(page.locator('[data-row="HARD:17"] [data-up="9"]')).toBeInViewport();

  await shot(page, 'charts-highlight');
});

test('a highlight aimed at a total that was folded into a collapsed row still lands', async ({ page }) => {
  await withProfile(page);
  await openCharts(page, '/?e2e=1&cell=HARD:20:6');

  const marked = page.locator('[data-highlight="true"]');
  await expect(marked).toHaveCount(1);
  // Hard 20 lives inside the '18+' row.
  await expect(page.locator('[data-row="HARD:18"] [data-highlight="true"]')).toHaveCount(1);
});

test('a PAIRS highlight lands on the pair row', async ({ page }) => {
  await withProfile(page);
  await openCharts(page, '/?e2e=1&cell=PAIRS:8:A');

  const marked = page.locator('[data-highlight="true"]');
  await expect(marked).toHaveCount(1);
  await expect(page.locator('[data-row="PAIRS:8"] [data-highlight="true"]')).toHaveText('Rp');
});

// ---------------------------------------------------------------------------
// Deliverable: the two screenshots the operator asked for so they can pick a
// default row order. Both frame the HARD section under the same 390x844 phone
// viewport every other spec uses, so they are directly comparable.
// ---------------------------------------------------------------------------

async function captureOrder(page: Page, order: 'Descending' | 'Ascending', file: string): Promise<void> {
  await withProfile(page);
  await openCharts(page);
  await page.getByRole('button', { name: order, exact: true }).click();
  await expect(page.locator('[data-section="HARD"]')).toBeVisible();
  await expect(rowLabels(page, 'HARD').first()).toHaveText(order === 'Descending' ? '18+' : '4-8');

  // The phone viewport is 390x844 and the HARD section runs past the fold, so
  // a plain viewport shot would cut the bottom rows off -- exactly the rows
  // that differ between the two orders. Clip a full-page capture from the top
  // of the screen to the bottom of the HARD grid instead: same 390px layout,
  // just tall enough to show the whole thing being compared.
  const box = (await page.locator('[data-section="HARD"]').boundingBox())!;
  await page.screenshot({
    path: file,
    fullPage: true,
    clip: { x: 0, y: 0, width: 390, height: Math.ceil(box.y + box.height + 12) },
  });
}

test('screenshot: descending row order', async ({ page }) => {
  await captureOrder(page, 'Descending', 'docs/sources/chart-view-descending.png');
});

test('screenshot: ascending row order', async ({ page }) => {
  await captureOrder(page, 'Ascending', 'docs/sources/chart-view-ascending.png');
});
