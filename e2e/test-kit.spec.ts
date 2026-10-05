import { test, expect } from '@playwright/test';

test('the test kit opens from Home and walks into the first desk step', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await expect(page.getByTestId('testkit-screen')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/testkit-menu.png' });

  await page.getByRole('button', { name: /At my desk/ }).click();
  await expect(page.locator('[data-step="desk-baseline-element"]')).toBeVisible();
  await page.getByTestId('testkit-screen').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loud speaker' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/testkit-route.png' });

  await page.getByRole('button', { name: 'Loud speaker' }).click();
  await expect(page.locator('[data-step="desk-baseline-webaudio"]')).toBeVisible();
});
