import { test, expect } from '@playwright/test';

// A drill opened from low in the picker used to keep the picker's scroll
// offset, so the Custom editor opened mid-grid with its header off screen.
test('a drill opened from a scrolled picker starts at the top', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  // Owner 2026-11-06: Custom moved up the menu; Side count is now last.
  const custom = page.getByRole('button', { name: /^Side count/ }).first();
  await custom.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await custom.click();
  await expect(page.locator('.drills-picker')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
