import { test, expect, type Page } from '@playwright/test';
import { withStats, withProfile, statsTab } from './helpers';

/**
 * Wave B2: Stats' table-session figures.
 * #45: the profile block's per-100 and play accuracy answer the time range.
 * #35: a Hot shoe session's bankroll change is not shown as a result.
 */

test.use({ viewport: { width: 375, height: 812 } });

const DAY = 24 * 60 * 60 * 1000;

async function openStats(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
}

const profileRow = (page: Page, label: string) => page.locator('.mistake-row', { hasText: label });

test('B2 #45: the per-100 figure and play accuracy follow the selected range', async ({ page }) => {
  await withProfile(page);
  const old = new Date(Date.now() - 200 * DAY).toISOString();
  const recent = new Date(Date.now() - 1 * DAY).toISOString();
  await withStats(page, {
    sessions: [
      { date: old, rounds: 100, graded: 100, correct: 50, bankrollDelta: 0, profileId: 'e2e-profile', hands: 100, mistakeUnits: 10 },
      { date: recent, rounds: 50, graded: 100, correct: 90, bankrollDelta: 0, profileId: 'e2e-profile', hands: 50, mistakeUnits: 0.5 },
    ],
  });
  await openStats(page);
  await statsTab(page, 'Play');
  // All time pools both: (10 + 0.5) / 150 hands = 7.00 per 100; 140 / 200 right.
  await expect(profileRow(page, 'Lost to playing mistakes')).toContainText('−7.00 u per 100 hands');
  await expect(profileRow(page, 'Your play accuracy')).toContainText('70%');

  await page.locator('.stats-range').getByRole('button', { name: 'Last 7 days', exact: true }).click();
  // Only the recent session is in range: 0.5 / 50 hands = 1.00; 90 / 100 right.
  await expect(profileRow(page, 'Lost to playing mistakes')).toContainText('−1.00 u per 100 hands');
  await expect(profileRow(page, 'Your play accuracy')).toContainText('90%');
});

test('B2 #35: a Hot shoe session shows no bankroll result in Table sessions', async ({ page }) => {
  await withProfile(page);
  const date = new Date(Date.now() - DAY).toISOString();
  await withStats(page, {
    sessions: [
      { date, rounds: 20, graded: 30, correct: 27, bankrollDelta: -6, profileId: 'e2e-profile', profileName: 'E2E Profile' },
      { date, rounds: 25, graded: 33, correct: 30, bankrollDelta: 14.5, profileId: 'e2e-profile', profileName: 'E2E Profile', hotShoe: true },
    ],
  });
  await openStats(page);
  await statsTab(page, 'Progress');
  const rows = page.locator('.session-row');
  await expect(rows).toHaveCount(2);
  const hot = rows.filter({ hasText: 'Hot shoe' });
  const normal = rows.filter({ hasNotText: 'Hot shoe' });
  // The real session keeps its result, coloured as a result.
  await expect(normal.locator('.result-wrong')).toHaveText('−6');
  // The Hot shoe one says the bankroll was not kept, with no number and no colour.
  await expect(hot).not.toContainText('14.5');
  await expect(hot.locator('.result-correct, .result-wrong')).toHaveCount(0);
  await expect(hot.locator('.session-not-kept')).toHaveText('not kept');
});

test('C-R8: play accuracy counts play decisions only, and a pre-B2 row on its graded total', async ({ page }) => {
  await withProfile(page);
  const date = new Date(Date.now() - DAY).toISOString();
  await withStats(page, {
    sessions: [
      // 100 graded, but only 40 were plays (20 right); the rest were bets, sits, checks.
      { date, rounds: 40, graded: 100, correct: 90, bankrollDelta: 0, profileId: 'e2e-profile', plays: 40, playsCorrect: 20 },
      // Written before B2: no plays, so its graded total stands in.
      { date, rounds: 10, graded: 10, correct: 10, bankrollDelta: 0, profileId: 'e2e-profile' },
    ],
  });
  await openStats(page);
  await statsTab(page, 'Play');
  // (20 + 10) / (40 + 10) = 60%, not the 100 / 110 every graded decision gives.
  await expect(profileRow(page, 'Your play accuracy')).toContainText('60%');
});

test('C-R9: a provisional (not ended) session says so in Table sessions', async ({ page }) => {
  await withProfile(page);
  const date = new Date(Date.now() - DAY).toISOString();
  await withStats(page, {
    sessions: [
      { date, rounds: 20, graded: 30, correct: 27, bankrollDelta: -6, profileId: 'e2e-profile', profileName: 'E2E Profile' },
      { date, rounds: 12, graded: 14, correct: 12, bankrollDelta: 3, profileId: 'e2e-profile', profileName: 'E2E Profile', id: 's2', provisional: true },
    ],
  });
  await openStats(page);
  await statsTab(page, 'Progress');
  const rows = page.locator('.session-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: '12 rounds' })).toContainText(' · not ended');
  await expect(rows.filter({ hasText: '20 rounds' })).not.toContainText('not ended');
  await page.locator('.session-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveC/s-shots/c-r9-not-ended.png' });
});
