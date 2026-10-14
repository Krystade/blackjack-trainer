import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions, readStats, statsTab } from './helpers';

/**
 * #20/#30: a manual (tap-to-advance) count run used to record the AUTO
 * interval setting as its pace, so Stats showed "700ms" for a run that was
 * never dealt at 700ms. It now records `manual: true` and the mean gap
 * between taps, and Stats says so.
 */

type CountRow = { cards: number; intervalMs: number; correct: boolean; manual?: boolean; meanTapMs?: number };

async function openCountDrill(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

const ok = (page: Page) => page.getByRole('button', { name: 'OK', exact: true });

async function lastCountRow(page: Page): Promise<CountRow> {
  const stats = (await readStats(page)) as { countDrill: { history: CountRow[] } };
  return stats.countDrill.history[stats.countDrill.history.length - 1]!;
}

test('a manual run records its own tap pace, not the auto interval', async ({ page }) => {
  // 2900ms is the auto interval: the old code wrote exactly this.
  await withSettings(page, {
    drill: { countLengthCards: 10, countGroup: 1, countManual: true, countIntervalMs: 2900 },
  });
  await openCountDrill(page);
  for (let i = 0; i < 12 && !(await ok(page).isVisible()); i++) {
    await page.locator('.manual-tap-zone').click();
  }
  await ok(page).click();
  await expect(page.locator('.result-detail')).toBeVisible();

  const row = await lastCountRow(page);
  expect(row.manual).toBe(true);
  expect(typeof row.meanTapMs).toBe('number');
  // Playwright taps are quick; nowhere near the 2900ms setting.
  expect(row.meanTapMs!).toBeGreaterThan(0);
  expect(row.meanTapMs!).toBeLessThan(2000);
  expect(row.intervalMs).not.toBe(2900);

  // Stats reads it back as a manual run.
  await page.getByRole('button', { name: 'Back to Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Drills');
  await expect(page.locator('.count-history-row').first()).toContainText(
    `10 cards · manual · ${row.meanTapMs}ms avg`,
  );
});

test('an auto run is not marked manual and keeps its interval', async ({ page }) => {
  await withSettings(page, {
    drill: { countLengthCards: 10, countGroup: 1, countManual: false, countIntervalMs: 300 },
  });
  await openCountDrill(page);
  await expect(ok(page)).toBeVisible({ timeout: 10_000 });
  await ok(page).click();
  const row = await lastCountRow(page);
  expect(row.manual).toBeUndefined();
  expect(row.meanTapMs).toBeUndefined();
  expect(row.intervalMs).toBe(300);
});

test('time spent answering a checkpoint is not a tap gap', async ({ page }) => {
  await withSettings(page, {
    drill: { countLengthCards: 10, countGroup: 1, countManual: true, countCheckpoints: 'one' },
  });
  await openCountDrill(page);
  for (let i = 0; i < 12 && !(await page.locator('.checkpoint-area').isVisible()); i++) {
    await page.locator('.manual-tap-zone').click();
  }
  await expect(page.locator('.checkpoint-area')).toBeVisible();
  // A long think at the checkpoint. Counted as a gap, it alone would put
  // the mean over 600ms across ten cards; real taps here are ~50ms.
  await page.waitForTimeout(6000);
  await ok(page).click();
  for (let i = 0; i < 12 && !(await ok(page).isVisible()); i++) {
    await page.locator('.manual-tap-zone').click();
  }
  await ok(page).click();
  await expect(page.locator('.result-detail')).toBeVisible();

  const row = await lastCountRow(page);
  expect(row.manual).toBe(true);
  expect(row.meanTapMs!).toBeLessThan(400);
});
