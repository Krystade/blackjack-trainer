import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings, playRoundByAdvice, openProfileFromPlay } from './helpers';

/**
 * #33: the gear in the topbar of Play, Drills and Charts opens a sheet of that
 * tab's settings -- the same Settings and Profile objects, no new storage.
 */

async function storedProfile(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.profiles.v1') ?? '[]')[0]);
}

async function storedSettings(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
}

/** The round counter (the bankroll is a `.topbar-stat` too). */
function roundStat(page: Page) {
  return page.locator('.topbar-stat', { hasText: /^Round \d+$/ });
}

async function openTable(page: Page): Promise<void> {
  await page.goto('/?seed=2&e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
}

async function playOneRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await expect(roundStat(page)).toHaveText('Round 1');
}

test.beforeEach(async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await withProfile(page, { countCheckEvery: 5 });
});

test('the Play gear opens a sheet that leaves the top of the board in view', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openTable(page);
  const gear = page.getByRole('button', { name: 'Play settings' });
  const gearBox = (await gear.boundingBox())!;
  expect(gearBox.width).toBeGreaterThanOrEqual(44);
  expect(gearBox.height).toBeGreaterThanOrEqual(44);

  await gear.click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  // Never the whole board: the topbar and the top of the felt stay visible.
  expect(box.y).toBeGreaterThan(812 * 0.3);
  const topbar = (await page.locator('.topbar').boundingBox())!;
  expect(topbar.y + topbar.height).toBeLessThan(box.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test('profile options are held until the sheet closes, then deal a new shoe', async ({ page }) => {
  await openTable(page);
  await playOneRound(page);

  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const ask = sheet.locator('.count-ask-row');
  await ask.getByRole('button', { name: 'Both', exact: true }).click();
  await expect(ask.getByRole('button', { name: 'Both', exact: true })).toHaveClass(/segmented-btn-active/);
  const players = sheet.locator('.settings-row', { hasText: 'Players with you' });
  const playersBefore = Number(await players.locator('.stepper-value').textContent());
  await players.getByRole('button', { name: '+', exact: true }).click();
  await sheet.locator('.settings-row', { hasText: 'Deck estimation' }).getByRole('button', { name: 'Quarter' }).click();
  await expect(sheet.getByTestId('tab-sheet-when')).toContainText('A new shoe is dealt when you close this');

  // Nothing written, and the table untouched, while the sheet is open.
  const before = await storedProfile(page);
  expect(before.countCheckAsk).toBeUndefined();
  expect(before.playDepth).toBeUndefined();
  await expect(roundStat(page)).toHaveText('Round 1');

  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  const after = await storedProfile(page);
  expect(after.countCheckAsk).toBe('both');
  expect(after.playDepth).toBe('quarter');
  expect((after.seats as { bots: number }).bots).toBe(playersBefore + 1);
  // A new table: the round counter starts again.
  await expect(roundStat(page)).toHaveText('Round 0');

  // Reopened, the sheet shows what was saved.
  await page.getByRole('button', { name: 'Play settings' }).click();
  await expect(sheet.locator('.settings-row', { hasText: 'Players with you' }).locator('.stepper-value')).toHaveText(
    String(playersBefore + 1),
  );
});

test('closing the Play sheet with nothing changed keeps the shoe in play', async ({ page }) => {
  await openTable(page);
  await playOneRound(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  // A change made and undone is no change.
  const players = sheet.locator('.settings-row', { hasText: 'Players with you' });
  await players.getByRole('button', { name: '+', exact: true }).click();
  await players.getByRole('button', { name: '−', exact: true }).click();
  await sheet.getByRole('checkbox', { name: 'Losing shoe' }).check();
  await sheet.getByRole('checkbox', { name: 'Losing shoe' }).uncheck();
  await expect(sheet.getByTestId('tab-sheet-when')).not.toContainText('Changed');
  await page.getByTestId('tab-sheet-scrim').click({ position: { x: 20, y: 20 } });
  await expect(sheet).toHaveCount(0);
  await expect(roundStat(page)).toHaveText('Round 1');
});

test('feedback and deal speed apply at once, without a new shoe', async ({ page }) => {
  await openTable(page);
  await playOneRound(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await sheet.locator('.settings-row', { hasText: 'Feedback' }).getByRole('button', { name: 'Test' }).click();
  await sheet.locator('.settings-row', { hasText: 'Deal speed' }).getByRole('button', { name: '+' }).click();
  expect((await storedSettings(page)).feedbackMode).toBe('test');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(roundStat(page)).toHaveText('Round 1');
  const s = await storedSettings(page);
  expect(s.feedbackMode).toBe('test');
  expect(s.dealSpeedMs).toBeGreaterThan(0);
});

test('the losing shoe from the Play sheet deals the rigged shoe on close', async ({ page }) => {
  await openTable(page);
  await expect(page.getByTestId('losing-shoe-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await sheet.getByRole('checkbox', { name: 'Losing shoe' }).check();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('losing-shoe-badge')).toHaveText('Losing shoe');
  expect((await storedSettings(page)).losingShoe).toBe(true);
});

test('Reset bankroll from the Play sheet resets the table it is on', async ({ page }) => {
  await withProfile(page, { countCheckEvery: 0, bankrollNow: 250 });
  await openTable(page);
  await expect(page.locator('.topbar')).toContainText('Bankroll: 250');
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await sheet.getByRole('button', { name: 'Reset bankroll', exact: true }).click();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.topbar')).toContainText('Bankroll: 100');
});

test('All settings leaves the sheet for the Settings screen', async ({ page }) => {
  await openTable(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'All settings' }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
});

/** Every graded tally in Stats, summed: a re-applied round shows up here. */
async function statsTally(page: Page): Promise<{ graded: number; sessions: { rounds: number }[] }> {
  return page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}');
    let graded = 0;
    for (const t of Object.values(s.categories ?? {}) as { right: number; wrong: number }[]) {
      graded += t.right + t.wrong;
    }
    return { graded, sessions: s.sessions ?? [] };
  });
}

/**
 * D3: ALL SETTINGS AND BACK IS THE SAME SHOE. Before, the Table unmounted,
 * Settings offered only "Back to Home", and Play came back at Round 0 with
 * the count gone. Now Settings offers "Back to the table", and the table it
 * returns to is the one left: same round, same session row, nothing graded
 * twice.
 */
test('All settings and back resumes the same shoe, under one session', async ({ page }) => {
  await openTable(page);
  await playOneRound(page);
  const before = await statsTally(page);
  expect(before.sessions).toHaveLength(1);
  const discards = await page.locator('.table-discard-fill').getAttribute('style');
  expect(discards).not.toMatch(/width: 0%/);

  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'All settings' }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
  await page.getByRole('button', { name: 'Back to the table' }).click();

  await expect(page.locator('.table-screen')).toBeVisible();
  await expect(roundStat(page)).toHaveText('Round 1');
  expect(await page.locator('.table-discard-fill').getAttribute('style')).toBe(discards);
  // The resumed session must not write round 1's events a second time.
  await page.waitForTimeout(300);
  expect((await statsTally(page)).graded).toBe(before.graded);

  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await expect(roundStat(page)).toHaveText('Round 2');
  const after = await statsTally(page);
  expect(after.sessions, 'the resumed shoe opened a second session row').toHaveLength(1);
  expect(after.sessions[0]!.rounds).toBe(2);
});

test('Settings then anywhere but the table: the in-memory shoe is dropped, the saved one comes back', async ({ page }) => {
  await openTable(page);
  await playOneRound(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'All settings' }).click();
  // Not the round trip that promised to come back -- but Track 3 (2026-11-07)
  // keeps the table on disk across every exit but End, so it is resumed.
  const tabs = page.locator('.tab-bar');
  await tabs.getByRole('button', { name: 'Home', exact: true }).click();
  await tabs.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(roundStat(page)).toHaveText('Round 1');
  await expect(page.getByTestId('resumed-shoe-note')).toContainText('Shoe resumed after round 1');
});

test('Settings opened from Home still says Back to Home', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-settings-btn').click();
  await expect(page.locator('.settings-back-btn')).toHaveText('Back to Home');
});

