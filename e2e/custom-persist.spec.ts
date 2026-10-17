import { test, expect, type Page } from '@playwright/test';
import { withSettings, withStats } from './helpers';

/**
 * s07 (high): Custom editor edits persist the moment they are made, in the
 * REAL app -- not only when a Start button is tapped. The editor's own spec
 * runs in a harness that saves on every change, which is why it could not
 * catch this; these go through App, whose settings setter is memory only.
 */

async function openCustom(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Custom drill');
}

async function relaunch(page: Page): Promise<void> {
  // A real relaunch: the seeded settings must not be written back over the edits.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await openCustom(page);
}

test.beforeEach(async ({ page }) => {
  await withSettings(page, {});
});

test('Auto, a painted cell and Favour missed survive a relaunch without Start', async ({ page }) => {
  await withStats(page, { cellStats: { 'hard-16-v-10': { right: 1, wrong: 4, lastAt: '' } } });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await openCustom(page);

  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(page.locator('[data-cell="hard-16-v-10"]')).toHaveAttribute('data-tier', 'focus');
  await page.getByRole('radio', { name: 'Off' }).click();
  await page.locator('[data-cell="soft-20-v-2"]').scrollIntoViewIfNeeded();
  await page.locator('[data-cell="soft-20-v-2"]').click();
  await expect(page.locator('[data-cell="soft-20-v-2"]')).toHaveAttribute('data-tier', 'off');
  await page.getByRole('button', { name: /Favour missed cells/ }).click();
  const counts = await page.getByTestId('cde-counts').textContent();

  await relaunch(page);
  await expect(page.locator('[data-cell="hard-16-v-10"]')).toHaveAttribute('data-tier', 'focus');
  await expect(page.locator('[data-cell="soft-20-v-2"]')).toHaveAttribute('data-tier', 'off');
  await expect(page.getByRole('button', { name: /Favour missed cells/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('cde-counts')).toHaveText(counts ?? '');
});
