import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings, playRoundByAdvice } from './helpers';

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
  await sheet.getByRole('checkbox', { name: 'Grade with deviations' }).uncheck();
  const ask = sheet.locator('.count-ask-row');
  await ask.getByRole('button', { name: 'Both', exact: true }).click();
  await expect(ask.getByRole('button', { name: 'Both', exact: true })).toHaveClass(/segmented-btn-active/);
  const cut = sheet.locator('.settings-row', { hasText: 'Cut card' });
  await expect(cut.locator('.stepper-value')).toHaveText('1.5 decks behind');
  await cut.getByRole('button', { name: '+', exact: true }).click();
  await sheet.getByRole('checkbox', { name: 'Vary ±0.5 decks' }).check();
  await expect(sheet.getByTestId('tab-sheet-when')).toContainText('A new shoe is dealt when you close this');

  // Nothing written, and the table untouched, while the sheet is open.
  const before = await storedProfile(page);
  expect(before.countCheckAsk).toBeUndefined();
  expect(before.gradeDeviations).toBeUndefined();
  await expect(roundStat(page)).toHaveText('Round 1');

  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  const after = await storedProfile(page);
  expect(after.countCheckAsk).toBe('both');
  expect(after.gradeDeviations).toBe(false);
  expect(after.cutDecks).toBe(1.75);
  expect(after.cutVary).toBe(true);
  expect(after.penetration as number).toBeCloseTo(1 - 1.75 / 6, 5);
  // A new table: the round counter starts again.
  await expect(roundStat(page)).toHaveText('Round 0');

  // Reopened, the sheet shows what was saved.
  await page.getByRole('button', { name: 'Play settings' }).click();
  await expect(sheet.getByRole('checkbox', { name: 'Grade with deviations' })).not.toBeChecked();
  await expect(sheet.locator('.settings-row', { hasText: 'Cut card' }).locator('.stepper-value')).toHaveText(
    '1.75 decks behind',
  );
});

test('closing the Play sheet with nothing changed keeps the shoe in play', async ({ page }) => {
  await openTable(page);
  await playOneRound(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  // A change made and undone is no change.
  await sheet.getByRole('checkbox', { name: 'Vary ±0.5 decks' }).check();
  await sheet.getByRole('checkbox', { name: 'Vary ±0.5 decks' }).uncheck();
  const cut = sheet.locator('.settings-row', { hasText: 'Cut card' });
  await cut.getByRole('button', { name: '+', exact: true }).click();
  await cut.getByRole('button', { name: '−', exact: true }).click();
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

test('the bet spread can be switched on from the Play gear (s06)', async ({ page }) => {
  await openTable(page);
  await expect(page.getByRole('button', { name: /Sit out/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await sheet.getByRole('checkbox', { name: 'Vary bets with the count' }).check();
  await expect(sheet.getByTestId('tab-sheet-when')).toContainText('A new shoe is dealt when you close this');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await storedProfile(page)).betSpreadOn).toBe(true);
  await expect(page.getByRole('button', { name: /Sit out/i })).toBeVisible();
});

test('Profiles leaves the Play sheet for the profile list', async ({ page }) => {
  await openTable(page);
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page
    .getByRole('dialog', { name: 'Play settings' })
    .getByRole('button', { name: 'Profiles', exact: true })
    .click();
  await expect(page.locator('.table-screen')).toHaveCount(0);
  await expect(page.locator('.profile-editor-screen .settings-heading')).toHaveText('Profiles');
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
