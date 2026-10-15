import { test, expect } from '@playwright/test';

/** #28: Home names one next step, says why, and its button goes there. */

async function seedStats(page: import('@playwright/test').Page, cellStats: Record<string, unknown>) {
  await page.addInitScript((cs) => {
    if (window.localStorage.getItem('e2e.noReseed') === '1') return;
    window.localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, cellStats: cs }));
  }, cellStats);
}

test('a fresh install is sent to basic strategy, with the reason', async ({ page }) => {
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toHaveAttribute('data-step', 'flash');
  await expect(card).toContainText('Learn basic strategy');
  await expect(card).toContainText('20 needed to judge');
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.tab-bar [aria-current="page"]')).toContainText('Drills');
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
