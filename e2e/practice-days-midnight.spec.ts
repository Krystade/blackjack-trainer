import { test, expect, type Page } from '@playwright/test';
import { withStats } from './helpers';

/**
 * H8 (wave H, story 8): "Practised N of the last 7 days" follows the clock
 * while Home stays open. It was computed at render only, so an app left open
 * across local midnight kept yesterday's seven-day window.
 *
 * Practice at 23:30 six days ago and 23:30 today (Los Angeles). At 23:55 both
 * are in the window; at 00:05 the older one has dropped out.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles' });

// PDT is UTC-7 in October: 23:30 local on Oct 12 and Oct 18.
const ROWS = ['2026-10-13T06:30:00.000Z', '2026-10-19T06:30:00.000Z'].map((date) => ({
  date,
  cards: 52,
  intervalMs: 800,
  correct: true,
}));
const BEFORE_MIDNIGHT = new Date('2026-10-19T06:55:00.000Z'); // 23:55 local, Oct 18

const line = (page: Page) => page.getByTestId('practice-days');

test('the line moves on at local midnight with no reload or navigation', async ({ page }) => {
  await withStats(page, { countDrill: { history: ROWS } });
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/?e2e=1');
  await expect(line(page)).toHaveText('Practised 2 of the last 7 days');

  // Timers only: no visibility or focus event, no navigation.
  await page.clock.runFor(10 * 60 * 1000);
  await expect(line(page)).toHaveText('Practised 1 of the last 7 days');
});

test('coming back to the page after midnight re-reads the clock', async ({ page }) => {
  await withStats(page, { countDrill: { history: ROWS } });
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/?e2e=1');
  await expect(line(page)).toHaveText('Practised 2 of the last 7 days');

  // The clock jumps without firing timers, as in a frozen background tab.
  await page.clock.setSystemTime(new Date('2026-10-19T07:05:00.000Z'));
  await page.waitForTimeout(100);
  await expect(line(page)).toHaveText('Practised 2 of the last 7 days');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(line(page)).toHaveText('Practised 1 of the last 7 days');
});
