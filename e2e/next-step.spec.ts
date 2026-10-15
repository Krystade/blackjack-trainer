import { test, expect } from '@playwright/test';

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

test('with a sweep on record, the next step moves past Mastery', async ({ page }) => {
  await seedStats(page, STRONG, { masterySweepsCompleted: 1 });
  await page.goto('/?e2e=1');
  await expect(page.getByRole('region', { name: 'Next step' })).not.toHaveAttribute('data-step', 'mastery');
});
