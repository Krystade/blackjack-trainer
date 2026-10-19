import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice, statsTab } from './helpers';

/**
 * Wave J: spreading to two hands. A ramp row marked ×2 plays two hands of its
 * units; with the seat set to one hand, the bet bar asks one hand or two, and
 * the bet decision is graded on both.
 *
 * Deterministic by construction: the ramp under test spreads to two hands at
 * TC 0 and above, so the fresh shoe's first count (always 0) calls for two
 * hands of 2u -- whatever the seed deals.
 */

test.use({ viewport: { width: 375, height: 812 } });

const SETTINGS = { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, audio: { enabled: true } };
/** 1u below 0; two hands of 2u from 0 up. */
const TWO_AT_ZERO = [
  { minTc: -99, units: 1 },
  { minTc: 0, units: 2, hands: 2 },
];
const PROFILE = { betSpreadOn: true, countCheckEvery: 0, spread: TWO_AT_ZERO };

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
const handsChoice = (page: Page) => page.getByRole('group', { name: 'Hands this round' });

async function openTable(page: Page, profile: Record<string, unknown> = PROFILE, settings: Record<string, unknown> = SETTINGS) {
  await withSettings(page, settings);
  await withProfile(page, profile);
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

test('the hands toggle shows only when the ramp has a ×2 row', async ({ page }) => {
  await openTable(page, { betSpreadOn: true, countCheckEvery: 0 });
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await expect(handsChoice(page)).toHaveCount(0);
});

test('two hands at a two-hand count: two hands on the felt at the chip, and no miss', async ({ page }) => {
  await openTable(page);
  await expect(handsChoice(page).getByRole('button', { name: '1 hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await handsChoice(page).getByRole('button', { name: '2 hands', exact: true }).click();
  await page.locator('.chip-btn', { hasText: /^2$/ }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.player-hand')).toHaveCount(2);
  await expect(page.locator('.player-hand .hand-bet')).toHaveText(['Bet: 2', 'Bet: 2']);
  await expect(page.locator('.hand-label')).toHaveText(['Hand 2', 'Hand 1']);
  await expect(page.locator('.bet-miss')).toHaveCount(0);
  await playRoundByAdvice(page);
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  // The toggle keeps its choice for the next round, as the chip does.
  await expect(handsChoice(page).getByRole('button', { name: '2 hands', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('one hand at a two-hand count is a hand-count miss: the strip, the spoken lines, the report and Stats', async ({ page }) => {
  await openTable(page);
  await page.locator('.chip-btn', { hasText: /^2$/ }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.locator('.bet-miss')).toHaveText('Bet two hands of 2u at TC +0 — you bet one hand of 2u');
  // The recorded stake line, then the hand count on its own.
  await expect.poll(async () => {
    const said = await speech(page);
    const at = said.indexOf('Your ramp bets two. True count zero.');
    return at >= 0 && said[at + 1] === 'Two hands.';
  }).toBe(true);
  await playRoundByAdvice(page);

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-bets li')).toHaveText(['TC +0 · you bet one hand of 2u · your ramp bets two hands of 2u']);
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await statsTab(page, 'Play');
  await expect(page.getByTestId('bsl-table-bet')).toContainText('0/1');
  await expect(page.getByTestId('bsl-table-bet-hands')).toHaveText(/one hand or two\s*1/);
});

test('one-hand and two-hand rounds in one shoe', async ({ page }) => {
  await openTable(page);
  for (const hands of [2, 1, 2, 1] as const) {
    await handsChoice(page).getByRole('button', { name: hands === 2 ? '2 hands' : '1 hand', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    // Splits can add hands; a round opens with exactly what was asked for.
    await expect(page.locator('.player-hand')).toHaveCount(hands);
    await playRoundByAdvice(page);
    await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  }
  await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText('Round 4');
});

test('the ramp editor: ×2 per row, and hidden for a fixed two-hand seat', async ({ page }) => {
  await withSettings(page, SETTINGS);
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(handsChoice(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'Edit profile and bet ramp', exact: true }).click();
  const lastRow = page.getByTestId('profile-ramp').locator('.spread-row').last();
  await expect(lastRow.getByTestId('spread-hands').getByRole('button', { name: '×1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lastRow.getByTestId('spread-hands').getByRole('button', { name: '×2', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Back at the table on a new shoe, which now asks one hand or two.
  await expect(handsChoice(page)).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.profiles.v1') ?? '[]'));
  expect(stored[0].spread.at(-1)).toEqual({ minTc: 5, units: 12, hands: 2 });
});

test('a fixed two-hand seat: no hands column, no toggle', async ({ page }) => {
  await withSettings(page, SETTINGS);
  await withProfile(page, { ...PROFILE, seats: { playerHands: 2 } });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(handsChoice(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'Edit profile and bet ramp', exact: true }).click();
  await expect(page.getByTestId('profile-ramp').locator('.spread-row')).toHaveCount(2);
  await expect(page.getByTestId('spread-hands')).toHaveCount(0);
});

test('the Losing shoe plays solo whatever the ramp says', async ({ page }) => {
  await openTable(page, PROFILE, { ...SETTINGS, losingShoe: true });
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await expect(handsChoice(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.player-hand')).toHaveCount(1);
});
