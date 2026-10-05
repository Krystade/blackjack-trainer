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

test('the Bluetooth phone-mic kit is listed and walks inputs, probe and finger test', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.locator('.testkit-unanswered > summary').click();
  await expect(page.getByTestId('testkit-open-questions').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('testkit-open-questions')).toContainText('Phone mic with Bluetooth on.');

  await page.getByRole('button', { name: /Bluetooth: phone mic\?/ }).click();
  const kit = page.getByTestId('testkit-screen');
  await expect(page.locator('[data-step="phone-inputs"]')).toBeVisible();

  // 1. inputs
  await kit.getByRole('button', { name: 'List inputs' }).click();
  await expect(page.getByTestId('testkit-inputs')).toContainText('chosen');
  await kit.getByRole('button', { name: 'Next', exact: true }).click();

  // 2. probe on the chosen input (fake device: a tone)
  await expect(page.locator('[data-step="phone-probe"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('testkit-probe-rows')).toContainText('Phone', { timeout: 15_000 });
  await kit.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 20_000 });

  // 3. finger test: two timed windows, then a ratio
  await expect(page.locator('[data-step="phone-finger"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Open the input' }).click();
  await kit.getByRole('button', { name: /Covered: start/ }).click();
  await kit.getByRole('button', { name: /Uncovered: start/ }).click({ timeout: 10_000 });
  await expect(page.getByTestId('testkit-finger-note')).toContainText('of uncovered', { timeout: 10_000 });
  await page.screenshot({ path: 'e2e/screenshots/testkit-phone-finger.png' });
  await kit.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('[data-step="phone-route"]')).toBeVisible();

  // Stop releases every stream and returns to the menu.
  await kit.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.testkit-unanswered')).toBeVisible();
});
