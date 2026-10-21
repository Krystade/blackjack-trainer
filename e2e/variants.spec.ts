import { test, expect, type Page } from '@playwright/test';
import { presetData } from '../src/engine/variants/strategy';
import { drawVariantItem } from '../src/drills/variantDrill';
import { evTable, switchChoice } from '../src/engine/variants/ev';
import { chartRules } from '../src/engine/variants/chartGen';
import type { PresetId } from '../src/engine/variants/rules';
import { variantSectionRows } from '../src/ui/screens/variantChartView';

/**
 * Wave L: Free Bet, Spanish 21 and Switch -- picked on Charts, drilled, and
 * logged as a casino game. Expected values are read from the same engine and
 * generated data the app uses, never typed here.
 */

test.use({ viewport: { width: 375, height: 812 } });

const tab = (page: Page, name: string) => page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();
const picker = (page: Page) => page.getByTestId('variant-picker');

/** The cell the screen shows for a hand total against an up card, found through the same row folding. */
function cell(page: Page, preset: PresetId, table: string, section: 'HARD' | 'SOFT', total: number, up: string) {
  const t = presetData(preset).tables.find((x) => x.id === table)!;
  const row = variantSectionRows(t, section, 'descending').find((r) => r.keys.includes(total))!;
  return page.locator(`.variant-table[data-table="${table}"] [data-section="${section}"] tr[data-row="${row.id}"] td[data-up="${up}"]`);
}

test('pick a variant on Charts: its chart, its edge, its rule sets, and the choice is kept', async ({ page }) => {
  await page.goto('/?e2e=1');
  await tab(page, 'Charts');
  await expect(picker(page).getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('variant-charts')).toHaveCount(0);

  await picker(page).getByRole('button', { name: 'Spanish 21' }).click();
  const charts = page.getByTestId('variant-charts');
  await expect(charts).toHaveAttribute('data-preset', 's21-h17');
  await expect(page.getByTestId('variant-house-edge')).toContainText(`${presetData('s21-h17').houseEdge.toFixed(2)}%`);
  // Hard 16 v 2, as generated (a card-count step code, e.g. S5).
  const h16 = presetData('s21-h17').tables[0]!.sections.HARD.find((r) => r.key === 16)!.cells[0]!.code;
  await expect(cell(page, 's21-h17', 'main', 'HARD', 16, '2')).toHaveText(h16);
  await expect(page.getByTestId('variant-after-double')).toBeVisible();

  await page.getByRole('group', { name: 'Rule set' }).getByRole('button', { name: 'S17' }).click();
  await expect(charts).toHaveAttribute('data-preset', 's21-s17');
  await expect(page.getByTestId('variant-house-edge')).toContainText(`${presetData('s21-s17').houseEdge.toFixed(2)}%`);

  // Kept across a reload.
  await page.reload();
  await tab(page, 'Charts');
  await expect(page.getByTestId('variant-charts')).toHaveAttribute('data-preset', 's21-s17');

  // Free Bet: two tables, the free hand's differing from the real one at 14 v 2.
  await picker(page).getByRole('button', { name: 'Free Bet' }).click();
  await expect(page.locator('.variant-table')).toHaveCount(2);
  const fb = presetData('freebet');
  const code = (t: string) => fb.tables.find((x) => x.id === t)!.sections.HARD.find((r) => r.key === 14)!.cells[0]!.code;
  expect(code('real')).not.toBe(code('free'));
  await expect(cell(page, 'freebet', 'free', 'HARD', 14, '2')).toHaveText(code('free'));
  await expect(cell(page, 'freebet', 'real', 'HARD', 14, '2')).toHaveText(code('real'));

  // Switch: the checker agrees with the engine for a deal set here.
  await picker(page).getByRole('button', { name: 'Switch' }).click();
  const checker = page.getByTestId('variant-switch-checker');
  await checker.getByLabel('Hand 1 first card').selectOption('10');
  await checker.getByLabel('Hand 1 second card').selectOption('6');
  await checker.getByLabel('Hand 2 first card').selectOption('10');
  await checker.getByLabel('Hand 2 second card').selectOption('5');
  await checker.getByLabel('Dealer up card').selectOption('10');
  const expected = switchChoice(10, 6, 10, 5, evTable(chartRules('switch'), 10)).switchIt;
  await expect(page.getByTestId('variant-switch-result')).toHaveAttribute('data-switch', String(expected));

  await picker(page).getByRole('button', { name: 'Standard' }).click();
  await expect(page.getByTestId('variant-charts')).toHaveCount(0);
  await expect(page.locator('.chart-legend')).toBeVisible();
});

