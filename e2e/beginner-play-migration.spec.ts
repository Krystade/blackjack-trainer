import { test, expect } from '@playwright/test';

/**
 * T1-1B: the one-time beginner-Play migration on a returning player's data.
 * Seeded by hand, WITHOUT the migration marker (the helpers write it), and
 * only once: the reload at the end must find the migrated data, not a re-seed.
 */

const JACK = {
  id: 'jack',
  name: 'Jack 6D',
  rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
  penetration: 0.75,
  spread: [
    { minTc: -99, units: 1 },
    { minTc: 1, units: 2 },
    { minTc: 2, units: 4 },
    { minTc: 3, units: 8 },
  ],
  bankrollStart: 100,
  countCheckEvery: 5,
  betSpreadOn: true,
  startShoeOut: true,
  seats: { playerHands: 1, bots: 2, botMistakePct: 0, playerPosition: 1 },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((profile) => {
    if (localStorage.getItem('e2e.seededOnce') === '1') return;
    localStorage.setItem('e2e.seededOnce', '1');
    localStorage.setItem('bjtrainer.profiles.v1', JSON.stringify([profile]));
    localStorage.setItem('bjtrainer.activeProfile.v1', profile.id);
    localStorage.setItem('bjtrainer.settings.v1', JSON.stringify({ version: 1, dealerMistakesMode: 'occasional' }));
  }, JACK);
});

test('a returning player gets the beginner table, with every finer value kept', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?seed=3&e2e=1');

  const stored = await page.evaluate(() => ({
    p: JSON.parse(localStorage.getItem('bjtrainer.profiles.v1')!)[0],
    s: JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!),
    m: localStorage.getItem('bjtrainer.migrations.v1'),
  }));
  expect(stored.p.playChecks).toEqual({ count: false, deviations: false, bets: false });
  expect(stored.p.seats.bots).toBe(0);
  expect(stored.p.countCheckEvery).toBe(5);
  expect(stored.p.betSpreadOn).toBe(true);
  expect(stored.p.startShoeOut).toBe(true);
  expect(stored.s.dealerMistakesMode).toBe('occasional');
  expect(stored.s.tableChecks).toEqual({ dealerMistakes: false, distractions: false });
  expect(JSON.parse(stored.m!)).toEqual({ beginnerPlay: 1 });

  // Home offers them back, one tap each.
  const card = page.getByTestId('migrated-off-card');
  await expect(card).toContainText('Play now checks basic strategy only.');
  for (const label of ['Count checks', 'Bet checks', 'Dealer mistakes']) {
    await expect(card.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  // The table: no bots, flat bets, In from round 1 (no In/Out toggle).
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
  await expect(page.locator('.chip-btn')).toHaveCount(0);
  await expect(page.locator('.in-out-toggle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.hands-row .card-rank').first()).toBeVisible();
});

test('a switch turned back on survives a reload (no re-migration)', async ({ page }) => {
  await page.goto('/?seed=3&e2e=1');
  const card = page.getByTestId('migrated-off-card');
  await card.getByRole('button', { name: 'Count checks', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Count checks', exact: true })).toHaveCount(0);
  await page.reload();
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.profiles.v1')!)[0]);
  expect(p.playChecks).toEqual({ count: true, deviations: false, bets: false });
  await expect(page.getByTestId('migrated-off-card').getByRole('button', { name: 'Count checks', exact: true })).toHaveCount(0);
});
