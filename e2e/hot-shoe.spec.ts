import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice, readStats, shot } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });

async function playUntilBankrollMoves(page: Page): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundByAdvice(page);
    const t = await page.locator('.topbar-stat').first().innerText();
    if (!/Bankroll:\s*100(?![\d.])/.test(t)) return;
  }
  throw new Error('bankroll never moved');
}
const storedProfile = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.profiles.v1')!)[0]);
async function endIt(page: Page) { await page.locator('.end-btn').click(); await page.locator('.end-btn').click(); }

test('B8: a Hot shoe session is labelled, flagged, and leaves the bankroll alone', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { hotShoe: true });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('hot-shoe-badge')).toHaveText('Hot shoe');
  await playUntilBankrollMoves(page);
  expect((await storedProfile(page)).bankrollNow).toBeUndefined();
  await endIt(page);
  await expect(page.locator('.report-hot-shoe')).toContainText('Hot shoe');
  await expect(page.locator('.report-summary')).not.toContainText('bankroll');
  const stats = (await readStats(page)) as { sessions: { hotShoe?: boolean }[] };
  expect(stats.sessions.at(-1)!.hotShoe).toBe(true);
  expect((await storedProfile(page)).bankrollNow).toBeUndefined();
  await shot(page, 'b8-hot-shoe-report');
});

test('B8: without Hot shoe nothing is labelled and the bankroll carries over', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page);
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('hot-shoe-badge')).toHaveCount(0);
  await playUntilBankrollMoves(page);
  expect(typeof (await storedProfile(page)).bankrollNow).toBe('number');
  await endIt(page);
  await expect(page.locator('.report-hot-shoe')).toHaveCount(0);
  await expect(page.locator('.report-summary')).toContainText('bankroll');
  const stats = (await readStats(page)) as { sessions: { hotShoe?: boolean }[] };
  expect('hotShoe' in stats.sessions.at(-1)!).toBe(false);
});

test('B8: the Hot shoe toggle sits with the Fab 4 toggle, is off by default, and saves', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const row = page.locator('.settings-toggle-row', { hasText: 'Hot shoe' });
  await expect(row.locator('input')).not.toBeChecked();
  await row.locator('input').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await storedProfile(page)).hotShoe).toBe(true);
});
