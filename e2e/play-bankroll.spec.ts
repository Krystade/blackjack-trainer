import { test, expect, type Page } from '@playwright/test';
import { withSettings, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * #42: the Play bankroll carries over per profile (Profile.bankrollNow), and
 * the Play gear sheet (#33) can reset it.
 *
 * No withProfile() here on purpose: it re-seeds the profile on EVERY
 * navigation, including the reload this spec exists to survive. The first-run
 * migration builds the profile from the settings blob instead, and
 * withSettings stops re-seeding once `e2e.noReseed` is set.
 */

async function readBankroll(page: Page): Promise<number> {
  const text = await page.locator('.topbar-stat').first().innerText();
  const match = text.match(/Bankroll:\s*(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`could not parse bankroll from "${text}"`);
  return Number(match[1]);
}

async function readRound(page: Page): Promise<number> {
  const text = await page.locator('.topbar-stat', { hasText: /^Round / }).innerText();
  return Number(text.replace('Round ', ''));
}

async function storedBankrollNow(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const profiles = JSON.parse(window.localStorage.getItem('bjtrainer.profiles.v1') ?? '[]');
    return profiles[0]?.bankrollNow;
  });
}

/** The only way off the table: End session (confirm), then the report's Back to Home.
 * F22: a session ended at round 0 has no report and goes straight Home. */
async function leavePlay(page: Page): Promise<void> {
  const atRoundZero = (await readRound(page)) === 0;
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  if (atRoundZero) {
    await expect(page.locator('.table-screen')).toHaveCount(0);
    return;
  }
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
}

/** Deal and play rounds until the bankroll has moved off its start. */
async function playUntilBankrollMoves(page: Page, start: number): Promise<number> {
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    await playRoundByAdvice(page);
    await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
    const now = await readBankroll(page);
    if (now !== start) return now;
  }
  throw new Error('bankroll never moved in 12 rounds');
}

test('the bankroll carries across leaving Play and a reload, without resetting the table mid-session', async ({
  page,
}) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await readBankroll(page)).toBe(100);

  const moved = await playUntilBankrollMoves(page, 100);
  const round = await readRound(page);
  expect(round).toBeGreaterThan(0);

  // Written back as the round settled...
  await expect.poll(() => storedBankrollNow(page)).toBe(moved);
  // ...WITHOUT remounting the table: a remount starts a new Game at round 0
  // with a fresh shoe. Dealing on continues the same session.
  expect(await readRound(page)).toBe(round);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  expect(await readRound(page)).toBe(round + 1);
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  const carried = await readBankroll(page);
  await expect.poll(() => storedBankrollNow(page)).toBe(carried);

  // Leave Play and come back: a new table, the same bankroll.
  await leavePlay(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await readRound(page)).toBe(0);
  expect(await readBankroll(page)).toBe(carried);

  // And across a reload.
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await readBankroll(page)).toBe(carried);
});

test('the session report measures the bankroll from where the session started', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const first = await playUntilBankrollMoves(page, 100);

  // A second session on the same profile, starting from the carried bankroll.
  await leavePlay(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await readBankroll(page)).toBe(first);
  const second = await playUntilBankrollMoves(page, first);

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  const delta = second - first;
  await expect(page.locator('.report-summary')).toContainText(
    `bankroll ${delta >= 0 ? `+${delta}` : String(delta)}`,
  );
});

test('Reset bankroll in the Play sheet puts Play back to the starting bankroll', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, bankrollStart: 100 });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const moved = await playUntilBankrollMoves(page, 100);

  // #33: from the table's own gear, without leaving Play.
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const value = sheet.getByTestId('play-bankroll');
  await expect(value).toHaveText(`${moved} (starts at 100)`);
  const reset = sheet.getByRole('button', { name: 'Reset bankroll', exact: true });
  await reset.click();
  await expect(value).toHaveText('100');
  await expect(reset).toBeDisabled();
  expect(await storedBankrollNow(page)).toBeUndefined();

  // Closing deals a new table at the starting bankroll, and it stays there.
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await readBankroll(page)).toBe(100);
  await leavePlay(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await readBankroll(page)).toBe(100);
});
