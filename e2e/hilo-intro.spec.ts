import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * T2-2B: "Learn Hi-Lo" shows in place of the count drill's setup once basic
 * strategy is passed and no count run is on record. A tap-along that ends at
 * a running count of 0, then Start easy first run or Skip; once only.
 */

test.use({ viewport: { width: 375, height: 812 } });

const D = '2026-10-16T10:00:00.000Z';
// ladder.spec's rung-2 seed: basic strategy passed.
const BASIC_PASSED = {
  cellStats: {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: D },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: D },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: D },
  },
};

async function seedStats(page: Page, stats: Record<string, unknown>) {
  await page.addInitScript((s) => {
    localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, ...s }));
  }, stats);
}

async function openCount(page: Page, url = '/?e2e=1&intro=1') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
}

const card = (page: Page) => page.getByTestId('hilo-intro');

test('basic passed: the card teaches the rule, the tap-along ends at 0, and Start easy first run goes', async ({ page }) => {
  await withProfile(page);
  await seedStats(page, BASIC_PASSED);
  await openCount(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.hilo-intro-rule')).toContainText('2 to 6');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);

  const tap = (label: string) => card(page).getByRole('group', { name: 'Hi-Lo value' }).getByRole('button', { name: label, exact: true }).click();
  const feedback = page.getByTestId('hilo-tap-feedback');
  // 5 h: +1 (right).
  await tap('+1');
  await expect(feedback).toHaveText('Right: that card is +1.');
  // K s: −1, answered 0 (wrong).
  await tap('0');
  await expect(feedback).toHaveText('Not quite: that card is −1.');
  // 9, 2, A, 7.
  for (const l of ['0', '+1', '−1', '0']) await tap(l);
  await expect(page.getByTestId('hilo-tap-total')).toHaveText('Running count: 0. You just counted.');

  await page.getByRole('button', { name: 'Start easy first run', exact: true }).click();
  await expect(page.getByTestId('count-leadin')).toBeVisible();
  const drill = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);
  expect(drill.countIntervalMs).toBe(2000);
  expect(drill.countShowHiLo).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.hiLoIntro.v1'))).toBe('1');
});

test('Skip shows the normal setup, and the card does not come back', async ({ page }) => {
  await withProfile(page);
  await seedStats(page, BASIC_PASSED);
  await openCount(page);
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await openCount(page);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('basic not passed: no card, and Start runs', async ({ page }) => {
  await withProfile(page);
  await openCount(page);
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('count-leadin')).toBeVisible();
});

test('a count run on record: no card', async ({ page }) => {
  await withProfile(page);
  await seedStats(page, { ...BASIC_PASSED, countDrill: { history: [{ date: D, cards: 52, intervalMs: 2000, correct: true }] } });
  await openCount(page);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('basic SKIPPED at the welcome counts as done: the card shows', async ({ page }) => {
  await withProfile(page);
  // The welcome's "I know basic strategy": rungs before count are skipped, not passed.
  await page.addInitScript(() => {
    localStorage.setItem('bjtrainer.onboarding.v1', JSON.stringify({ welcome: 'basic', startRung: 'count' }));
  });
  await openCount(page);
  await expect(card(page)).toBeVisible();
});

test('count skipped (welcome: counter) but not passed: the card still shows', async ({ page }) => {
  await withProfile(page);
  await page.addInitScript(() => {
    localStorage.setItem('bjtrainer.onboarding.v1', JSON.stringify({ welcome: 'counter', startRung: 'deviations' }));
  });
  await openCount(page);
  await expect(card(page)).toBeVisible();
});
