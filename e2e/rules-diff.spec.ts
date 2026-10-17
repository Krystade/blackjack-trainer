import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers';
import { DEFAULT_RULES } from '../src/engine/ruleset';
import { comparisonRules } from '../src/engine/rulesDiff';
import { trueCount } from '../src/engine/count';
import { diffSummary, planRulesDrill } from '../src/drills/rulesDiffDrill';

test.use({ viewport: { width: 375, height: 812 } });

// Read from getChart / indexSetFor / correctPlay for 6D DAS LS (plan 2026-10-17). Same answer at every TC the drill asks.
const H17_S17_6D: Record<string, { h17: string; s17: string }> = {
  'hard-11-v-A': { h17: 'Double', s17: 'Hit' },
  'hard-15-v-A': { h17: 'Surrender', s17: 'Hit' },
  'hard-17-v-A': { h17: 'Surrender', s17: 'Stand' },
  'soft-18-v-2': { h17: 'Double', s17: 'Stand' },
  'soft-19-v-6': { h17: 'Double', s17: 'Stand' },
  'pair-8-v-A': { h17: 'Surrender', s17: 'Split' },
  'hard-12-v-6': { h17: 'Stand', s17: 'Hit' },
  'hard-10-v-A': { h17: 'Double', s17: 'Hit' },
};

async function openRulesDiff(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Rules differences', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Rules differences');
}

test('rules differences: H17 ↔ S17 asks only changed cells, one question each way', async ({ page }) => {
  await openRulesDiff(page);
  await expect(page.locator('.rules-diff-summary li')).toHaveCount(8);
  await shot(page, 'rules-diff-setup');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  let q = page.locator('.rules-diff-question');
  await expect(q).toHaveAttribute('data-side', 'a');
  await expect(page.locator('.rules-diff-inforce')).toContainText('Under H17');
  let cellId = (await q.getAttribute('data-cell'))!;
  expect(Object.keys(H17_S17_6D)).toContain(cellId);
  await page.locator('.rules-diff-answers').getByRole('button', { name: H17_S17_6D[cellId].h17, exact: true }).click();
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'ok');
  await shot(page, 'rules-diff-right');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  q = page.locator('.rules-diff-question');
  await expect(q).toHaveAttribute('data-side', 'b');
  await expect(page.locator('.rules-diff-inforce')).toContainText('Under S17');
  cellId = (await q.getAttribute('data-cell'))!;
  expect(Object.keys(H17_S17_6D)).toContain(cellId);
  await page.locator('.rules-diff-answers').getByRole('button', { name: H17_S17_6D[cellId].h17, exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'miss');
  await expect(strip.locator('.rules-verdict')).toHaveText(`Wrong — ${H17_S17_6D[cellId].s17}`);
  await expect(strip.locator('.rules-explain')).toContainText('H17');
  await shot(page, 'rules-diff-wrong');
});

test('rules differences: Other game lists that comparison, and an identical game offers no Start', async ({ page }) => {
  await openRulesDiff(page);
  await page.getByRole('button', { name: 'Other game', exact: true }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'H17', exact: true }).click();
  const expected = diffSummary(planRulesDrill(...comparisonRules(DEFAULT_RULES, 'custom', { decks: 2, s17: false })));
  await expect(page.locator('.rules-diff-summary li')).toHaveText(expected);
  await page.getByRole('button', { name: '6', exact: true }).click(); // now identical to the 6D H17 profile
  await expect(page.locator('.rules-diff-notice')).toHaveText('These two games play the same. Pick another comparison.');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
});

test('rules differences: works by touch with eyes-free on; 44px answers, no sideways scroll', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('.drill-back-btn').click();
  await page.getByRole('button', { name: 'Rules differences', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const boxes = await page.locator('.rules-diff-answers button').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
  expect(boxes.length).toBeGreaterThan(1);
  for (const b of boxes) { expect(b.w).toBeGreaterThanOrEqual(44); expect(b.h).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.locator('.rules-diff-answers button').first().click();
  await expect(page.getByTestId('result-strip')).toBeVisible();
});

test('rules differences: 6 ↔ 8 decks says the chart is the same and trains the 8-deck tray', async ({ page }) => {
  await openRulesDiff(page);
  await page.getByRole('button', { name: '6 ↔ 8 decks', exact: true }).click();
  await expect(page.locator('.rules-diff-notice')).toHaveText(
    '6 decks and 8 decks use the same basic chart and the same index plays. What changes is the shoe: you divide by more decks. Practise reading the 8-deck tray.');
  await expect(page.locator('.rules-diff-summary li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const q = page.locator('.rules-diff-question');
  await expect(q).toHaveAttribute('data-kind', 'tray-decks');
  await expect(page.locator('.rules-diff-question .deck-tray-context')).toHaveText('8-deck shoe');
  await expect(page.locator('.rules-diff-question .discard-tray--ticked')).toBeVisible();
  const dealt = Number(await q.getAttribute('data-cards-dealt'));
  const left = Math.max(0.5, Math.round(((416 - dealt) / 52) * 2) / 2);
  await page.locator('.rules-diff-depth').getByRole('button', { name: String(left), exact: true }).click();
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'ok');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(q).toHaveAttribute('data-kind', 'tray-tc');
  const rc = Number(await q.getAttribute('data-rc'));
  const tc = trueCount(rc, (416 - Number(await q.getAttribute('data-cards-dealt'))) / 52);
  const pad = await page.locator('.rules-diff-numpad').boundingBox();
  expect(pad!.y + pad!.height).toBeLessThanOrEqual(812);
  await shot(page, 'rules-diff-tray-numpad');
  await page.keyboard.type(String(tc));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'ok');
  await shot(page, 'rules-diff-tray');
});
