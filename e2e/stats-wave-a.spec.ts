import { test, expect, type Page } from '@playwright/test';
import { withStats, statsTab } from './helpers';

/**
 * Wave A, lane A4: Stats says what the user did, in the range they asked
 * for, under the right labels (W15, s02, s04, s05, s06, s10, F27).
 */

const DAY = 24 * 60 * 60 * 1000;

async function openStats(page: Page, url = '/?e2e=1') {
  await page.goto(url);
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
}

const section = (page: Page, title: string) =>
  page.locator('details.stats-section').filter({ has: page.locator('summary', { hasText: title }) });

test('W15: the profile block lists only figures it has, lives on Play, and starts closed', async ({ page }) => {
  await openStats(page);
  const profile = section(page, 'Profile:');
  await expect(profile).toContainText('No CVCX figures or table sessions');
  await expect(profile.locator('.mistake-row', { hasText: 'CVCX score' })).toHaveCount(0);
  await statsTab(page, 'Drills');
  await expect(profile).toBeHidden();

  // Without the e2e flag every section starts as the user sees it: closed.
  await openStats(page, '/');
  await expect(section(page, 'Profile:')).not.toHaveAttribute('open', '');
});

test('s02: hand categories show the goal figure against a 90% marker', async ({ page }) => {
  await withStats(page, {
    cellStats: {
      'hard-16-v-10': { right: 27, wrong: 3, lastAt: '' },
      'soft-18-v-9': { right: 17, wrong: 3, lastAt: '' },
    },
  });
  await openStats(page);
  const hard = page.locator('.category-row[data-hand="hard"]');
  await expect(hard).toHaveAttribute('data-on-target', 'true');
  await expect(hard.locator('.category-fraction')).toHaveText('27/30 (90%)');
  await expect(hard).toContainText('On target');
  await expect(hard.locator('.goal-bar-target')).toHaveCount(1);
  const soft = page.locator('.category-row[data-hand="soft"]');
  await expect(soft).toHaveAttribute('data-on-target', 'false');
  await expect(soft).toContainText('5 points to the 90% goal');
  await expect(page.locator('.category-row[data-hand="pair"]')).toContainText('0 of 20 answers needed to judge');
});

test('review: 1 point is singular, older answers are shown, surrender overlap is said', async ({ page }) => {
  await withStats(page, {
    categories: { pairs: { right: 380, wrong: 20 }, surrender: { right: 3, wrong: 1 } },
    cellStats: {
      'hard-16-v-10': { right: 89, wrong: 11, lastAt: '' },
      'pair-8-v-A': { right: 12, wrong: 0, lastAt: '' },
    },
  });
  await openStats(page);
  const hard = page.locator('.category-row[data-hand="hard"]');
  await expect(hard).toContainText('1 point to the 90% goal');
  await expect(hard).not.toContainText('points');
  // cellStats has no backfill: answers from before it are shown, not dropped.
  const pair = page.locator('.category-row[data-hand="pair"]');
  await expect(pair).toContainText('12 of 20 answers needed to judge');
  await expect(pair.getByTestId('legacy-pair')).toHaveText(
    'All time 380/400 (95%), with answers from before per-hand tracking. The goal counts only answers since.',
  );
  await expect(hard.getByTestId('legacy-hard')).toHaveCount(0);
  const surrender = page.locator('.category-row', { has: page.locator('.category-label', { hasText: 'Surrender' }) });
  await expect(surrender).toContainText("These hands also count toward their hand type's goal above.");
});

test('s10: table-only categories get no in-range line; the note says what the goal figures are', async ({ page }) => {
  await withStats(page, {
    categories: { bet: { right: 4, wrong: 1 }, countCheck: { right: 2, wrong: 2 } },
    latencyHistory: [{ category: 'hard', elapsedMs: 900, date: new Date(Date.now() - DAY).toISOString(), correct: true }],
  });
  await openStats(page);
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  const row = (label: string) =>
    page.locator('.category-row', { has: page.locator('.category-label', { hasText: label }) });
  await expect(row('Hard totals').locator('.category-in-range')).toHaveText('Last 7 days: 1/1 (100%) timed answers');
  await expect(row('Soft totals').locator('.category-in-range')).toHaveCount(0);
  await expect(row('Bet sizing').locator('.category-in-range')).toHaveCount(0);
  await expect(row('Count checks').locator('.category-in-range')).toHaveCount(0);
  await expect(page.locator('.stats-range > .u-note')).toContainText(
    'the last 30 per hand type',
  );
  await expect(page.getByText('the Bet or sit table rows')).toBeVisible();
});

