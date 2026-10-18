import { test, expect, type Page } from '@playwright/test';
import { withProfile, withStats, statsTab } from './helpers';

/**
 * H9 (wave H, story 14): Stats > Drills > Deviation quiz said "No deviation
 * quiz answers yet." above a filled index table. The line keyed on the quiz's
 * own tally (`bySource.quiz`); the table pools every drill's index answers
 * (perIndex minus the table's slice), which can be filled without it.
 */

test.use({ viewport: { width: 375, height: 812 } });

const EMPTY = 'No deviation quiz answers yet.';

async function openDrillsStats(page: Page, stats: Record<string, unknown>) {
  await withProfile(page);
  await withStats(page, stats);
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Stats', exact: true }).click();
  await statsTab(page, 'Drills');
  const section = page.locator('details.stats-section[data-tab="drills"]', { has: page.locator('summary', { hasText: 'Deviation quiz' }) });
  await expect(section).toBeVisible();
  return section;
}

test('drill index answers with no quiz tally: a table, a caption, no "no answers yet"', async ({ page }) => {
  // The story-14 seed: perIndex from the drills, no bySource.quiz.
  const section = await openDrillsStats(page, {
    perIndex: { '16v10': { right: 8, wrong: 4 }, '12v3': { right: 1, wrong: 3 }, ins: { right: 0, wrong: 2 } },
  });
  await expect(section.getByTestId('drill-index-table')).toBeVisible();
  await expect(section.getByTestId('drill-index-caption')).toHaveText('Index answers from drills');
  await expect(section).not.toContainText(EMPTY);
});

test('nothing answered: the empty line and no table', async ({ page }) => {
  const section = await openDrillsStats(page, {});
  await expect(section).toContainText(EMPTY);
  await expect(section.getByTestId('drill-index-table')).toHaveCount(0);
  await expect(section.getByTestId('drill-index-caption')).toHaveCount(0);
});

test('a quiz tally: the headline, neither the empty line nor the caption', async ({ page }) => {
  const section = await openDrillsStats(page, {
    perIndex: { '16v10': { right: 3, wrong: 1 } },
    bySource: { quiz: { hard: { right: 3, wrong: 1 } } },
  });
  await expect(section.locator('.stats-headline')).toContainText('3/4 correct, all time.');
  await expect(section).not.toContainText(EMPTY);
  await expect(section.getByTestId('drill-index-caption')).toHaveCount(0);
});
