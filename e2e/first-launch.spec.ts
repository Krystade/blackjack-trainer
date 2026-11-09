import { test, expect, type Page } from '@playwright/test';
import { readStats, withStats } from './helpers';

/**
 * T1-1C: the first launch. Fresh storage shows a welcome card, a line on what
 * the app does, and no streak, backup nudge or readiness until the first
 * answer. Each welcome choice moves the ladder's start without passing rungs.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const nextStep = (page: Page) => page.getByRole('region', { name: 'Next step' });
const welcome = (page: Page) => page.getByTestId('welcome-card');
const onboarding = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.onboarding.v1') ?? '{}') as Record<string, unknown>);
const statsRaw = (page: Page) => page.evaluate(() => localStorage.getItem('bjtrainer.stats.v1'));

async function freshHome(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-screen')).toBeVisible();
}

test('fresh storage: the welcome and the intro line, and no streak, backup nudge or readiness', async ({ page }) => {
  await freshHome(page);
  await expect(welcome(page)).toBeVisible();
  await expect(page.getByTestId('home-intro')).toHaveText(
    'Blackjack Trainer takes you from basic strategy to counting a shoe, one step at a time.',
  );
  await expect(page.getByTestId('streak-card')).toHaveCount(0);
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Readiness' })).toHaveCount(0);
  await expect(nextStep(page)).toContainText('Learn basic strategy');
  // Start stays on the first screen of an iPhone 13 mini, above the home indicator.
  const box = await page.locator('.next-step-btn').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(812 - 34);
});

test('"I know basic strategy": counting is next, basic reads skipped, and no stats are written', async ({ page }) => {
  await freshHome(page);
  const before = await statsRaw(page);
  await welcome(page).locator('[data-choice="basic"]').click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(nextStep(page).locator('.next-step-title')).toHaveText('Practise counting');
  await expect(nextStep(page).locator('[data-rung="basic"]')).toHaveAttribute('data-state', 'skipped');
  await expect(nextStep(page).locator('[data-rung="basic"]')).toContainText('skipped');
  await expect(nextStep(page).locator('[data-rung="repair"]')).toHaveAttribute('data-state', 'skipped');
  await expect(nextStep(page).locator('[data-rung="count"]')).toHaveAttribute('data-state', 'current');
  expect(await onboarding(page)).toMatchObject({ welcome: 'basic', startRung: 'count' });
  expect(await statsRaw(page)).toBe(before);

  await page.reload();
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await expect(nextStep(page).locator('.next-step-title')).toHaveText('Practise counting');
  expect(await statsRaw(page)).toBe(before);
});

test('"I count already": deviations are next, and Play checks the count, deviations and bets', async ({ page }) => {
  await freshHome(page);
  await welcome(page).locator('[data-choice="counter"]').click();
  await expect(welcome(page)).toHaveCount(0);
  for (const id of ['basic', 'count', 'tc']) {
    await expect(nextStep(page).locator(`[data-rung="${id}"]`)).toHaveAttribute('data-state', 'skipped');
  }
  await expect(nextStep(page).locator('[data-rung="deviations"]')).toHaveAttribute('data-state', 'current');
  expect(await onboarding(page)).toMatchObject({ welcome: 'counter', startRung: 'deviations' });

  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const toggle = (label: string) => sheet.getByTestId('what-to-check').getByRole('checkbox', { name: label, exact: true });
  for (const label of ['Count checks', 'Deviations', 'Bet checks']) await expect(toggle(label)).toBeChecked();
  for (const label of ['Dealer mistakes', 'Distractions']) await expect(toggle(label)).not.toBeChecked();
});

test('"New to blackjack": basic strategy is next and nothing is skipped', async ({ page }) => {
  await freshHome(page);
  await welcome(page).locator('[data-choice="new"]').click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(nextStep(page).locator('.next-step-title')).toHaveText('Learn basic strategy');
  await expect(nextStep(page).locator('[data-state="skipped"]')).toHaveCount(0);
  expect(await onboarding(page)).toEqual({ welcome: 'new' });
});

test('Skip: the welcome goes and basic strategy is next', async ({ page }) => {
  await freshHome(page);
  await welcome(page).locator('.welcome-skip').click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(nextStep(page).locator('.next-step-title')).toHaveText('Learn basic strategy');
  await expect(nextStep(page).locator('[data-state="skipped"]')).toHaveCount(0);
  expect(await onboarding(page)).toEqual({ welcome: 'skipped' });
  await page.reload();
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

test('with practice on record: no welcome, and the streak and readiness are back', async ({ page }) => {
  await withStats(page, { cellStats: { 'hard-16-v-10': { right: 3, wrong: 1, lastAt: '' } } });
  await freshHome(page);
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.getByTestId('home-intro')).toHaveCount(0);
  await expect(page.getByTestId('streak-card')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Readiness' })).toBeVisible();
});

test('one flashcard answer brings the streak and readiness back', async ({ page }) => {
  await freshHome(page);
  await welcome(page).locator('[data-choice="new"]').click();
  await expect(page.getByTestId('streak-card')).toHaveCount(0);
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button').first().click();
  await expect.poll(async () => Object.keys(((await readStats(page))?.cellStats ?? {}) as object).length).toBe(1);
  // The drill hides the tab bar mid-run; reopening the app lands on Home.
  await freshHome(page);
  await expect(page.getByTestId('streak-card')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Readiness' })).toBeVisible();
  await expect(page.getByTestId('home-intro')).toHaveCount(0);
});
