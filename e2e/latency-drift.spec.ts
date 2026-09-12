import { test, expect, type Page } from '@playwright/test';
import { withStats, statsTab } from './helpers';

/**
 * V3-5: dated decision latency.
 *
 * `applyEvents` is pure and has no clock, so the two histories it writes
 * (`latencyHistory`, `evCost.history`) carried no date at all. Two things
 * followed, and both were wrong on a screen that has a range picker at the top
 * of it:
 *
 *   - the range picker silently did not apply to them. "Last 7 days" narrowed
 *     every other figure and left the median decision time and the whole
 *     cost-of-mistakes list at lifetime values, side by side, unlabelled.
 *   - the endurance section could only measure ACCURACY drift, when the first
 *     thing that goes as you tire is PACE.
 *
 * `GradedEvent.at` is stamped by the calling component, which is where the wall
 * clock lives. These prove the two consequences are gone from the rendered
 * screen, not merely from the pure helpers.
 */

const MIN = 60 * 1000;

/** A session of `n` answers starting `daysAgo`, each taking `ms`. */
function session(daysAgo: number, count: number, ms: number, startMin = 0) {
  const base = Date.now() - daysAgo * 24 * 60 * MIN;
  return Array.from({ length: count }, (_, i) => ({
    category: 'hard' as const,
    elapsedMs: ms,
    date: new Date(base + (startMin + i) * MIN).toISOString(),
  }));
}

async function openStats(page: Page, tab: string) {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await statsTab(page, tab);
}

const enduranceSection = (page: Page) =>
  page.locator('.stats-section', { hasText: 'Endurance / fatigue' });

test('a session that stays accurate but slows down is reported as pace drift', async ({ page }) => {
  await withStats(page, {
    // Six answers in one sitting: 1s each early, 3s each late.
    latencyHistory: [...session(1, 3, 1000, 0), ...session(1, 3, 3000, 3)],
  });
  await openStats(page, 'Progress');

  const endurance = enduranceSection(page);
  await expect(endurance.locator('.mistake-row', { hasText: 'Early-session pace' })).toContainText(
    '1.0s',
  );
  await expect(endurance.locator('.mistake-row', { hasText: 'Late-session pace' })).toContainText(
    '3.0s',
  );
  const drift = endurance.locator('.mistake-row', { hasText: 'Pace drift' });
  await expect(drift).toContainText('+2.0s');
  await expect(drift).toContainText('slower late');
  // Tall enough that both blocks of the section are in one frame -- the record
  // of what a driver actually reads, not just that the strings exist.
  await page.setViewportSize({ width: 420, height: 1400 });
  await endurance.screenshot({ path: 'e2e/screenshots/stats-pace-drift.png' });
});

test('holding pace late in a session is not reported as a decrement', async ({ page }) => {
  await withStats(page, { latencyHistory: session(1, 8, 1500) });
  await openStats(page, 'Progress');

  const drift = enduranceSection(page).locator('.mistake-row', { hasText: 'Pace drift' });
  await expect(drift).toContainText('0.0s');
  await expect(drift).toContainText('holds pace');
});

/**
 * The rows that predate V3-5 have no date. They must not be grouped into a
 * session by pretending they happened now -- a lifetime of undated answers
 * would otherwise read as one enormous sitting.
 */
test('undated latency rows produce no pace drift at all', async ({ page }) => {
  await withStats(page, {
    latencyHistory: Array.from({ length: 12 }, (_, i) => ({
      category: 'hard' as const,
      elapsedMs: i < 6 ? 1000 : 5000,
    })),
  });
  await openStats(page, 'Progress');

  const endurance = enduranceSection(page);
  await expect(endurance).toContainText('No dated answer times');
  await expect(endurance.locator('.mistake-row', { hasText: 'Pace drift' })).toHaveCount(0);
});

/**
 * The range picker now reaches the decision-time figure. Before V3-5 this
 * number sat next to a range-filtered accuracy showing lifetime data.
 */
test('the range picker narrows the median decision time, and says what it could not place', async ({
  page,
}) => {
  await withStats(page, {
    latencyHistory: [
      ...session(1, 4, 1000), // inside a 7-day window
      ...session(60, 4, 9000), // outside it
    ],
    evCost: {
      history: [
        {
          category: 'hard',
          taken: 'hit',
          expected: 'stand',
          units: 0.5,
          date: new Date(Date.now() - 24 * 60 * MIN).toISOString(),
        },
        // Undated: written before V3-5, cannot be placed in any bounded range.
        { category: 'hard', taken: 'hit', expected: 'stand', units: 0.5 },
      ],
    },
  });
  await openStats(page, 'Play');

  const hard = page.locator('.category-row', { hasText: 'Hard totals' });
  // All time pools the fast recent answers with the slow old ones.
  await expect(hard.locator('.category-latency')).toContainText('5.0s');

  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(hard.locator('.category-latency')).toContainText('1.0s');
});

test('a bounded range says how many priced mistakes predate dating rather than dropping them silently', async ({
  page,
}) => {
  await withStats(page, {
    evCost: {
      history: [
        {
          category: 'hard',
          taken: 'hit',
          expected: 'stand',
          units: 0.5,
          date: new Date(Date.now() - 24 * 60 * MIN).toISOString(),
        },
        { category: 'soft', taken: 'stand', expected: 'hit', units: 0.25 },
        { category: 'pairs', taken: 'hit', expected: 'split', units: 0.75 },
      ],
    },
  });
  await openStats(page, 'Play');

  const cost = page.locator('.stats-section', { hasText: 'Cost of mistakes' });
  await expect(cost).toBeVisible();
  // All time: every priced mistake is listed and nothing is unplaceable.
  await expect(cost.locator('.mistake-row')).toHaveCount(3);
  await expect(cost).not.toContainText('predate decision dating');

  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  // The LIST narrows, not just the caveat -- this section used to sit at
  // lifetime values next to a range-filtered accuracy on the same screen.
  await expect(cost.locator('.mistake-row')).toHaveCount(1);
  await expect(cost.locator('.mistake-row')).toContainText('hit instead of stand');
  await expect(cost).toContainText('2 priced mistakes predate decision dating');
});

/**
 * The third verdict. Getting FASTER late in a session is a real reading (a warm
 * start, or a drill you settled into), and reporting it as "holds pace" would
 * flatten the only positive thing this analysis can tell you.
 */
test('speeding up late in a session is reported as a negative drift, not as holding pace', async ({
  page,
}) => {
  await withStats(page, {
    latencyHistory: [...session(1, 3, 4000, 0), ...session(1, 3, 1000, 3)],
  });
  await openStats(page, 'Progress');

  const drift = enduranceSection(page).locator('.mistake-row', { hasText: 'Pace drift' });
  await expect(drift).toContainText('-3.0s');
  await expect(drift).toContainText('faster late');
});
