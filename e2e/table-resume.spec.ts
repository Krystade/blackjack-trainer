import { test, expect, type Page } from '@playwright/test';
import { withSettings, resolveInsurance, playRoundByAdvice, openStats } from './helpers';

/**
 * Track 3 (2026-11-07): the open Play table is written at every round
 * boundary and taken back by the next Play mount -- after a reload (iOS
 * evicting the page) and after any in-app exit but End. A round the page died
 * in is voided: its cards burned, the ones shown still counted.
 */

const PROFILE = {
  id: 'e2e-resume',
  name: 'Resume',
  rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
  penetration: 0.75,
  spread: [{ minTc: -99, units: 1 }],
  bankrollStart: 100,
  countCheckEvery: 0,
  betSpreadOn: false,
  seats: { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 0 },
};

/**
 * The profile, written ONCE: helpers' withProfile re-seeds on every
 * navigation, which would put the carried bankroll back and (rightly) stop
 * the resume. A reload that is meant to be real sets e2e.noReseed first.
 */
async function seedOnce(page: Page): Promise<void> {
  await withSettings(page, { countCheckEvery: 0 });
  await page.addInitScript((profile) => {
    if (window.localStorage.getItem('e2e.noReseed') === '1') return;
    window.localStorage.setItem('bjtrainer.profiles.v1', JSON.stringify([profile]));
    window.localStorage.setItem('bjtrainer.activeProfile.v1', profile.id);
  }, PROFILE);
}

const roundStat = (page: Page) => page.locator('.topbar-stat', { hasText: /^Round / });
const tabs = (page: Page) => page.locator('.tab-bar');

async function openPlay(page: Page): Promise<void> {
  await tabs(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
}

async function playRounds(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    await playRoundByAdvice(page);
    await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  }
}

/** Every card face up on the felt, dealer and seats. */
const feltCards = (page: Page) =>
  page.locator('.table-screen [data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')!));

/** The peek: "RC +3 · TC +0.6" and the decks left -- the count and the shoe position as the app holds them. */
async function peek(page: Page): Promise<string> {
  const btn = page.locator('.tc-peek-btn');
  await expect(btn).toBeVisible();
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.peek-counts')).toBeVisible();
  const counts = (await page.locator('.peek-counts').textContent())!;
  const depth = (await page.locator('.peek-depth').textContent())!;
  await page.mouse.up();
  return `${counts}${depth}`.trim();
}

async function evict(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.setItem('e2e.noReseed', '1'));
  await page.reload();
}

test('a reload resumes the shoe: same round, bankroll and next cards as if nothing happened', async ({ page, context }) => {
  // The control: the same shoe, never interrupted.
  const control = await context.newPage();
  await seedOnce(control);
  await control.goto('/?seed=7&e2e=1');
  await openPlay(control);
  await playRounds(control, 4);
  // The first line: the profile name shares the stat.
  const expectedBankroll = (await control.locator('.topbar-stat', { hasText: /^Bankroll: / }).innerText()).split('\n')[0]!.trim();
  expect(expectedBankroll).toMatch(/^Bankroll: -?\d+$/);
  await playRounds(control, 1);
  const expectedNext = await feltCards(control);
  await control.close();

  await seedOnce(page);
  await page.goto('/?seed=7&e2e=1');
  await openPlay(page);
  await playRounds(page, 4);
  await evict(page);
  // Through Stats first: any exit but End keeps it.
  await openStats(page);
  await openPlay(page);
  await expect(roundStat(page)).toHaveText('Round 4');
  await expect(page.getByTestId('resumed-shoe-note')).toContainText('Shoe resumed after round 4');
  await expect(page.locator('.topbar-stat', { hasText: /^Bankroll: / })).toHaveText(new RegExp(`^${expectedBankroll}(?![\\d.])`));
  await playRounds(page, 1);
  expect(expectedNext.length).toBeGreaterThanOrEqual(4);
  expect(await feltCards(page)).toEqual(expectedNext);
});

test('Play, the gear to Settings, Home, Play: the shoe is still there', async ({ page }) => {
  await seedOnce(page);
  await page.goto('/?seed=3&e2e=1');
  await openPlay(page);
  await playRounds(page, 2);
  // Play has no tab bar: the gear is its only way out but End.
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'All settings' }).click();
  await tabs(page).getByRole('button', { name: 'Home', exact: true }).click();
  await openPlay(page);
  await expect(roundStat(page)).toHaveText('Round 2');
  await expect(page.getByTestId('resumed-shoe-note')).toContainText('Shoe resumed after round 2');
});

test('a round the page died in is voided: its shown cards stay counted, the shoe goes on after them', async ({ page }) => {
  await seedOnce(page);
  let found = false;
  for (let seed = 1; seed <= 12 && !found; seed++) {
    await page.evaluate(() => window.localStorage.clear()).catch(() => {});
    await page.goto(`/?seed=${seed}&e2e=1`);
    await openPlay(page);
    await playRounds(page, 3);
    const atBoundary = await peek(page);
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    const stand = page.locator('.action-bar[data-advice]');
    if (!(await stand.isVisible({ timeout: 5000 }).catch(() => false))) continue; // settled on the deal
    await expect(page.locator('.fast-forward-btn')).toHaveCount(0);
    const midRound = await peek(page);
    if (midRound.split('·')[0] === atBoundary.split('·')[0]) continue; // the dead round must move the count
    found = true;

    await evict(page);
    await openPlay(page);
    await expect(roundStat(page)).toHaveText('Round 3');
    await expect(page.getByTestId('resumed-shoe-cut')).toContainText('Round 4 was cut off');
    // The count and the shoe are where the driver last saw them, not back at the boundary.
    expect(await peek(page)).toBe(midRound);
    // Its bet is void: the round deals again as round 4.
    await playRounds(page, 1);
    await expect(roundStat(page)).toHaveText('Round 4');
  }
  expect(found, 'no seed in 1..12 stopped mid-round with the count moved').toBe(true);
});

test('Reset bankroll in the Play sheet deals a new shoe', async ({ page }) => {
  await seedOnce(page);
  await page.goto('/?seed=7&e2e=1');
  await openPlay(page);
  // Until the bankroll has moved (Reset is off while it is the starting stake).
  for (let i = 0; i < 12; i++) {
    await playRounds(page, 1);
    if (!/^Bankroll: 100(?!\d)/.test(await page.locator('.topbar-stat', { hasText: /^Bankroll: / }).innerText())) break;
  }
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await sheet.getByRole('button', { name: 'Reset bankroll' }).click();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(roundStat(page)).toHaveText('Round 0');
  await evict(page);
  await openPlay(page);
  await expect(roundStat(page)).toHaveText('Round 0');
  await expect(page.getByTestId('resumed-shoe-note')).toHaveCount(0);
});

test('End is the end: the next Play is a new shoe', async ({ page }) => {
  await seedOnce(page);
  await page.goto('/?seed=7&e2e=1');
  await openPlay(page);
  await playRounds(page, 2);
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-summary')).toBeVisible();
  await evict(page);
  await openPlay(page);
  await expect(roundStat(page)).toHaveText('Round 0');
  await expect(page.getByTestId('resumed-shoe-note')).toHaveCount(0);
});
