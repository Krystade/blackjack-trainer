import { test, expect, type Page } from '@playwright/test';
import { generateAllCells } from '../src/drills/flashcards'; // e2e already imports from src (helpers.ts)
import { activeIndices } from '../src/ui/screens/readiness';
import { withSettings } from './helpers';

/**
 * Wave B2 R7 (#38-#42): "Review N due" is a visibly labelled, finite session.
 * It deals exactly the due items, each leaves once answered right, it ends
 * with "Review done" and a way back, and it never touches the saved settings.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const CELLS = generateAllCells().map((c) => c.id);
const ACTIVE = activeIndices().map((d) => d.id);
const D = '2026-10-16T10:00:00.000Z';
const many = <T,>(n: number, row: T) => Array.from({ length: n }, () => row);
const STRONG = { 'hard-16-v-10': { right: 30, wrong: 0, lastAt: D }, 'soft-18-v-9': { right: 30, wrong: 0, lastAt: D }, 'pair-8-v-A': { right: 30, wrong: 0, lastAt: D } };
/** Rung 4 current (count passed), so a review can come first. */
const RUNG4 = { cellStats: STRONG, masterySweepsCompleted: 1, countDrill: { history: many(5, { date: D, cards: 52, intervalMs: 700, correct: true }) } };
/** Saved settings a review must not touch: a Custom deck on Soft, one index picked, Ask = play. */
const SAVED = {
  drill: {
    deck: 'custom', scopes: ['soft'], flashCategory: 'soft', quizIndex: '16v10', quizAsk: 'index',
    custom: { tiers: { 'soft-18-v-9': 'focus' }, painted: {}, mix: { focus: 60, regular: 30, rare: 10 } },
  },
};

async function seed(page: Page, flashDue: readonly string[], quizDue: readonly string[]) {
  await page.addInitScript(([s, cells, idx]) => {
    if (localStorage.getItem('e2e.seeded') === '1') return;
    localStorage.setItem('e2e.seeded', '1');
    localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, ...s }));
    const past = Date.now() - 86_400_000;
    const deck = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { box: 2, dueAt: past, lastSeenAt: past - 86_400_000, lapses: 0, reviews: 3 }]));
    if (cells.length) localStorage.setItem('bjtrainer.flashsr.v1', JSON.stringify(deck(cells)));
    if (idx.length) localStorage.setItem('bjtrainer.quizsr.v1', JSON.stringify(deck(idx)));
  }, [RUNG4, flashDue, quizDue] as const);
}
const startBtn = (page: Page) => page.getByRole('region', { name: 'Next step' }).getByRole('button', { name: 'Start', exact: true });
const savedSettings = (page: Page) => page.evaluate(() => localStorage.getItem('bjtrainer.settings.v1'));

/** Answer the flashcard on screen: right (the e2e advice) or wrong (another legal play). */
async function answerFlash(page: Page, right: boolean): Promise<void> {
  const bar = page.locator('.action-bar[data-advice]');
  const advice = (await bar.getAttribute('data-advice'))!;
  const buttons = bar.locator('button.action-btn:not([disabled])');
  for (let i = 0; i < (await buttons.count()); i++) {
    const t = (await buttons.nth(i).innerText()).trim().toLowerCase();
    if ((t === advice) === right) {
      await buttons.nth(i).click();
      return;
    }
  }
  throw new Error('no button to press');
}

test('B2 #40 #41 #42: a cell review is labelled, hides the saved deck, ends, and never repeats a cell it passed', async ({ page }) => {
  const due = CELLS.slice(40, 61); // 21 due cells, across hard/soft/pairs
  await seed(page, due, []);
  await withSettings(page, SAVED);
  await page.goto('/?e2e=1');
  await expect(page.getByRole('region', { name: 'Next step' })).toContainText('Review 21 due');
  const before = await savedSettings(page);
  await startBtn(page).click();

  // #40: says it is a review and how much is left; the saved deck is not shown.
  await expect(page.locator('.drill-heading')).toHaveText('Review · 21 due');
  await expect(page.getByTestId('review-status')).toHaveText('21 cells due · 21 left');
  // #41: no scope chips, deck picker or goal line to tap.
  await expect(page.locator('.scope-chips')).toHaveCount(0);
  await expect(page.locator('.deck-select')).toHaveCount(0);
  await expect(page.getByTestId('flash-progress')).toHaveCount(0);

  // One miss first: the cell stays, and is not dealt straight back.
  await answerFlash(page, false);
  const missed = await page.locator('.hand-result').first().getAttribute('data-cell-id');
  await expect(page.getByTestId('review-status')).toHaveText('21 cells due · 21 left');
  const answered: string[] = [];
  for (let i = 0; i < 40 && (await page.getByTestId('review-done').count()) === 0; i++) {
    await answerFlash(page, true);
    if ((await page.getByTestId('review-done').count()) > 0) break;
    answered.push((await page.locator('.hand-result').first().getAttribute('data-cell-id'))!);
  }
  // #42: every due cell exactly once (right), then the end state.
  await expect(page.getByTestId('review-done')).toBeVisible();
  await expect(page.getByTestId('review-done')).toContainText('Review done: all 21 cells answered right.');
  expect(answered[0]).not.toBe(missed);
  expect(answered).toHaveLength(20); // the 21st right answer ends the review
  expect(new Set(answered).size).toBe(20);
  for (const id of answered) expect(due).toContain(id);

  // The ruling: nothing written to the saved settings.
  expect(await savedSettings(page)).toBe(before);
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Next step' })).not.toContainText('Review');
});

test('B2 #38 #39: indexes alone earn a review, and Start asks exactly the due indexes, then ends', async ({ page }) => {
  // Eight due (the H17 threshold: min(8, ceil(17/2))), no insurance, no cells.
  const due = ACTIVE.filter((id) => id !== 'ins').slice(0, 8);
  await seed(page, [], due);
  await withSettings(page, SAVED);
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toHaveAttribute('data-card', 'review');
  await expect(card).toContainText('Review 8 due');
  const before = await savedSettings(page);
  await startBtn(page).click();

  // The quiz, not the Index test the saved Ask names, on the due indexes only.
  await expect(page.locator('.drill-heading')).toHaveText('Review · 8 due');
  await expect(page.getByTestId('review-status')).toHaveText('8 indexes due · 8 left');
  await expect(page.locator('.quiz-index-select')).toHaveCount(0);
  const asked: string[] = [];
  for (let i = 0; i < 20 && (await page.getByTestId('review-done').count()) === 0; i++) {
    const correct = (await page.locator('.drill-screen').getAttribute('data-correct'))!;
    await page.locator('.action-bar').getByRole('button', { name: correct.charAt(0).toUpperCase() + correct.slice(1), exact: true }).click();
    asked.push(correct);
  }
  await expect(page.getByTestId('review-done')).toContainText('Review done: all 8 indexes answered right.');
  expect(asked).toHaveLength(8);
  const quizSr = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.quizsr.v1')!));
  for (const id of due) expect(quizSr[id].dueAt, `${id} was not reviewed`).toBeGreaterThan(Date.now());
  expect(Object.keys(quizSr).sort()).toEqual([...due].sort()); // nothing else was asked
  expect(await savedSettings(page)).toBe(before);
});
