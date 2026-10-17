import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

const scopeChip = (page: Page, name: string) =>
  page.locator('.settings-row', { hasText: 'Hands' }).getByRole('button', { name, exact: true });

/** #28: Home names one next step, says why, and its button goes there. */

async function seedStats(page: import('@playwright/test').Page, cellStats: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  await page.addInitScript(([cs, ex]) => {
    if (window.localStorage.getItem('e2e.noReseed') === '1') return;
    window.localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, cellStats: cs, ...ex }));
  }, [cellStats, extra] as const);
}

test('a fresh install is sent to basic strategy, with the reason', async ({ page }) => {
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toHaveAttribute('data-step', 'flash');
  await expect(card).toContainText('Learn basic strategy');
  await expect(card).toContainText('20 needed to judge');
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.tab-bar [aria-current="page"]')).toContainText('Drills');
  // Start opens the drill itself, not the picker.
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
});

test('a weak category is named with its accuracy', async ({ page }) => {
  await seedStats(page, {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 21, wrong: 4, lastAt: '' },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
  });
  await page.goto('/?e2e=1');
  await expect(page.getByRole('region', { name: 'Next step' })).toContainText(
    'Soft totals are at 84%; get every category to 90%.',
  );
});

const STRONG = {
  'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
  'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' },
  'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
};

test('without a sweep on record, Mastery is next', async ({ page }) => {
  await seedStats(page, STRONG);
  await page.goto('/?e2e=1');
  await expect(page.getByRole('region', { name: 'Next step' })).toHaveAttribute('data-step', 'mastery');
});

/* s02 (review) / B2: once every category meets the goal, the basic rung is a done row, not a list. */
test('once all three categories meet the goal, the basic rung is ticked and the list goes', async ({ page }) => {
  await seedStats(page, STRONG);
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toHaveAttribute('data-step', 'mastery');
  await expect(card.locator('[data-rung="basic"]')).toHaveAttribute('data-state', 'done');
  await expect(card.locator('.next-step-progress')).toHaveCount(0);
});

test('with a sweep on record, the next step moves past Mastery', async ({ page }) => {
  await seedStats(page, STRONG, { masterySweepsCompleted: 1 });
  await page.goto('/?e2e=1');
  await expect(page.getByRole('region', { name: 'Next step' })).not.toHaveAttribute('data-step', 'mastery');
});

/*
 * F21 / s01 / s07: Start opens the drill on what the step names -- the hand
 * type it is about, on the chart -- not on whatever scope or deck was saved
 * last. Hard and Soft are done here, so the step is about Pairs.
 */
test('Start opens Flashcards on the hand type the step names, on the chart deck', async ({ page }) => {
  await seedStats(page, {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' },
  });
  await withSettings(page, {
    drill: { deck: 'custom', scopes: ['hard'], flashCategory: 'hard', custom: { tiers: {}, painted: {}, mix: { focus: 60, regular: 30, rare: 10 } } },
  });
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toContainText('Pairs: 0 answers');
  // s02: progress per category, with the met goal ticked.
  await expect(card.locator('[data-hand="hard"]')).toHaveAttribute('data-on-target', 'true');
  await expect(card.locator('[data-hand="hard"]')).toContainText('✓');
  await expect(card.locator('[data-hand="pair"]')).toContainText('0/20 answers');
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await expect(scopeChip(page, 'Pairs')).toHaveAttribute('aria-pressed', 'true');
  await expect(scopeChip(page, 'Hard')).toHaveAttribute('aria-pressed', 'false');
  await expect(scopeChip(page, 'Soft')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('combobox', { name: 'Deck', exact: true })).toHaveValue('chart');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);
  expect(saved.deck).toBe('chart');
  expect(saved.scopes).toEqual(['pairs']);
});

test('the Mastery step sweeps the whole chart even after a Custom session', async ({ page }) => {
  await seedStats(page, STRONG);
  await withSettings(page, {
    drill: { deck: 'custom', scopes: ['soft'], flashCategory: 'soft', custom: { tiers: {}, painted: {}, mix: { focus: 60, regular: 30, rare: 10 } } },
  });
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toHaveAttribute('data-step', 'mastery');
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 330 cleared');
});

/* W13: Next step's Start is the single gold primary on Home. */
test('Start is the one primary button; Play a shoe steps back, and goes when it is the step', async ({ page }) => {
  await page.goto('/?e2e=1');
  const start = page.getByRole('region', { name: 'Next step' }).getByRole('button', { name: 'Start' });
  await expect(start).toHaveClass(/u-btn-primary/);
  await expect(page.locator('.home-screen .u-btn-primary')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Play a shoe', exact: true })).toBeVisible();

  const runs = Array.from({ length: 5 }, () => ({ date: '', cards: 52, intervalMs: 700, correct: true }));
  const perIndex = Object.fromEntries(
    ['ins', '16v10', '15v10', 'TTv5', 'TTv6', '10v10', '12v3', '12v2', '11vA', '9v2', '10vA', '9v7', '16v9', '13v2', '12v4', '12v5', '12v6', '13v3', '14v10', '15v9', '15vA']
      .map((id) => [id, { right: 10, wrong: 0 }]),
  );
  await page.evaluate(
    ([cs, pi, cr]) => {
      window.localStorage.setItem('e2e.noReseed', '1');
      window.localStorage.setItem(
        'bjtrainer.stats.v1',
        // B2: the casino-order ladder also needs deck estimation, true count and the bet ramp (no session yet, so Play is the step).
        JSON.stringify({
          version: 1, cellStats: cs, perIndex: pi, masterySweepsCompleted: 1, countDrill: { history: cr },
          deckEstimation: { history: Array.from({ length: 10 }, () => ({ date: '', actualDecks: 3, guess: 3, errorDecks: 0, correct: true })) },
          trueCount: { history: Array.from({ length: 10 }, () => ({ date: '', runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct: true })) },
          betSizing: { history: Array.from({ length: 10 }, () => ({ date: '', ok: true })) },
        }),
      );
    },
    [STRONG, perIndex, runs] as const,
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Next step' })).toHaveAttribute('data-step', 'play');
  await expect(page.getByRole('region', { name: 'Next step' })).toHaveAttribute('data-card', 'rung');
  await expect(page.locator('.home-play-btn')).toHaveCount(0);
});
