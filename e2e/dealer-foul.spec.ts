import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, readStats, playRoundByAdvice, statsTab } from './helpers';

/**
 * G2 (L-8): Play's dealer mistakes and the Foul call, on seeded shoes.
 *
 * Seeds found by simulating the default e2e profile (6D H17, solo, flat
 * 1-unit bet) played by the table's own advice with insurance declined:
 *   167 -- round 1: K,8 (18) v dealer 5,4,8 (17); the dealer overpays, +2.
 *    29 -- round 1: 10,9 (19) v dealer 5,K,K (bust); the dealer takes the win.
 *     1 -- round 1 settles with no error.
 * Each spec asserts the seed still does what it says before relying on it.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS =
  'C:/Users/jackp/AppData/Local/Temp/claude/C--Users-jackp/5eb9dd98-f8da-490b-a046-a394be7c9a16/scratchpad/waveG/a-shots';
const NOTCH = ':root { --safe-top: 47px; --safe-bottom: 34px; }';

async function openPlay(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

async function dealAndPlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await expect(page.locator('.round-banner')).toHaveCount(1);
}

const bankroll = async (page: Page): Promise<string> =>
  ((await page.locator('.topbar-stat').first().innerText()).match(/Bankroll: ([\d.]+)/) ?? [])[1] ?? '';

const foul = (page: Page) => page.getByRole('button', { name: 'Foul', exact: true });

async function endWithReport(page: Page): Promise<void> {
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-screen')).toBeVisible();
}

type Row = { dealerErrors?: { made: number; caught: number; falseCalls: number }; plays?: number; playsCorrect?: number };
const sessionRows = async (page: Page): Promise<Row[]> => ((await readStats(page))?.sessions as Row[] | undefined) ?? [];

test('an overpay is caught with Foul: the payout is corrected and the catch reported apart from accuracy', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerMistakes: true });
  await withProfile(page);
  await openPlay(page, 167);
  // Between rounds, before any settlement, there is nothing to call.
  await expect(foul(page)).toHaveCount(0);
  await dealAndPlay(page);

  const banner = page.locator('.round-banner');
  // The seed's round: 18 beats 17, worth +1, and the dealer paid +2.
  await expect(banner).toContainText('You 18');
  await expect(banner).toContainText('Dealer 17');
  await expect(banner).toHaveAttribute('data-net', '2');
  expect(await bankroll(page)).toBe('102');
  await expect(foul(page)).toBeVisible();
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.screenshot({ path: `${SHOTS}/g2-foul-offered-375x812.png` });
  }

  await foul(page).click();
  const verdict = page.getByTestId('foul-verdict');
  await expect(verdict).toHaveAttribute('data-correct', 'true');
  await expect(verdict).toHaveAttribute('data-kind', 'overpay');
  await expect(verdict).toContainText('overpaid');
  await expect(banner).toHaveAttribute('data-net', '1');
  expect(await bankroll(page)).toBe('101');
  // Once per round.
  await expect(foul(page)).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/g2-foul-caught-375x812.png` });

  // The provisional row has it already; the bankroll stored is the corrected one.
  await expect.poll(async () => (await sessionRows(page))[0]?.dealerErrors).toEqual({ made: 1, caught: 1, falseCalls: 0 });

  await endWithReport(page);
  const row = page.getByTestId('report-dealer-errors');
  await expect(row).toHaveText('Dealer errors caught 1/1');
  // Not in the play accuracy: the summary counts the round's graded decisions only.
  const rows = await sessionRows(page);
  expect(rows).toHaveLength(1);
  const summary = await page.locator('.report-summary').innerText();
  expect(summary).toMatch(new RegExp(`^${rows[0]!.playsCorrect} / ${rows[0]!.plays} correct`));
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.screenshot({ path: `${SHOTS}/g2-report-375x812.png` });
  }

  // Stats > Play: its own row in the profile block.
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Play');
  const statsRow = page.locator('.mistake-row', { hasText: 'Dealer errors caught' });
  await expect(statsRow).toContainText('1/1');
  await expect(page.locator('.mistake-row', { hasText: 'Your play accuracy' })).not.toContainText('1/1');
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await statsRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${SHOTS}/g2-stats-play-375x812.png` });
  }
});

test('control: with the setting absent the same seed pays right, and there is no Foul and no row', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await openPlay(page, 167);
  await dealAndPlay(page);
  const banner = page.locator('.round-banner');
  // Same cards as the spec above: the setting draws nothing and moves no card.
  await expect(banner).toContainText('You 18');
  await expect(banner).toContainText('Dealer 17');
  await expect(banner).toHaveAttribute('data-net', '1');
  expect(await bankroll(page)).toBe('101');
  await expect(foul(page)).toHaveCount(0);
  await endWithReport(page);
  await expect(page.getByTestId('report-dealer-errors')).toHaveCount(0);
  expect((await sessionRows(page))[0]?.dealerErrors).toBeUndefined();
});

test('an error left uncalled is graded missed when the next hand is dealt', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerMistakes: true });
  await withProfile(page);
  await openPlay(page, 29);
  await dealAndPlay(page);
  const banner = page.locator('.round-banner');
  await expect(banner).toContainText('You 19');
  await expect(banner).toContainText('(bust)');
  await expect(banner).toContainText('Lose');
  expect(await bankroll(page)).toBe('99');
  await expect(page.getByTestId('foul-missed')).toHaveCount(0);

  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const missed = page.getByTestId('foul-missed');
  await expect(missed).toBeVisible();
  await expect(missed).toHaveAttribute('data-kind', 'take-win');
  await expect(missed).toContainText('Missed');
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await page.screenshot({ path: `${SHOTS}/g2-missed-375x812.png` });
  }
  await playRoundByAdvice(page);
  await endWithReport(page);
  await expect(page.getByTestId('report-dealer-errors')).toHaveAttribute('data-caught', '0');
  const row = (await sessionRows(page))[0]!;
  expect(row.dealerErrors?.caught).toBe(0);
  expect(row.dealerErrors?.made).toBeGreaterThanOrEqual(1);
});

test('Foul on a correct payout is graded wrong and changes nothing', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0, dealerMistakes: true });
  await withProfile(page);
  await openPlay(page, 1);
  await dealAndPlay(page);
  const net = await page.locator('.round-banner').getAttribute('data-net');
  const before = await bankroll(page);
  await foul(page).click();
  const verdict = page.getByTestId('foul-verdict');
  await expect(verdict).toHaveAttribute('data-correct', 'false');
  await expect(verdict).toHaveText('No foul: that payout was right.');
  await expect(page.locator('.round-banner')).toHaveAttribute('data-net', net!);
  expect(await bankroll(page)).toBe(before);
  await endWithReport(page);
  await expect(page.getByTestId('report-dealer-errors')).toHaveText('Dealer errors caught 0/0 · 1 false call');
});

test('the Play sheet turns Dealer mistakes on; off by default', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page);
  await openPlay(page, 167);
  await page.getByTestId('tab-gear-play').click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  // Wave I: a three-way selector (Off / Occasional / Training) replaced the toggle.
  const group = sheet.getByRole('group', { name: 'Dealer mistakes' });
  const occasional = group.getByRole('button', { name: 'Occasional', exact: true });
  await expect(group.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await occasional.click();
  await expect(occasional).toHaveAttribute('aria-pressed', 'true');
  if (SHOTS) {
    await page.addStyleTag({ content: NOTCH });
    await group.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${SHOTS}/g2-play-sheet-375x812.png` });
  }
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  // Read live: the very next round can carry the seed's overpay.
  await dealAndPlay(page);
  await expect(page.locator('.round-banner')).toHaveAttribute('data-net', '2');
  await expect(foul(page)).toBeVisible();
});
