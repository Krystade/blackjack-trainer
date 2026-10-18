import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, withStats } from './helpers';
import { discardTicks } from '../src/ui/components/discardTicks';

/**
 * F6 (W2-18, D2): Play's discard tray drops its deck marks once deck
 * estimation is on target by the Home ladder's rule (8 of the last 10
 * estimates right), and draws them again if it slips. No setting.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.WAVE_F_B_SHOTS;
const DECKS = 6;

function deckRows(results: boolean[]) {
  return results.map((correct, i) => ({
    date: new Date(Date.UTC(2026, 9, 1 + i, 12)).toISOString(),
    actualDecks: 3,
    guess: correct ? 3 : 1.5,
    errorDecks: correct ? 0 : 1.5,
    correct,
  }));
}

async function openTable(page: Page, results: boolean[]): Promise<void> {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { rules: { decks: DECKS } });
  await withStats(page, { deckEstimation: { history: deckRows(results) } });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-discard-tray')).toBeVisible();
}

const ON_TARGET = [true, true, false, true, true, true, true, false, true, true]; // 8 of 10
const SLIPPED = [...new Array<boolean>(10).fill(true), false, false, false]; // last 10: 7 of 10

test('on target: the tray is bare', async ({ page }) => {
  await openTable(page, ON_TARGET);
  const tray = page.locator('.table-discard-tray');
  await expect(tray).toHaveAttribute('data-marks', 'off');
  await expect(tray.locator('.discard-tick')).toHaveCount(0);
  // The fill still shows how much is in the tray.
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(tray.locator('.table-discard-fill')).toBeVisible();
  if (SHOTS) {
    await expect(page.locator('.fast-forward-btn')).toHaveCount(0); // the deal has landed
    await page.addStyleTag({ content: INSET });
    await page.screenshot({ path: `${SHOTS}/f6-tray-bare-375x812.png` });
  }
});

test('off target again: the marks are back', async ({ page }) => {
  await openTable(page, SLIPPED);
  const tray = page.locator('.table-discard-tray');
  await expect(tray).not.toHaveAttribute('data-marks', 'off');
  await expect(tray.locator('.discard-tick')).toHaveCount(discardTicks(DECKS).length);
  if (SHOTS) {
    await page.addStyleTag({ content: INSET });
    await page.screenshot({ path: `${SHOTS}/f6-tray-marked-375x812.png` });
  }
});

test('no deck-estimation history: the marks are drawn', async ({ page }) => {
  await openTable(page, []);
  await expect(page.locator('.table-discard-tray .discard-tick')).toHaveCount(discardTicks(DECKS).length);
});
