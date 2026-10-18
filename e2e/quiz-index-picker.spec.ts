import { test, expect } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * H6 (wave H, story 5, R6): the Deviation quiz's index picker and its summary
 * chip name the PUBLISHED play. Under H17 the 12/13 v 2-6 indices are stored
 * as "hit at TC ≤ n" and published as "stand at TC ≥ n+1"; the picker said
 * "12 v 6 (hit)" beside a Charts row and an Index test that say stand.
 */
test('H17: the picker and the summary chip say stand for 12 v 6, never hit', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { drill: { quizIndex: '12v6', quizDistractorPct: 0 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();

  const options = await page.locator('.quiz-index-select option').allTextContents();
  expect(options).toContain('12 v 6 (stand)');
  for (const hand of ['12 v 2', '12 v 3', '12 v 4', '12 v 5', '12 v 6', '13 v 2', '13 v 3']) {
    expect(options.some((o) => o.startsWith(`${hand} (hit)`)), `${hand} picker text`).toBe(false);
  }
  await expect(page.locator('.quiz-index-select')).toHaveValue('12v6');

  // The summary chip folds in once an answer is in, naming the same play.
  const correct = (await page.locator('.drill-screen').getAttribute('data-correct'))!;
  await page.locator('.action-bar button.action-btn', { hasText: correct.charAt(0).toUpperCase() + correct.slice(1) }).click();
  await expect(page.getByTestId('controls-summary')).toContainText('12 v 6 (stand)');
  await expect(page.getByTestId('controls-summary')).not.toContainText('(hit)');
});
