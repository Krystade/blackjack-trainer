import { test, expect, type Page } from '@playwright/test';
import { resolveInsurance, playRoundByAdvice, withProfile, withSettings, openProfileFromPlay } from './helpers';
import { DEFAULT_SPREAD } from '../src/engine/game';
import { correctBetAnswer, scenarioTc, type BetSizingScenario } from '../src/drills/betSizing';

/**
 * Track 3 (2026-11-07): Show chips. Bets are learned in units; the toggle
 * (My system > Bankroll, beside $ per unit) shows Play's bets and the Bet
 * sizing drill in dollars and casino chips -- payouts included, 3:2 on a
 * natural, and what to pull back before the next bet.
 */

test.use({ viewport: { width: 375, height: 812 } });

/** Found by a throwaway engine search (scratch t3/seedSearch): round 1 at 10u, solo, no bots. */
const BJ_SEED = Number(process.env.CHIPS_BJ_SEED ?? '48');
const WIN_SEED = Number(process.env.CHIPS_WIN_SEED ?? '29');

const SOLO = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };

const roundStat = (page: Page) => page.locator('.topbar-stat', { hasText: /^Round / });
const bankroll = (page: Page) => page.locator('.topbar-stat', { hasText: /^Bankroll: / });

async function openPlay(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}&e2e=1`);
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
}

async function playOne(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
}

test('Show chips lives beside $ per unit, saves as a setting, and turns the bankroll into dollars', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await withProfile(page, { unitDollars: 25, bankrollStart: 100 });
  await openPlay(page, 1);
  await expect(bankroll(page)).toContainText('Bankroll: 100');
  const { editor, done } = await openProfileFromPlay(page);
  const unitRow = editor.locator('.settings-row', { hasText: '$ per unit' });
  const toggle = editor.getByRole('checkbox', { name: 'Show chips' });
  await expect(unitRow).toBeVisible();
  await expect(toggle).not.toBeChecked();
  // In the Bankroll section, right under $ per unit.
  const [unitBox, toggleBox] = [await unitRow.boundingBox(), await toggle.boundingBox()];
  expect(toggleBox!.y).toBeGreaterThan(unitBox!.y);
  expect(toggleBox!.y - unitBox!.y).toBeLessThan(120);
  await toggle.check();
  await expect(editor.getByTestId('show-chips-note')).toContainText('$25 a unit');
  const settings = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(settings.showChips).toBe(true);
  const profiles = await page.evaluate(() => window.localStorage.getItem('bjtrainer.profiles.v1') ?? '');
  expect(profiles).not.toContain('showChips');
  await done();
  await expect(bankroll(page)).toContainText('Bankroll: $2,500');
});

test('a natural on $125 pays $187.50 in chips, and the bar says what to pull back', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, showChips: true });
  await withProfile(page, { unitDollars: 12.5, betSpreadOn: true, spread: DEFAULT_SPREAD, seats: SOLO, bankrollStart: 1000 });
  await openPlay(page, BJ_SEED);
  const chips = page.locator('.bet-chips > .chip-btn.chip-money');
  await expect(chips).toHaveText(['$12.50', '$25', '$50', '$100', '$125', '$150']);
  await expect(bankroll(page)).toContainText('Bankroll: $12,500');
  await page.getByRole('button', { name: /^\$125, 10 units$/ }).click();
  await expect(page.getByRole('button', { name: /^\$125, 10 units$/ })).toHaveClass(/chip-selected/);
  await playOne(page);
  const circle = page.getByTestId('bet-circle');
  await expect(circle).toHaveAttribute('data-outcome', 'blackjack');
  await expect(circle).toHaveAttribute('data-dollars', '125');
  await expect(circle).toHaveAttribute('data-paid', '187.5');
  await expect(circle.locator('.bet-circle-label')).toHaveText('paid $187.50');
  // A black, three greens, two reds and a pink beside the stake.
  const paid = circle.locator('.bet-circle-paid .chip-col');
  await expect(paid).toHaveCount(4);
  expect(await paid.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-chip')}x${e.getAttribute('data-count')}`))).toEqual([
    '100x1',
    '25x3',
    '5x2',
    '2.5x1',
  ]);
  await expect(page.getByTestId('bet-pullback')).toHaveText('On the felt $312.50 · next bet $125 · pull back $187.50');
  await expect(bankroll(page)).toContainText('Bankroll: $12,687.50');
  // A smaller next bet: more to pull back.
  await page.getByRole('button', { name: /^\$25, 2 units$/ }).click();
  await expect(page.getByTestId('bet-pullback')).toHaveText('On the felt $312.50 · next bet $25 · pull back $287.50');
});

test('a flat table shows its bet in chips too, with no chip row', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, showChips: true });
  await withProfile(page, { unitDollars: 25, betSpreadOn: false, seats: SOLO });
  await openPlay(page, WIN_SEED);
  await expect(page.locator('.bet-chips .chip-btn')).toHaveCount(0);
  await playOne(page);
  const circle = page.getByTestId('bet-circle');
  await expect(circle).toHaveAttribute('data-outcome', 'win');
  await expect(circle).toHaveAttribute('data-dollars', '25');
  await expect(circle.locator('.bet-circle-label')).toHaveText('paid $25');
  await expect(page.getByTestId('bet-pullback')).toHaveText('On the felt $50 · next bet $25 · pull back $25');
  await expect(roundStat(page)).toHaveText('Round 1');
});

test('chips off: units, as ever', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await withProfile(page, { unitDollars: 25, betSpreadOn: true, spread: DEFAULT_SPREAD, seats: SOLO });
  await openPlay(page, WIN_SEED);
  await expect(page.locator('.bet-chips > .chip-btn')).toHaveText(['1', '2', '4', '8', '10', '12']);
  await expect(page.locator('.chip-money')).toHaveCount(0);
  await playOne(page);
  await expect(page.getByTestId('bet-circle')).toHaveCount(0);
  await expect(page.locator('.hand-bet').first()).toHaveText(/^Bet: \d+$/);
  await expect(page.getByTestId('bet-pullback')).toHaveCount(0);
});

test('Bet sizing with chips: each rung in dollars, and the verdict names the dollars', async ({ page }) => {
  await withSettings(page, { showChips: true });
  await withProfile(page, { unitDollars: 25, spread: DEFAULT_SPREAD });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Bet sizing', exact: true }).click();
  const answers = page.locator('.bet-sizing-answers');
  // The buttons (the chip stack inside each carries data-dollars too).
  const rungs = answers.locator('button.bet-sizing-btn[data-dollars]');
  await expect(rungs).toHaveCount(6);
  expect(await rungs.evaluateAll((els) => els.map((e) => e.getAttribute('data-dollars')))).toEqual([
    '25',
    '50',
    '100',
    '200',
    '250',
    '300',
  ]);
  await expect(answers.getByRole('button', { name: 'Sit', exact: true })).toBeVisible();
  const snap = page.locator('.bet-sizing-snapshot');
  const s: BetSizingScenario = {
    rc: Number(await snap.getAttribute('data-rc')),
    cardsDealt: Number(await snap.getAttribute('data-cards-dealt')),
    totalDecks: Number(await snap.getAttribute('data-decks')),
  };
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  if (right === 'sit') await answers.getByRole('button', { name: 'Sit', exact: true }).click();
  else await answers.locator(`button[data-dollars="${right * 25}"]`).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip.locator('.bet-verdict')).toHaveText(right === 'sit' ? 'Correct — Sit' : `Correct — $${right * 25}`);
  if (right !== 'sit') await expect(strip.locator('.bet-working')).toContainText(`→ ${right}u · $${right * 25}`);
});
