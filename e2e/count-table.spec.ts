import { test, expect, type Page } from '@playwright/test';
import { withSettings, readStats, submitZero } from './helpers';

/**
 * #47: the count drill's Table mode deals whole rounds laid out like Play,
 * counts its length in rounds, and records the cards it actually showed.
 */

type CountRow = { cards: number; intervalMs: number; manual?: boolean };

async function openCountDrill(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
}

test('a manual table run shows rounds like Play and records every card shown', async ({ page }) => {
  await withSettings(page, {
    drill: { countManual: true, countTableMode: true, countTableRounds: 5, countLengthCards: 52 },
  });
  await openCountDrill(page);
  await expect(page.getByRole('button', { name: '5', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  let shown = 0;
  for (let round = 1; round <= 5; round++) {
    const table = page.getByTestId('count-table');
    await expect(page.locator('.manual-tap-hint')).toContainText(`Tap for the next round · ${round}/5`);
    const dealer = await table.locator('.count-table-dealer .card').count();
    const seats = await table.locator('.bot-seat').count();
    expect(dealer).toBeGreaterThanOrEqual(2);
    expect(dealer).toBeLessThanOrEqual(6);
    expect(seats).toBeGreaterThanOrEqual(1);
    expect(seats).toBeLessThanOrEqual(6);
    for (const n of await table.locator('.bot-hand-cards').evaluateAll((els) => els.map((e) => e.children.length))) {
      expect([2, 3]).toContain(n);
    }
    shown += await table.locator('.card').count();
    await page.locator('.manual-tap-zone').click();
  }
  await submitZero(page);
  await expect(page.locator('.result-detail')).toBeVisible();

  const stats = (await readStats(page)) as { countDrill: { history: CountRow[] } };
  const row = stats.countDrill.history[stats.countDrill.history.length - 1]!;
  expect(row.cards).toBe(shown);
  expect(row.manual).toBe(true);
});

test('an auto table round stays up for its cards, not one card', async ({ page }) => {
  await withSettings(page, {
    drill: { countManual: false, countTableMode: true, countTableRounds: 5, countIntervalMs: 300 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-flash-progress')).toContainText('Round 1 / 5');
  // A round holds at least four cards, so 1200ms; one card's time is 300ms.
  await page.waitForTimeout(800);
  await expect(page.locator('.count-flash-progress')).toContainText('Round 1 / 5');
});

test('eyes-free hides Table mode and deals ordinary cards', async ({ page }) => {
  await withSettings(page, { drill: { countTableMode: true } });
  await openCountDrill(page);
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toBeVisible();
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveCount(0);
  await expect(page.getByText('Length (rounds)', { exact: true })).toHaveCount(0);
});
