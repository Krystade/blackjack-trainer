import { test, expect, type Page } from '@playwright/test';

/**
 * H8 (wave H, story 8), carried over to the Wave N streak card: Home follows
 * the clock while it stays open. The "Practised N of the last 7 days" line
 * this spec was written for is gone (the card's week dots replace it); the
 * rule it pinned -- re-render at local midnight and on return -- now holds
 * for the card's "today".
 *
 * Los Angeles. Today (Oct 18) has its goal met; at 23:55 the card says so, and
 * once the local day turns, today is a fresh day at 0 minutes.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles' });

const BEFORE_MIDNIGHT = new Date('2026-10-19T06:55:00.000Z'); // 23:55 local, Oct 18

async function withMetToday(page: Page): Promise<void> {
  const blob = JSON.stringify({
    version: 1,
    days: { '2026-10-18': { answers: 60, activeMs: 0, met: true } },
    answersTotal: 60,
    drive: { totalMs: 0, runMs: 0, bestRunMs: 0 },
    earned: {},
    backfilled: true,
  });
  await page.addInitScript((json) => window.localStorage.setItem('bjtrainer.progress.v1', json), blob);
}

const today = (page: Page) => page.getByTestId('streak-today');

test('the card moves on at local midnight with no reload or navigation', async ({ page }) => {
  await withMetToday(page);
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/?e2e=1');
  await expect(today(page)).toHaveText('Goal met');

  // Timers only: no visibility or focus event, no navigation.
  await page.clock.runFor(10 * 60 * 1000);
  await expect(today(page)).toContainText('0/10 min');
  await expect(page.getByTestId('streak-count')).toHaveText('1');
});

test('coming back to the page after midnight re-reads the clock', async ({ page }) => {
  await withMetToday(page);
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/?e2e=1');
  await expect(today(page)).toHaveText('Goal met');

  // The clock jumps without firing timers, as in a frozen background tab.
  await page.clock.setSystemTime(new Date('2026-10-19T07:05:00.000Z'));
  await page.waitForTimeout(100);
  await expect(today(page)).toHaveText('Goal met');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(today(page)).toContainText('0/10 min');
});