test('s10: a bounded range shows in-range hand accuracy from dated answers', async ({ page }) => {
  const recent = new Date(Date.now() - DAY).toISOString();
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  await withStats(page, {
    latencyHistory: [
      ...Array.from({ length: 4 }, () => ({ category: 'hard', elapsedMs: 900, date: old, correct: false })),
      ...Array.from({ length: 3 }, () => ({ category: 'hard', elapsedMs: 900, date: recent, correct: true })),
      { category: 'hard', elapsedMs: 900, date: recent, correct: false },
    ],
  });
  await openStats(page);
  const hard = page.locator('.category-row[data-hand="hard"]');
  await expect(hard.locator('.category-in-range')).toHaveCount(0);
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(hard.locator('.category-in-range')).toHaveText('Last 7 days: 3/4 (75%) timed answers');
  await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
  await expect(hard.locator('.category-in-range')).toHaveText('Last 30 days: 3/8 (38%) timed answers');
});

test('s06: Bet or sit shows the table decisions, and betting misses are not basic strategy errors', async ({
  page,
}) => {
  await withStats(page, {
    categories: {
      hard: { right: 120, wrong: 1 },
      bet: { right: 43, wrong: 2 },
      wong: { right: 10, wrong: 36 },
    },
    mistakes: { 'basic-error': 39 },
  });
  await openStats(page);
  const bsl = section(page, 'Bet or sit');
  await expect(bsl.getByTestId('bsl-table-bet')).toContainText('43/45');
  await expect(bsl.getByTestId('bsl-table-wong')).toContainText('10/46');
  await expect(bsl).not.toContainText('No bet or sit decisions yet');

  const types = section(page, 'Mistake types');
  await expect(types.locator('.mistake-row', { hasText: 'Basic strategy errors' }).locator('span').last()).toHaveText('1');
  await expect(types.getByTestId('stats-misses-wong').locator('span').last()).toHaveText('36');
  await expect(types.getByTestId('stats-misses-bet').locator('span').last()).toHaveText('2');
});

test('s04/s05: count history shows a trend, its mode, and every run; Produce TC is surfaced', async ({ page }) => {
  const day = (i: number) => new Date(Date.now() - (30 - i) * 60 * 60 * 1000).toISOString();
  await withStats(page, {
    countDrill: {
      history: Array.from({ length: 12 }, (_, i) => ({
        date: day(i),
        cards: 52,
        intervalMs: 700,
        correct: i !== 0,
        ...(i === 11 ? { manual: true, meanTapMs: 600 } : {}),
      })),
    },
    produceTc: {
      history: [
        { date: day(1), produced: -2, correctTc: -3, correct: false },
        { date: day(2), produced: 1, correctTc: 1, correct: true },
      ],
    },
  });
  await openStats(page);
  await statsTab(page, 'Drills');
  const count = section(page, 'Count drill');
  await expect(count.getByTestId('trend-runs')).toContainText('Correct: 11/12 runs');
  await expect(count.getByTestId('trend-runs')).toContainText('Last 10: 10/10');
  await expect(count.locator('.result-dot-wrong')).toHaveCount(1);
  await expect(count.locator('.count-history-row')).toHaveCount(5);
  await expect(count.locator('.count-run-mode').first()).toHaveText('On tap');
  await count.getByRole('button', { name: 'Show all 12 runs' }).click();
  await expect(count.locator('.count-history-row')).toHaveCount(12);

  const produce = section(page, 'Produce TC');
  await expect(produce).toContainText('Correct: 1/2 answers');
  await expect(produce).toContainText('you said −2, it was −3');
});

test('F27: drill empty states print once', async ({ page }) => {
  await openStats(page);
  await statsTab(page, 'Drills');
  await expect(section(page, 'True count drill').getByText('No true count drill attempts yet.')).toHaveCount(1);
  await expect(section(page, 'Deck estimation drill').getByText('No deck estimation attempts yet.')).toHaveCount(1);
  await expect(section(page, 'Timed count challenge').getByText('No timed runs yet.')).toHaveCount(1);
});
