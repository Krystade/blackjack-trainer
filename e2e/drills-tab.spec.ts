import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

/** B1 / Wave B2 #11: Drills is a tab-bar screen, so Home is the tab bar's, not a button of its own. */
test('B2 #11: the Drills picker has no Back to Home button; the tab bar reaches Home', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-picker')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Home' })).toHaveCount(0);
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});
