import { test, expect, type Page } from '@playwright/test';
import { generateAllCells } from '../src/drills/flashcards'; // e2e already imports from src (helpers.ts)
import { basicPlay } from '../src/engine/strategy';
import { FULL_CTX } from '../src/drills/fallbackHand';
import type { RuleSet } from '../src/engine/ruleset';
import { withProfile, withSettings } from './helpers';
import { worstContrast } from './contrast';

/**
 * F12 (W2-21, D3): Charts "Test me". Paint a blank Soft chart from memory
 * with the painter's tap and drag, two cells deliberately wrong; Check rings
 * exactly those two with the right play, scores "Soft: 78/80", and puts
 * exactly those two cells into the review schedule, due now. 375x812 with notch insets,
 * nothing scrolling sideways.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const SHOTS = process.env.SHOT_DIR ?? 'e2e/screenshots';
/** withProfile's default rules: 6D H17 DAS LS. */
const RULES: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
const CELLS = generateAllCells();
const UPS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'] as const;
const BRUSH = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' } as const;

/** The answer key from the strategy engine, not from the screen's own chart lookup. */
function key(prefix: string): Map<string, keyof typeof BRUSH> {
  return new Map(
    CELLS.filter((c) => c.id.startsWith(prefix)).map((c) => [c.id, basicPlay(c.cards, c.up, FULL_CTX, RULES).action]),
  );
}

const D = '2026-10-16T10:00:00.000Z';
const STRONG = { 'hard-16-v-10': { right: 30, wrong: 0, lastAt: D }, 'soft-18-v-9': { right: 30, wrong: 0, lastAt: D }, 'pair-8-v-A': { right: 30, wrong: 0, lastAt: D } };
/** Home's rung 4 current (as review-session.spec.ts seeds it), so "Review N due" is Home's next step. */
const RUNG4 = {
  cellStats: STRONG,
  masterySweepsCompleted: 1,
  countDrill: { history: Array.from({ length: 5 }, () => ({ date: D, cards: 52, intervalMs: 700, correct: true })) },
};

async function setup(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(() => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important;--safe-bottom:34px !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
  await page.addInitScript((s) => {
    if (localStorage.getItem('e2e.seeded') === '1') return;
    localStorage.setItem('e2e.seeded', '1');
    localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, ...s }));
  }, RUNG4);
  await withSettings(page, settings);
  await withProfile(page);
}

async function openTest(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await page.getByRole('button', { name: 'Test me', exact: true }).click();
  await expect(page.getByTestId('chart-test')).toBeVisible();
}

const cell = (page: Page, id: string) => page.locator(`.ct-cell[data-cell="${id}"]`);

async function noSidewaysScroll(page: Page): Promise<void> {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]!);
  const grid = (await page.locator('.ct-grid').boundingBox())!;
  expect(grid.x).toBeGreaterThanOrEqual(0);
  expect(grid.x + grid.width).toBeLessThanOrEqual(375);
}

