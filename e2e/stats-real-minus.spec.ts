import { test, expect } from '@playwright/test';
import { withStats, statsTab } from './helpers';

const MIN = 60_000;
const fatigue = (page: import('@playwright/test').Page) => page.locator('.stats-section', { hasText: 'Fatigue' });

test('Pace drift that speeds up reads with a real minus', async ({ page }) => {
  const base = Date.now() - 86_400_000;
  const row = (i: number, ms: number) => ({ category: 'hard', elapsedMs: ms, date: new Date(base + i * MIN).toISOString() });
  await withStats(page, { latencyHistory: [row(0, 3000), row(1, 3000), row(2, 3000), row(3, 1000), row(4, 1000), row(5, 1000)] });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  await expect(fatigue(page).locator('.mistake-row', { hasText: 'Pace drift' })).toContainText('−2.0s');
});

test('accuracy Drift that falls reads with a real minus', async ({ page }) => {
  const T0 = Date.parse('2026-07-31T10:00:00.000Z');
  const history = Array.from({ length: 8 }, (_, i) => ({ date: new Date(T0 + i * MIN).toISOString(), cards: 20, intervalMs: 800, correct: i < 4 }));
  await withStats(page, { countDrill: { history } });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  const drift = fatigue(page).locator('.mistake-row').filter({ hasText: /^Drift/ });
  await expect(drift).toContainText('−100%');
  await expect(drift).not.toContainText('-100%');
});
