import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withSettings, withStats } from './helpers';

/** B7: Flashcards shows progress to the basic-strategy goal. */

test.use({ viewport: { width: 375, height: 812 } });

const SHOTS = '.superpowers/sdd/2026-10-17-wave-b-drills/shots';

async function openFlashcards(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.action-bar')).toBeVisible();
}

const stand = (page: Page) => page.locator('.action-bar').getByRole('button', { name: 'Stand', exact: true });

test('the line shows the goal for the hand types being dealt', async ({ page }) => {
  await withSettings(page, { drill: { scopes: ['hard'] } });
  const recent = '1'.repeat(27) + '000';
  await withStats(page, { cellStats: { 'hard-16-v-10': { right: 27, wrong: 3, lastAt: '', recent } }, handRecent: { hard: recent } });
  await openFlashcards(page);
  await expect(page.getByTestId('flash-progress')).toHaveText('Goal 90%: Hard 90% ✓');
});

test('reaching the goal says so', async ({ page }) => {
  await withSettings(page, { drill: { scopes: ['hard'] } });
  const recent = '1'.repeat(19);
  await withStats(page, { cellStats: { 'hard-16-v-10': { right: 19, wrong: 0, lastAt: '', recent } }, handRecent: { hard: recent } });
  await openFlashcards(page);
  await expect(page.getByTestId('flash-goal-met')).toHaveCount(0);
  await answerAndReadStrip(page, stand(page));
  await expect(page.getByTestId('flash-goal-met')).toContainText('Hard totals on target');
  await expect(page.getByTestId('flash-progress')).toContainText('✓');
  await answerAndReadStrip(page, stand(page));
  await expect(page.getByTestId('flash-goal-met')).toHaveCount(0);
});

test('the line keeps the answer buttons on screen', async ({ page }) => {
  await withSettings(page, { drill: { scopes: ['hard'] } });
  await openFlashcards(page);
  let tone: 'ok' | 'miss' = 'ok';
  for (let i = 0; i < 30 && tone !== 'miss'; i++) tone = await answerAndReadStrip(page, stand(page));
  expect(tone).toBe('miss');
  await expect(page.getByTestId('flash-progress')).toBeVisible();
  const bar = await page.locator('.action-bar').boundingBox();
  expect(bar).not.toBeNull();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(812);
  await page.screenshot({ path: `${SHOTS}/task8-flash-progress.png` });
});
