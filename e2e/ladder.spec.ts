import { test, expect, type Page } from '@playwright/test';
import { generateAllCells } from '../src/drills/flashcards'; // e2e already imports from src (helpers.ts)
import { shot, withSettings } from './helpers';

/** B2: Home shows the seven-rung ladder, and one gold Start for the step. */

test.use({ viewport: { width: 375, height: 812 } });

const CELLS = generateAllCells().map((c) => c.id);
const D = '2026-10-16T10:00:00.000Z';
const STRONG = { 'hard-16-v-10': { right: 30, wrong: 0, lastAt: D }, 'soft-18-v-9': { right: 30, wrong: 0, lastAt: D }, 'pair-8-v-A': { right: 30, wrong: 0, lastAt: D } };
const IDS = ['ins', '16v10', '15v10', 'TTv5', 'TTv6', '10v10', '12v3', '12v2', '11vA', '9v2', '10vA', '9v7', '16v9', '13v2', '12v4', '12v5', '12v6', '13v3', '14v10', '15v9', '15vA'];
const many = <T,>(n: number, row: T) => Array.from({ length: n }, () => row);
const RUNG_STATS: Record<number, Record<string, unknown>> = {
  1: {},
  2: { cellStats: STRONG },
  3: { cellStats: STRONG, masterySweepsCompleted: 1 },
};
RUNG_STATS[4] = { ...RUNG_STATS[3], countDrill: { history: many(5, { date: D, cards: 52, intervalMs: 700, correct: true }) } };
RUNG_STATS[5] = { ...RUNG_STATS[4], deckEstimation: { history: many(10, { date: D, actualDecks: 3, guess: 3, errorDecks: 0, correct: true }) }, trueCount: { history: many(10, { date: D, runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct: true }) } };
RUNG_STATS[6] = { ...RUNG_STATS[5], perIndex: Object.fromEntries(IDS.map((id) => [id, { right: 10, wrong: 0 }])) };
RUNG_STATS[7] = { ...RUNG_STATS[6], betSizing: { history: many(10, { date: D, rc: 6, decksRemaining: 3, tc: 2, taken: 4, correct: 4, ok: true }) } };
RUNG_STATS[8] = { ...RUNG_STATS[7], sessions: [{ date: D, rounds: 45, graded: 40, correct: 38, bankrollDelta: 0 }] };

async function seed(page: Page, stats: Record<string, unknown>, flashSrDue = 0) {
  await page.addInitScript(([s, ids]) => {
    localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, ...s }));
    if (ids.length > 0) {
      const past = Date.now() - 86_400_000;
      localStorage.setItem('bjtrainer.flashsr.v1', JSON.stringify(Object.fromEntries(ids.map((id) => [id, { box: 2, dueAt: past, lastSeenAt: past - 86_400_000, lapses: 0, reviews: 3 }]))));
    }
  }, [stats, CELLS.slice(0, flashSrDue)] as const);
}
const card = (page: Page) => page.getByRole('region', { name: 'Next step' });
const startBtn = (page: Page) => card(page).getByRole('button', { name: 'Start', exact: true });

/** B1_SHOTS only: Home in both reference themes, for a visual check. */
async function themedShots(page: Page, name: string) {
  if (!process.env.B1_SHOTS) return;
  for (const theme of ['midnight-felt', 'bone-ink']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await shot(page, `b2-ladder-${name}-${theme}`);
  }
}

