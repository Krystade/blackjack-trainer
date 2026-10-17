import { test, expect, type Page } from '@playwright/test';
import { statsTab, withProfile, withStats } from './helpers';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const tile = (page: Page) =>
  page.locator('.readiness-stat', { has: page.locator('.readiness-label', { hasText: /^indices/ }) });

async function homeIndexFigure(page: Page): Promise<{ practised: number; total: number; label: string }> {
  const [practised, total] = (await tile(page).locator('.readiness-value').innerText()).split('/').map(Number);
  return { practised: practised!, total: total!, label: (await tile(page).locator('.readiness-label').textContent())!.trim() };
}

/** Wave B2 #10: Home's tile and the ladder's deviations rung are one figure under one word. */
test('B2 #10: four misses on 16 v 10 read as practised on the tile, as on the ladder', async ({ page }) => {
  await withStats(page, { perIndex: { '16v10': { right: 0, wrong: 4 } } });
  await page.goto('/?e2e=1');
  const f = await homeIndexFigure(page);
  expect(f).toEqual({ practised: 1, total: 17, label: 'indices practised' });
});

/** Wave B2 #22: Home and Stats count the same indices, on every profile shape. */
const PROFILES: [string, Record<string, unknown>][] = [
  ['H17', {}],
  ['H17 + BJA extras', { bjaExtras: true }],
  ['H17 + Fab 4 + extras', { surrenderIndices: true, bjaExtras: true }],
  ['2-deck H17', { rules: { decks: 2 } }],
];
for (const [name, profile] of PROFILES) {
  test(`B2 #22: ${name}: Home's index total is the Stats index table's row count`, async ({ page }) => {
    const done = { right: 3, wrong: 0 };
    await withStats(page, { perIndex: { '16v10': done, '12v6': done, sur15v10: done, '11vA': done, A8v4: done, '9v2': done } });
    await withProfile(page, profile);
    await page.goto('/?e2e=1');
    const home = await homeIndexFigure(page);
    await page.locator('.tab-bar').getByRole('button', { name: 'Stats', exact: true }).click();
    await statsTab(page, 'Play');
    const rows = page.locator('.index-table tbody tr');
    await expect(rows).toHaveCount(home.total);
    const practisedRows = await rows.evaluateAll((trs) =>
      trs.filter((tr) => {
        const [, r, w] = [...tr.querySelectorAll('td')].map((td) => Number(td.textContent) || 0);
        return r + w >= 3;
      }).length);
    expect(practisedRows).toBe(home.practised);
    // The inactive H17 '11 v A' row is gone, even with tallies.
    await expect(page.locator('.index-table')).not.toContainText('11 v A');
  });
}
