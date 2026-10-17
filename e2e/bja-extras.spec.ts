import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * B9: the opt-in BJA H17 extra indices, end to end -- the profile toggle, the
 * Charts list and its soft-cell markers, and the Deviation quiz picker.
 */

const TOGGLE_ROW = '.settings-toggle-row';

/** The chip opens the profiles LIST; the editor is behind that row's Edit. */
async function openProfileEditor(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
}

async function openDeviationQuiz(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
}

async function openCharts(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('.charts-heading')).toHaveText('Strategy charts');
}

const A8_V4 = 'tr[data-row="SOFT:19"] td[data-up="4"]';

test('the toggle is off by default and disabled under S17', async ({ page }) => {
  await withProfile(page);
  await openProfileEditor(page);
  const row = page.locator(TOGGLE_ROW, { hasText: 'BJA H17 extra indices' });
  await expect(row.locator('input')).not.toBeChecked();
  await expect(row.locator('input')).toBeEnabled();

  await withProfile(page, { rules: { s17: true }, bjaExtras: true });
  await openProfileEditor(page);
  await expect(row.locator('input')).toBeDisabled();
  await expect(row.locator('input')).not.toBeChecked();
});

test('Charts lists the extras only when the option is on', async ({ page }) => {
  await withProfile(page, { bjaExtras: true });
  await openCharts(page);
  const group = page.locator('[data-testid="chart-indexes"] [data-group="extra"]');
  await expect(group).toBeVisible();
  await expect(group.locator('li[data-index-id="A8v6"]')).toHaveCount(1);
  await expect(page.locator(`${A8_V4}[data-index="true"]`)).toHaveCount(1);

  await withProfile(page, { bjaExtras: false });
  await openCharts(page);
  await expect(page.locator('[data-testid="chart-indexes"]')).toBeVisible();
  await expect(page.locator('[data-testid="chart-indexes"] [data-group="extra"]')).toHaveCount(0);
  await expect(page.locator(A8_V4)).toHaveCount(1);
  await expect(page.locator(A8_V4)).not.toHaveAttribute('data-index', /.*/);
});

test('the quiz offers the extras only when on', async ({ page }) => {
  await withProfile(page, { bjaExtras: true });
  await openDeviationQuiz(page);
  const on = await page.locator('.quiz-index-select option').allTextContents();
  expect(on).toContain('A,8 v 4 (double)');

  await withProfile(page, { bjaExtras: false });
  await openDeviationQuiz(page);
  const off = await page.locator('.quiz-index-select option').allTextContents();
  expect(off.length).toBeGreaterThan(0);
  expect(off).not.toContain('A,8 v 4 (double)');
});

test('a saved pin on an extra falls back to All indices', async ({ page }) => {
  await withProfile(page, { bjaExtras: false });
  await withSettings(page, { drill: { quizIndex: 'A8v4' } });
  await openDeviationQuiz(page);
  await expect(page.locator('.quiz-index-select')).toHaveValue('all');
});
