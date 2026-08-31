import { test, expect } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * "I don't see flash card stats in the stats window."
 *
 * There were none, and there could not be: flashcards, the deviation quiz and
 * live table play all wrote into the same pooled `stats.categories`, so a
 * figure like "soft 70%" could not be attributed to any of them. Events now
 * carry a `source` and Stats reads the flashcard slice.
 */

async function answerOneFlashcard(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button').first().click();
  await expect(page.locator('.message-strip')).toBeVisible();
}

async function openFlashcardStats(page: import('@playwright/test').Page) {
  // The tab bar is hidden on drill screens (immersive mode), so leaving a
  // drill goes through its own Back button, not the nav.
  const drillBack = page.locator('.drill-back-btn').first();
  if (await drillBack.isVisible().catch(() => false)) await drillBack.click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Full stats', exact: true }).click();
  // The Stats view's own tablist -- NOT the bottom nav, which would leave
  // the screen entirely.
  await page.locator('.stats-tabs [role="tab"]', { hasText: 'Drills' }).click();
  return page.locator('.stats-section', { hasText: 'Flashcards' }).first();
}

test('the Flashcards section exists and starts empty', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  const section = await openFlashcardStats(page);
  await expect(section).toBeVisible();
  await expect(section).toContainText('No flashcards answered yet');
});

test('answering a flashcard shows up in the Flashcards section', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await answerOneFlashcard(page);

  const section = await openFlashcardStats(page);
  await expect(section).toBeVisible();
  await expect(section).not.toContainText('No flashcards answered yet');
  // Right or wrong, exactly one answer must be counted.
  await expect(section).toContainText('/1 correct');
});

/**
 * The attribution half, and the reason a source field was needed at all: a
 * flashcard answer must NOT be indistinguishable from table play.
 */
test('a flashcard answer is attributed to flashcards, not the table', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await answerOneFlashcard(page);

  const bySource = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}').bySource,
  );

  const total = (b: Record<string, { right: number; wrong: number }> | undefined) =>
    Object.values(b ?? {}).reduce((n, t) => n + t.right + t.wrong, 0);

  expect(total(bySource?.flashcard)).toBe(1);
  expect(total(bySource?.table)).toBe(0);
});
