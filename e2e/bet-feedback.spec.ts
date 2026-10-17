import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice } from './helpers';

/**
 * B2 #13 (R2): a wrong bet or sit decision gets a short line in the message
 * strip and a brief spoken line, without blocking play -- the D1 sit-out line
 * used to be taught only in the end-of-session report.
 */

test.use({ viewport: { width: 375, height: 812 } });

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

test('dealing in at a count the ramp sits out: a strip and a spoken line, and the round plays on', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, audio: { enabled: true } });
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Fresh shoe, TC 0: the ramp sits out (D1).
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const strip = page.locator('.bet-miss');
  // C-R6: the ramp sits out, so the stake is not graded -- the line names the play.
  await expect(strip).toHaveText('Sit out at TC +0 — you played');
  // Not a modal: nothing to dismiss, the hand is still to be played.
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect.poll(async () => (await speech(page)).some((l) => l.includes('Your ramp sits out at true count zero.'))).toBe(true);
  await playRoundByAdvice(page);
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  // It stays with that round, and goes when the next decision is right.
  await expect(strip).toBeVisible();
  await page.getByRole('button', { name: 'Sit out', exact: true }).click();
  await expect(page.locator('.message-sat-out')).toBeVisible();
  await expect(strip).toHaveCount(0);
});

test('test mode keeps the table quiet about bets', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
  await expect(page.locator('.bet-miss')).toHaveCount(0);
});
