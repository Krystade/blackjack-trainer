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

test('the speaker check runs six blind plays and reports each path separately', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Speaker check/ }).click();
  const kit = page.getByTestId('testkit-screen');

  // The two never-opened controls, then six blind plays.
  for (let i = 0; i < 8; i++) {
    await kit.getByRole('button', { name: 'Play', exact: true }).click();
    await kit.getByRole('button', { name: 'Loud speaker' }).click();
  }
  const result = page.getByTestId('testkit-blind-result');
  await expect(result).toContainText('Normal playback: 3 of 3 on the loud speaker');
  await expect(result).toContainText('Web Audio: 3 of 3 on the loud speaker');
  await page.screenshot({ path: 'e2e/screenshots/testkit-blind.png' });
});