test('owner 2026-11-06: the Play gear is shortcuts only; the rest says it is in the profile', async ({ page }) => {
  await openTable(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  for (const gone of ['Vary bets with the count', 'Grade with deviations', 'Dealer pace clock', 'Vary ±0.5 decks']) {
    await expect(sheet.getByRole('checkbox', { name: gone })).toHaveCount(0);
  }
  await expect(sheet.getByRole('group', { name: 'Dealer mistakes' })).toHaveCount(0);
  await expect(sheet.getByTestId('play-sheet-more')).toContainText('in the profile');
  for (const kept of ['Feedback', 'Deal speed', 'Players with you', 'Deck estimation']) {
    await expect(sheet.locator('.settings-row', { hasText: kept }).first()).toBeVisible();
  }
});

test('D-R1: the Wong exit point is a stepper under the bet spread, -2 by default, -5..0', async ({ page }) => {
  await withProfile(page, { countCheckEvery: 5, betSpreadOn: true });
  await openTable(page);
  // Owner 2026-11-06: in the profile now, under the bet ramp.
  const { editor: sheet, done } = await openProfileFromPlay(page);
  const row = sheet.locator('.settings-row', { hasText: 'Get out at TC' });
  await expect(row.locator('.stepper-value')).toHaveText('−2 or lower');
  await expect(sheet.getByTestId('wong-exit-note')).toHaveText('In, above −2 staying in is right, even where the ramp bets its minimum.');
  await row.getByRole('button', { name: '+' }).click();
  await row.getByRole('button', { name: '+' }).click();
  await expect(row.locator('.stepper-value')).toHaveText('0 or lower');
  await expect(row.getByRole('button', { name: '+' })).toBeDisabled();
  await row.getByRole('button', { name: '−' }).click();
  await done();
  expect((await storedProfile(page)).wongExitTc).toBe(-1);
});

test('Edit profile and bet ramp leaves the Play sheet for the profile editor', async ({ page }) => {
  await openTable(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page
    .getByRole('dialog', { name: 'Play settings' })
    .getByRole('button', { name: 'Edit profile and bet ramp', exact: true })
    .click();
  await expect(page.locator('.table-screen')).toHaveCount(0);
  await expect(page.locator('.profile-editor-screen .settings-heading')).toHaveText('Edit profile');
});

test('the Drills gear sets the shot clock', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Drills settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Drills settings' });
  await sheet.locator('.settings-row', { hasText: 'Shot clock' }).getByRole('button', { name: '5s' }).click();
  expect((await storedSettings(page)).drill.shotClockMs).toBe(5000);
});

test('the Charts gear changes the rules the charts are drawn for', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-ruleset')).toContainText('H17');
  await page.getByRole('button', { name: 'Charts settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Charts settings' });
  await sheet.locator('.settings-row', { hasText: 'Dealer soft 17' }).getByRole('button', { name: 'S17' }).click();
  // Redrawn under the open sheet, and saved to the profile.
  await expect(page.locator('.charts-ruleset')).toContainText('S17');
  expect(((await storedProfile(page)).rules as { s17: boolean }).s17).toBe(true);
  await sheet.getByRole('checkbox', { name: 'Late surrender (LS)' }).uncheck();
  await expect(page.locator('.charts-ruleset')).toContainText('No surrender');
});
