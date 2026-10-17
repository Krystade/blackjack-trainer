import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, withSettings, withStats } from './helpers';
import { EMPTY_STATS } from '../src/store/types';

/**
 * B6: a hand-drill miss strip carries a band underneath -- what the mistake
 * cost, which miss this is on the chart cell, and (from five results) how many
 * of the cell's last five went wrong.
 */

test.use({ viewport: { width: 375, height: 812 } });

/** The spec's own formatting of a hard cell id: `hard-16-v-10` → `16 v 10`. */
function hardLabel(cellId: string): string {
  const m = /^hard-(\d+)-v-(\w+)$/.exec(cellId);
  if (!m) throw new Error(`not a hard cell: ${cellId}`);
  return `${m[1]} v ${m[2]}`;
}

async function openFlashcards(page: Page, stats: Record<string, unknown> = {}) {
  await withSettings(page, { drill: { scopes: ['hard'] } });
  await withStats(page, { ...(EMPTY_STATS as unknown as Record<string, unknown>), ...stats });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
}

/** Answer Stand until the strip shows a miss; return the missed cell id. */
async function standUntilMiss(page: Page): Promise<string> {
  const stand = page.locator('.action-bar').getByRole('button', { name: 'Stand', exact: true });
  for (let i = 0; i < 60; i += 1) {
    if ((await answerAndReadStrip(page, stand)) === 'miss') {
      const id = await page.locator('[data-testid="result-strip"] .hand-result').getAttribute('data-cell-id');
      if (!id) throw new Error('miss strip has no cell id');
      return id;
    }
  }
  throw new Error('no miss in 60 answers');
}

test('a flashcard miss shows its cost and that it is the first miss on the cell', async ({ page }) => {
  await openFlashcards(page);
  const cellId = await standUntilMiss(page);
  const line = page.getByTestId('miss-history');
  await expect(line).toHaveCount(1);
  const text = (await line.textContent()) ?? '';
  expect(text).toMatch(/^((−\d+\.\d\d u|under 0\.01 u) · )?1st miss on \d+ v (\d+|A)$/);
  expect(text.endsWith(`1st miss on ${hardLabel(cellId)}`)).toBe(true);
});

test('history counts earlier misses on the cell', async ({ page }) => {
  const cellStats: Record<string, unknown> = {};
  for (let total = 5; total <= 19; total += 1) {
    for (const up of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A']) {
      cellStats[`hard-${total}-v-${up}`] = { right: 1, wrong: 3, lastAt: '', recent: '0101' };
    }
  }
  await openFlashcards(page, { cellStats });
  const cellId = await standUntilMiss(page);
  await expect(page.getByTestId('miss-history')).toHaveText(new RegExp(`4th miss on ${hardLabel(cellId)}, 3 of last 5$`));
});

test('Wrong tap takes the line away with the miss', async ({ page }) => {
  await openFlashcards(page);
  await standUntilMiss(page);
  await expect(page.getByTestId('miss-history')).toHaveCount(1);
  await page.locator('[data-testid="result-strip"]').getByRole('button', { name: 'Wrong tap', exact: true }).click();
  await expect(page.getByTestId('miss-history')).toHaveCount(0);
});

test('the line keeps the answer buttons on screen', async ({ page }) => {
  await openFlashcards(page);
  await standUntilMiss(page);
  await expect(page.getByTestId('miss-history')).toHaveCount(1);
  const box = await page.locator('.action-bar').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  await page.screenshot({ path: '.superpowers/sdd/2026-10-17-wave-b-drills/shots/task6-flashcard-miss.png' });
});