test('the Variant hands drill deals the seeded hands and grades them on the variant chart', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bjtrainer.variant.v1', 'switch'));
  await page.goto('/?e2e=1&vseed=500');
  await tab(page, 'Drills');
  await page.getByRole('button', { name: 'Variant hands' }).click();
  const drill = page.getByTestId('variant-drill');
  await expect(drill).toHaveAttribute('data-preset', 'switch');

  // Item 0 is seed 500: answered right.
  const first = drawVariantItem('switch', 500);
  const item = page.getByTestId('variant-item');
  await expect(item).toHaveAttribute('data-item-id', first.id);
  const label = (a: string) => a[0]!.toUpperCase() + a.slice(1);
  await page.locator('.action-bar').getByRole('button', { name: label(first.advice.action), exact: true }).click();
  await expect(page.getByTestId('variant-result')).toHaveAttribute('data-correct', 'true');
  await expect(page.getByTestId('variant-drill-score')).toHaveText('1/1');

  // Item 1 is seed 501: answered wrong, and the correction names the right play.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const second = drawVariantItem('switch', 501);
  await expect(item).toHaveAttribute('data-item-id', second.id);
  const wrong = second.advice.action === 'stand' ? 'hit' : 'stand';
  await page.locator('.action-bar').getByRole('button', { name: label(wrong), exact: true }).click();
  const result = page.getByTestId('variant-result');
  await expect(result).toHaveAttribute('data-correct', 'false');
  await expect(result).toContainText(`${label(second.advice.action)} is right.`);
  await expect(page.getByTestId('variant-drill-score')).toHaveText('1/2');

  // The chart opens over the hand, ringed on its cell, and closes back onto it.
  await result.getByRole('button', { name: 'Show me the chart' }).click();
  const ringed = page.locator('.variant-cell[data-highlight="true"]');
  await expect(ringed).toHaveCount(1);
  await expect(ringed).toHaveText(second.advice.code);
  await page.getByRole('button', { name: /Back to hand/ }).click();
  await expect(item).toHaveAttribute('data-item-id', second.id);
});

test('a casino game can be a variant: the card shows its house edge and says counting is not modelled', async ({ page }) => {
  const AT = '2026-10-01T00:00:00.000Z';
  const log = {
    version: 2,
    casinos: [
      {
        id: 'c1',
        name: 'Rio',
        notes: '',
        status: 'ok',
        createdAt: AT,
        updatedAt: AT,
        games: [{ id: 'g1', decks: 6, s17: false, payout: '3:2', minBet: 25, midShoeEntry: 'allowed', csm: false }],
      },
    ],
    sessions: [],
    settings: { startingBankroll: 10000, updatedAt: AT },
    lastExportAt: AT,
  };
  await page.addInitScript((l) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('bjtrainer.casinoLog.v2', l);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(log));
  await page.goto('/?e2e=1');
  await tab(page, 'Casino');
  await page.getByTestId('casino-row').filter({ hasText: 'Rio' }).click();
  await page.getByTestId('game-variant').selectOption('freebet');
  await page.getByRole('button', { name: 'Save casino' }).click();

  const row = page.getByTestId('games-ranked').getByTestId('rank-row');
  await expect(row.getByTestId('rank-ev')).toHaveText('not modelled');
  await expect(row).toContainText('Free Bet');
  await expect(page.getByTestId('compute-all')).toHaveCount(0);
  await row.click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'variant');
  await expect(card.getByTestId('gs-edge')).toHaveText(`${presetData('freebet').houseEdge.toFixed(2)}%`);
  await expect(card.getByTestId('gs-not-modelled')).toHaveText('Not modelled');
  // Stored on the game, additively.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.casinoLog.v2')!).casinos[0].games[0].variant);
  expect(stored).toBe('freebet');
});
