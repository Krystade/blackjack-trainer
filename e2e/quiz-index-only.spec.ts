import { test, expect } from '@playwright/test';
import { answerAndReadStrip, readStats, withSettings, withStats } from './helpers';

/**
 * H1 (wave H, story 3): a Deviation-quiz answer on a real index is index
 * knowledge. Four 16 v 10 misses used to land in `categories.hard`, so Home's
 * readiness read "88% accuracy · 34 decisions graded" on a profile whose
 * basic-strategy record was 30/0. They now go to `perIndex` only.
 */
test('four 16 v 10 quiz misses leave Home accuracy alone and land in perIndex', async ({ page }) => {
  await withStats(page, {
    categories: { hard: { right: 30, wrong: 0 } },
    cellStats: { 'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' } },
  });
  // Pinned to 16v10 with no distractors, so every item is the real index.
  await withSettings(page, { drill: { quizIndex: '16v10', quizDistractorPct: 0 } });
  await page.goto('/?e2e=1');

  const readiness = page.locator('section.readiness');
  await expect(readiness).toContainText('100%');
  await expect(readiness).toContainText('30 decisions graded');

  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  const screen = page.locator('.drill-screen');
  for (let i = 0; i < 4; i++) {
    await expect(screen).toHaveAttribute('data-item-key', '16v10');
    const correct = await screen.getAttribute('data-correct');
    const wrong = correct === 'hit' ? 'Stand' : 'Hit';
    const tone = await answerAndReadStrip(page, page.locator('.action-bar button.action-btn', { hasText: wrong }));
    expect(tone, `answer ${i} is a miss`).toBe('miss');
  }

  const stats = (await readStats(page)) as {
    categories: Record<string, { right: number; wrong: number }>;
    perIndex: Record<string, { right: number; wrong: number }>;
    cellStats: Record<string, { right: number; wrong: number }>;
  };
  expect(stats.categories.hard).toEqual({ right: 30, wrong: 0 });
  expect(stats.perIndex['16v10']).toEqual({ right: 0, wrong: 4 });
  expect(stats.cellStats['hard-16-v-10']).toMatchObject({ right: 30, wrong: 0 });

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(readiness).toContainText('100%');
  await expect(readiness).toContainText('30 decisions graded');
  await expect(readiness).not.toContainText('34 decisions graded');
});