test('F12: paint Soft from memory with two misses; Check rings exactly those two, scores, and they are due in Review', async ({ page }) => {
  await setup(page);
  await openTest(page);

  // Blank: the default table is Hard, every cell empty.
  await expect(page.locator('.ct-cell')).toHaveCount(150);
  await expect(page.locator('.ct-cell[data-act]')).toHaveCount(0);
  await expect(page.getByTestId('chart-test-left')).toHaveText('150 left');
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeDisabled();
  await noSidewaysScroll(page);
  await page.screenshot({ path: `${SHOTS}/f12-blank.png` });

  await page.getByRole('button', { name: 'Soft', exact: true }).click();
  await expect(page.locator('.ct-cell')).toHaveCount(80);
  const answers = key('soft-');
  expect(answers.size).toBe(80);
  const wrong = new Map<string, keyof typeof BRUSH>([
    ['soft-18-v-9', 'stand'], // the chart hits
    ['soft-13-v-5', 'hit'], // the chart doubles
  ]);
  expect(answers.get('soft-18-v-9')).toBe('hit');
  expect(answers.get('soft-13-v-5')).toBe('double');

  // The painter's drag: one stroke across soft 20 (A,9) paints all ten stand.
  await page.getByRole('radio', { name: 'Stand' }).click();
  await cell(page, 'soft-20-v-2').scrollIntoViewIfNeeded();
  const a = (await cell(page, 'soft-20-v-2').boundingBox())!;
  const b = (await cell(page, 'soft-20-v-A').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 1 });
  await page.mouse.up();
  for (const up of UPS) await expect(cell(page, `soft-20-v-${up}`)).toHaveAttribute('data-act', 'stand');

  // Every other cell by tap, one brush at a time.
  const target = new Map([...answers].map(([id, act]) => [id, wrong.get(id) ?? act]));
  for (const fam of Object.keys(BRUSH) as (keyof typeof BRUSH)[]) {
    const ids = [...target].filter(([id, act]) => act === fam && !id.startsWith('soft-20-')).map(([id]) => id);
    if (ids.length === 0) continue;
    await page.getByRole('radio', { name: BRUSH[fam] }).click();
    for (const id of ids) await cell(page, id).click();
  }
  await expect(page.getByTestId('chart-test-left')).toHaveText('All painted');
  for (const [id, act] of target) await expect(cell(page, id)).toHaveAttribute('data-act', act);
  await noSidewaysScroll(page);
  await cell(page, 'soft-18-v-9').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/f12-painted.png` });

  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('chart-test-score')).toHaveText('Soft: 78/80');
  const misses = page.locator('.ct-cell[data-miss="true"]');
  await expect(misses).toHaveCount(2);
  expect((await misses.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cell))).sort()).toEqual(
    ['soft-13-v-5', 'soft-18-v-9'],
  );
  // Each ringed cell shows the RIGHT play.
  await expect(cell(page, 'soft-18-v-9')).toHaveAttribute('data-act', 'hit');
  await expect(cell(page, 'soft-13-v-5')).toHaveAttribute('data-act', 'double');
  await expect(cell(page, 'soft-18-v-9')).toHaveText('H');
  // The ring is really drawn (not just an attribute).
  expect(await cell(page, 'soft-18-v-9').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  expect(await cell(page, 'soft-17-v-9').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  await noSidewaysScroll(page);
  await cell(page, 'soft-18-v-9').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/f12-checked.png` });

  // Only the misses were recorded: two due flashcards, two wrong answers under chartTest.
  const stored = await page.evaluate(() => ({
    sr: JSON.parse(localStorage.getItem('bjtrainer.flashsr.v1') ?? '{}'),
    stats: JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}'),
    now: Date.now(),
  }));
  expect(Object.keys(stored.sr).sort()).toEqual(['soft-13-v-5', 'soft-18-v-9']);
  for (const card of Object.values(stored.sr) as { dueAt: number; box: number }[]) {
    expect(card.box).toBe(0);
    expect(card.dueAt).toBeLessThanOrEqual(stored.now);
  }
  const bucket = stored.stats.bySource?.chartTest as Record<string, { right: number; wrong: number }>;
  expect(Object.values(bucket).reduce((n, t) => n + t.wrong, 0)).toBe(2);
  expect(Object.values(bucket).reduce((n, t) => n + t.right, 0)).toBe(0);

  // ...and the review schedule shows them due now. (Home's "Review N due"
  // card counts graduated cards only -- "a card missed today waits", as for
  // a missed flashcard -- so the schedule itself is where a fresh miss shows.)
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'All stats', exact: true }).click();
  await page.locator('.stats-tabs [role="tab"]', { hasText: 'Progress' }).click();
  const sr = page.locator('.stats-section', { hasText: 'Spaced repetition — Flashcards' }).first();
  await expect(sr.locator('.mistake-row', { hasText: 'Due now' })).toHaveText(/Due now\s*2$/);
  const box0 = sr.locator('.sr-bar-col', { has: page.locator('.sr-bar-label', { hasText: 'Box 0' }) });
  await expect(box0.locator('.sr-bar-count')).toHaveText('2');
});

test('F12: Try again clears the table for another go, and a perfect Pairs scores full with nothing recorded', async ({ page }) => {
  await setup(page);
  await openTest(page);
  await page.getByRole('button', { name: 'Pairs', exact: true }).click();
  const answers = key('pair-');
  expect(answers.size).toBe(100);
  for (const fam of Object.keys(BRUSH) as (keyof typeof BRUSH)[]) {
    const ids = [...answers].filter(([, act]) => act === fam).map(([id]) => id);
    if (ids.length === 0) continue;
    await page.getByRole('radio', { name: BRUSH[fam] }).click();
    for (const id of ids) await cell(page, id).click();
  }
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('chart-test-score')).toHaveText('Pairs: 100/100');
  await expect(page.locator('.ct-cell[data-miss="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.flashsr.v1'))).toBeNull();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.ct-cell[data-act]')).toHaveCount(0);
  await expect(page.getByTestId('chart-test-left')).toHaveText('100 left');
  // Back to the chart itself.
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(page.locator('[data-section="PAIRS"] .chart-table')).toBeVisible();
});

test('F12: no Test me in eyes-free', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test me', exact: true })).toBeVisible();
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Speed', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: /^Back/ }).first().click();
  await page.locator('.tab-bar').getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-heading')).toHaveText('Strategy charts');
  await expect(page.getByRole('button', { name: 'Test me', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chart-test')).toHaveCount(0);
});

for (const theme of ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const) {
  test(`F12: ${theme}: painted, ringed and brush letters pass AA; rows paint from their label`, async ({ page }) => {
    await setup(page, { theme });
    await openTest(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Pairs', exact: true }).click();
    // Every row by its label, all split: the misses are every cell the chart
    // does not split, so all five families end up on screen after Check.
    await page.getByRole('radio', { name: 'Split' }).click();
    for (const rank of ['A', '10', '9', '8', '7', '6', '5', '4', '3', '2']) {
      await page.getByRole('button', { name: `Paint the ${rank},${rank} row`, exact: true }).click();
    }
    await expect(page.locator('.ct-cell[data-act="split"]')).toHaveCount(100);
    const brushes = await worstContrast(page, '.ct-brush');
    expect(brushes, `${theme} brushes ${brushes.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    const misses = await page.locator('.ct-cell[data-miss="true"]').count();
    const answers = key('pair-');
    expect(misses).toBe([...answers.values()].filter((a) => a !== 'split').length);
    await expect(page.getByTestId('chart-test-score')).toHaveText(`Pairs: ${100 - misses}/100`);
    const cells = await worstContrast(page, '.ct-cell[data-act]');
    expect(cells, `${theme} cells ${cells.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    if (theme === 'bone-ink') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.ct-grid').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/f12-checked-bone-ink.png` });
    }
  });
}
