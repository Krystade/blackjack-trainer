import { test, expect, type Page } from '@playwright/test';
import { withSettings, readStats, statsTab } from './helpers';

/**
 * V5-2 (docs/BACKLOG.md): hand-drill accuracy is recorded separately for
 * answers given under the shot clock and answers given without it.
 *
 * The aggregation is unit-tested. What only a browser can check is the STAMP:
 * `underShotClock` is optional, so a drill view that never sets it leaves the
 * split permanently empty while every unit test passes, because they construct
 * the flag by hand.
 */

async function openFlashcards(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
}

async function answerSome(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: 'Stand', exact: true }).click();
    await page.locator('.drill-next-btn').click();
  }
}

function split(stats: unknown): { timed: { right: number; wrong: number }; untimed: { right: number; wrong: number } } | undefined {
  return (stats as { shotClockSplit?: { timed: { right: number; wrong: number }; untimed: { right: number; wrong: number } } } | null)
    ?.shotClockSplit;
}

test('with no shot clock, answers land in the untimed bucket', async ({ page }) => {
  await withSettings(page, { drill: { shotClockMs: 0 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await answerSome(page, 4);

  const s = split(await readStats(page));
  expect(s, 'nothing recorded: the view never stamped the flag').toBeDefined();
  expect(s!.untimed.right + s!.untimed.wrong).toBe(4);
  expect(s!.timed.right + s!.timed.wrong).toBe(0);
});

test('with a shot clock running, answers land in the timed bucket instead', async ({ page }) => {
  // Long enough that the deadline never actually fires -- the point is that a
  // clock was RUNNING, not that it expired. A test that let it time out would
  // be measuring the timeout path instead.
  await withSettings(page, { drill: { shotClockMs: 60_000 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await answerSome(page, 4);

  const s = split(await readStats(page));
  expect(s).toBeDefined();
  expect(s!.timed.right + s!.timed.wrong).toBe(4);
  expect(s!.untimed.right + s!.untimed.wrong).toBe(0);
});

test('the Stats section stays quiet until both buckets have answers', async ({ page }) => {
  // One bucket alone says nothing about the gap, and a "100%" off two cards
  // would invite exactly the wrong conclusion.
  await withSettings(page, { drill: { shotClockMs: 0 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await answerSome(page, 3);

  // Straight back to Home rather than walking the back buttons: the stats
  // blob is what is under test and it persists across a reload.
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Drills');

  const section = page.locator('.stats-section', { hasText: 'Clock vs no clock' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('Answer some hand drills both with the shot clock on');
  await expect(section.locator('.category-row')).toHaveCount(0);
});

test('once both buckets have answers the comparison renders', async ({ page }) => {
  await withSettings(page, { drill: { shotClockMs: 0 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await answerSome(page, 3);

  // Switch the clock on mid-session by reloading with it set; the stats blob
  // persists, so the second batch lands in the other bucket.
  await withSettings(page, { drill: { shotClockMs: 60_000 } });
  await page.reload();
  await openFlashcards(page);
  await answerSome(page, 3);

  // Straight back to Home rather than walking the back buttons: the stats
  // blob is what is under test and it persists across a reload.
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Drills');

  const section = page.locator('.stats-section', { hasText: 'Clock vs no clock' });
  await expect(section.locator('.category-row')).toHaveCount(2);
  await expect(section).toContainText('Under the clock');
  await expect(section).toContainText('No clock');
});
