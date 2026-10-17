import { test, expect, type Page } from '@playwright/test';
import { withSettings, withStats } from './helpers';

/** B7: the first Flashcards launch shows how to read the chart, once. */

test.use({ viewport: { width: 375, height: 812 } });

const SHOTS = '.superpowers/sdd/2026-10-17-wave-b-drills/shots';

async function openFlashcards(page: Page) {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
}

test('first Flashcards launch shows how to read the chart, once', async ({ page }) => {
  await page.goto('/?e2e=1&intro=1');
  await openFlashcards(page);
  const intro = page.getByTestId('chart-intro');
  await expect(intro).toBeVisible();
  await expect(intro.getByRole('heading', { name: 'How to read the chart' })).toBeVisible();
  expect(await intro.locator('.chart-table').count()).toBeGreaterThanOrEqual(1);
  const start = page.getByRole('button', { name: 'Start quiz' }).first();
  const box = await start.boundingBox();
  expect(box).not.toBeNull();
  // On screen without scrolling: not scrolled above the top, not below 812.
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  await expect(intro.getByRole('heading', { name: 'How to read the chart' })).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/task7-intro.png` });
  await start.click();
  await expect(page.getByTestId('chart-intro')).toHaveCount(0);
  await expect(page.locator('.action-bar')).toBeVisible();

  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.action-bar')).toBeVisible();
  await expect(page.getByTestId('chart-intro')).toHaveCount(0);

  await page.reload();
  await openFlashcards(page);
  await expect(page.locator('.action-bar')).toBeVisible();
  await expect(page.getByTestId('chart-intro')).toHaveCount(0);
});

test('Next step rung 1 Start lands on it', async ({ page }) => {
  await page.goto('/?e2e=1&intro=1');
  await page.getByRole('region', { name: 'Next step' }).getByRole('button', { name: /Start/ }).click();
  await expect(page.getByTestId('chart-intro')).toBeVisible();
});

test('not shown with hand history', async ({ page }) => {
  await withStats(page, { cellStats: { 'hard-16-v-10': { right: 1, wrong: 0, lastAt: '' } } });
  await page.goto('/?e2e=1&intro=1');
  await openFlashcards(page);
  await expect(page.locator('.action-bar')).toBeVisible();
  await expect(page.getByTestId('chart-intro')).toHaveCount(0);
});

test('not shown in an eyes-free session', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1&intro=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await page.locator('.drill-back-btn', { hasText: 'Back' }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await expect(page.locator('.drill-screen')).toBeVisible();
  await expect(page.getByTestId('chart-intro')).toHaveCount(0);
});

test('the harness default stays quiet', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await expect(page.locator('.action-bar')).toBeVisible();
  await expect(page.getByTestId('chart-intro')).toHaveCount(0);
});
