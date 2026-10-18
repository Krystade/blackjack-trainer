import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, withStats, playRoundByAdvice } from './helpers';

/**
 * F10 (L-2): "Practised N of the last 7 days" on Home -- no streak, hidden
 * until there is any practice. A day is a LOCAL calendar day.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const SHOTS = process.env.WAVE_F_B_SHOTS;

/** Noon, `daysAgo` local days before today, as the ISO string the app stores. */
function localNoon(daysAgo: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, 12).toISOString();
}

const line = (page: Page) => page.getByTestId('practice-days');

test('hidden when nothing has ever been practised', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.readiness')).toBeVisible();
  await expect(line(page)).toHaveCount(0);
});

test('counts the days in the last seven with any practice, from every source', async ({ page }) => {
  // Today (two count runs: one day), 3 days ago (a Play session), 6 days ago
  // (a deck estimate), and 7 and 12 days ago, which are outside the window.
  await withStats(page, {
    countDrill: {
      history: [localNoon(0), localNoon(0), localNoon(7)].map((date) => ({ date, cards: 52, intervalMs: 800, correct: true })),
    },
    sessions: [{ date: localNoon(3), rounds: 4, graded: 6, correct: 5, bankrollDelta: 1 }],
    deckEstimation: {
      history: [localNoon(6), localNoon(12)].map((date) => ({ date, actualDecks: 3, guess: 3, errorDecks: 0, correct: true })),
    },
  });
  await page.goto('/?e2e=1');
  const inWindow = new Set([0, 0, 3, 6].map((n) => localNoon(n).slice(0, 10)));
  await expect(line(page)).toHaveText(`Practised ${inWindow.size} of the last 7 days`);
  if (SHOTS) {
    await page.addStyleTag({ content: INSET });
    await page.screenshot({ path: `${SHOTS}/f10-home-top-375x812.png` });
    // Below the ladder card: scroll the readiness block clear of the tab bar.
    await page.locator('.readiness').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${SHOTS}/f10-practice-days-375x812.png` });
  }
});

test('practice only long ago: the line says none this week rather than hiding', async ({ page }) => {
  await withStats(page, {
    countDrill: { history: [{ date: localNoon(20), cards: 52, intervalMs: 800, correct: true }] },
  });
  await page.goto('/?e2e=1');
  await expect(line(page)).toHaveText('Practised 0 of the last 7 days');
});

test('a Play round today puts today on the line', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await page.goto('/?seed=4&e2e=1');
  await expect(line(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  // The round is stored as it settles (a reload shows it); End goes back Home.
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await page.locator('.report-done-btn').click();
  await expect(line(page)).toHaveText('Practised 1 of the last 7 days');
});
