import { test, expect, type Page } from '@playwright/test';
import { statsTab, withStats } from './helpers';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const row = (date: string, ok: boolean) => ({ date, rc: 6, decksRemaining: 3, tc: 2, taken: ok ? 4 : 2, correct: 4, ok });

async function openBetOrSit(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Stats', exact: true }).click();
  // D-R2: a drill's answers are on the Drills tab, not Play.
  await statsTab(page, 'Drills');
  return page.locator('.stats-section', { hasText: 'Bet sizing drill' }).first();
}

/** Wave B2 #12: the Bet sizing drill's answers show in Stats, in range (D-R2: on the Drills tab). */
test('B2 #12: Bet sizing drill answers appear on the Drills tab, and follow the range', async ({ page }) => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  await withStats(page, { betSizing: { history: [row(old, true), row(now, true), row(now, false), row(now, true)] } });
  const bsl = await openBetOrSit(page);
  await expect(bsl).not.toContainText('No Bet sizing answers yet');
  await expect(page.locator('.stats-section', { hasText: 'Bet or sit' }).first().getByTestId('bsl-drill-bet-sizing')).toHaveCount(0);
  const drill = bsl.getByTestId('bsl-drill-bet-sizing');
  await expect(drill.locator('span').first()).toHaveText('Bet sizing drill');
  await expect(drill.locator('span').last()).toHaveText('3/4 (75%)');
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(drill.locator('span').last()).toHaveText('2/3 (67%)');
});

test('B2 #12: with no answers anywhere the empty state still points at the drill', async ({ page }) => {
  const bsl = await openBetOrSit(page);
  await expect(bsl).toContainText('No Bet sizing answers yet');
  await expect(bsl.getByTestId('bsl-drill-bet-sizing')).toHaveCount(0);
});
