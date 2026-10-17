import { test, expect, type Page } from '@playwright/test';
import { readStats, shot, withProfile } from './helpers';
import { DEFAULT_SPREAD } from '../src/engine/game';
import { signed } from '../src/drills/signed';
import {
  betAnswerLabel, betSizingOptions, betSizingWorking, correctBetAnswer, scenarioTc, type BetSizingScenario,
} from '../src/drills/betSizing';

test.use({ viewport: { width: 375, height: 812 } });
const PROFILE = { spread: DEFAULT_SPREAD }; // the e2e default profile: floor rounding, cover off

async function openBetSizing(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Bet sizing', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Bet sizing');
}

async function readScenario(page: Page): Promise<BetSizingScenario> {
  const snap = page.locator('.bet-sizing-snapshot');
  return {
    rc: Number(await snap.getAttribute('data-rc')),
    cardsDealt: Number(await snap.getAttribute('data-cards-dealt')),
    totalDecks: Number(await snap.getAttribute('data-decks')),
  };
}

const history = async (page: Page) =>
  ((await readStats(page))?.betSizing as { history: Record<string, unknown>[] } | undefined)?.history ?? [];

test('bet sizing: the right rung is graded correct, shows the working, and is recorded', async ({ page }) => {
  await openBetSizing(page);
  const s = await readScenario(page);
  await expect(page.locator('.bet-rc')).toHaveText(`RC ${signed(s.rc)}`);
  await expect(page.locator('.bet-sizing-snapshot .discard-tray--ticked')).toBeVisible(); // Play's tray component
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  await page.locator('.bet-sizing-answers').getByRole('button', { name: betAnswerLabel(right), exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(strip.locator('.bet-verdict')).toHaveText('Correct');
  await expect(strip.locator('.bet-working')).toHaveText(betSizingWorking(s, PROFILE));
  const rows = await history(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ rc: s.rc, tc: scenarioTc(s), taken: right, correct: right, ok: true });
  await shot(page, 'bet-sizing-right');
});

test('bet sizing: a wrong rung is graded wrong and names the right one', async ({ page }) => {
  await openBetSizing(page);
  const s = await readScenario(page);
  const right = correctBetAnswer(scenarioTc(s), DEFAULT_SPREAD);
  const wrong = betSizingOptions(DEFAULT_SPREAD).find((o) => o !== right)!;
  await page.locator('.bet-sizing-answers').getByRole('button', { name: betAnswerLabel(wrong), exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'miss');
  await expect(strip.locator('.bet-verdict')).toHaveText(`Wrong — ${betAnswerLabel(right)}`);
  expect((await history(page))[0]).toMatchObject({ taken: wrong, correct: right, ok: false });
  await shot(page, 'bet-sizing-wrong');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('result-strip')).toHaveCount(0);
  await expect(page.locator('.bet-sizing-answers button').first()).toBeVisible();
});

test('bet sizing: double tap records one answer and keeps the result on screen', async ({ page }) => {
  await openBetSizing(page);
  await page.evaluate(() => { (window as unknown as { __e2eAnswerBounceMs: number }).__e2eAnswerBounceMs = 600; });
  await page.locator('.bet-sizing-answers button').first().dblclick();
  await expect(page.getByTestId('result-strip')).toBeVisible();
  expect(await history(page)).toHaveLength(1);
});

test('bet sizing: works by touch with eyes-free on', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('.drill-back-btn').click();
  await page.getByRole('button', { name: 'Bet sizing', exact: true }).click();
  await page.locator('.bet-sizing-answers button').first().click();
  await expect(page.getByTestId('result-strip')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
});

test('bet sizing: 2-deck profile tray, 44px answers, no sideways scroll at 375', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openBetSizing(page);
  await expect(page.locator('.deck-tray-context')).toHaveText('2-deck shoe');
  expect(await page.locator('.bet-sizing-snapshot').getAttribute('data-decks')).toBe('2');
  const boxes = await page.locator('.bet-sizing-answers button').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
  expect(boxes).toHaveLength(7);
  for (const b of boxes) { expect(b.w).toBeGreaterThanOrEqual(44); expect(b.h).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, 'bet-sizing-2d');
});