const LANDS: [number, string, string, (p: Page) => Promise<void>][] = [
  [1, 'basic', 'flash', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Flashcards'); }],
  [2, 'repair', 'mastery', async (p) => { await expect(p.getByTestId('mastery-progress')).toBeVisible(); }],
  [3, 'count', 'count', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Count drill'); }],
  [4, 'tc', 'deckest', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Deck estimation'); }],
  [5, 'deviations', 'quiz', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Deviation quiz'); }],
  // Before merge the drill does not exist on this branch: assert the launch key and the route only.
  [6, 'betramp', 'betsizing', async (p) => { await expect(p.locator('.tab-bar [aria-current="page"]')).toContainText('Drills'); }],
  [7, 'play', 'play', async (p) => { await expect(p.locator('.table-screen')).toBeVisible(); }],
];

for (const [r, id, kind, lands] of LANDS) {
  test(`rung ${r} (${id}): Home lands on it and Start opens ${kind}`, async ({ page }) => {
    await seed(page, RUNG_STATS[r]!);
    await page.goto('/?e2e=1');
    await expect(card(page)).toHaveAttribute('data-card', 'rung');
    await expect(page.locator('.ladder-row')).toHaveCount(7);
    await expect(page.locator(`.ladder-row[data-rung="${id}"]`)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.ladder-row[data-state="done"]')).toHaveCount(r - 1);
    await expect(startBtn(page)).toHaveAttribute('data-launch', kind);
    await expect(startBtn(page)).toBeInViewport({ ratio: 1 });
    // Above the tab bar, not merely inside the viewport behind it.
    const sb = await startBtn(page).boundingBox();
    const tb = await page.locator('.tab-bar').boundingBox();
    expect(sb!.y + sb!.height).toBeLessThanOrEqual(tb!.y);
    // The card comes before the readiness figures (Start sits beside the
    // title, so it fits the fold either way; the order is the contract).
    const cardBox = await card(page).boundingBox();
    const readinessBox = await page.locator('.readiness').boundingBox();
    expect(cardBox!.y).toBeLessThan(readinessBox!.y);
    await expect(page.locator('.home-screen .u-btn-primary')).toHaveCount(1);
    if (r === 1 || r === 4) await themedShots(page, `rung${r}`);
    await startBtn(page).click();
    await lands(page);
  });
}

test('a locked row is still tappable and opens its own drill', async ({ page }) => {
  await page.goto('/?e2e=1');
  const row = page.locator('.ladder-row[data-rung="count"]');
  await expect(row).toHaveAttribute('data-state', 'locked');
  await expect(row).toHaveAccessibleName('3. Running count at table pace, not yet');
  await expect(page.locator('.ladder-row[data-rung="basic"]')).toHaveAccessibleName('1. Basic strategy, current');
  await row.click();
  await expect(page.locator('.drill-heading')).toHaveText('Count drill');
});

/*
 * Controller ruling (H Review Start): Review opens Flashcards on the due
 * cells handed over in memory and never overwrites the saved Custom deck, so
 * the brief's "deck custom, 24 focus tiers" assertion is replaced by this.
 */
test('Review N due comes first, opens Flashcards, and leaves the saved Custom deck alone', async ({ page }) => {
  await seed(page, RUNG_STATS[4]!, 24);
  await withSettings(page, {
    drill: { deck: 'custom', scopes: ['soft'], flashCategory: 'soft', custom: { tiers: { 'soft-18-v-9': 'focus' }, painted: {}, mix: { focus: 60, regular: 30, rare: 10 } } },
  });
  await page.goto('/?e2e=1');
  await expect(card(page)).toHaveAttribute('data-card', 'review');
  await expect(card(page)).toContainText('Review 24 due');
  await expect(page.locator('.ladder-row[data-rung="tc"]')).toHaveAttribute('aria-current', 'step');
  await themedShots(page, 'review');
  const before = await page.evaluate(() => localStorage.getItem('bjtrainer.settings.v1'));
  await startBtn(page).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  const after = await page.evaluate(() => localStorage.getItem('bjtrainer.settings.v1'));
  expect(after).toBe(before);
  expect(JSON.parse(after!).drill.custom.tiers).toEqual({ 'soft-18-v-9': 'focus' });
});

test('with every rung done, the card rotates to the stalest skill', async ({ page }) => {
  const old = '2026-09-01T10:00:00.000Z';
  const s = structuredClone(RUNG_STATS[8]!) as { deckEstimation: { history: { date: string }[] } };
  s.deckEstimation.history.forEach((r) => (r.date = old));
  await seed(page, s);
  await page.addInitScript((ids) => {
    const soon = Date.now() + 5 * 86_400_000, seen = Date.now() - 86_400_000;
    localStorage.setItem('bjtrainer.quizsr.v1', JSON.stringify(Object.fromEntries(ids.map((id) => [id, { box: 3, dueAt: soon, lastSeenAt: seen, lapses: 0, reviews: 4 }]))));
  }, IDS);
  await page.goto('/?e2e=1');
  await expect(card(page)).toHaveAttribute('data-card', 'stale');
  await expect(card(page)).toContainText('Keep it fresh: Deck estimation');
  await expect(startBtn(page)).toHaveAttribute('data-launch', 'deckest');
});
