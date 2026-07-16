import { test, expect } from '@playwright/test';
import { shot, withSettings, playRoundByAdvice } from './helpers';

test('a changed setting persists across reload', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
  await shot(page, '21-settings-default');

  const betSpreadToggle = page.locator('.settings-toggle-row', { hasText: 'Bet spread on' }).locator('input.settings-toggle');
  await expect(betSpreadToggle).not.toBeChecked();
  await betSpreadToggle.click();
  await expect(betSpreadToggle).toBeChecked();
  await shot(page, '22-settings-changed');

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const betSpreadToggleAfterReload = page
    .locator('.settings-toggle-row', { hasText: 'Bet spread on' })
    .locator('input.settings-toggle');
  await expect(betSpreadToggleAfterReload).toBeChecked();
  await shot(page, '23-settings-persisted-after-reload');
});

test('a short session shows up on the stats screen', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await playRoundByAdvice(page);
  await page.locator('.end-btn').click();
  await expect(page.locator('.home-title')).toBeVisible();

  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await expect(page.locator('.session-row')).not.toHaveCount(0);
  await shot(page, '24-stats-with-session');
});

test('export downloads bjtrainer-export.json', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('bjtrainer-export.json');
});

test('importing garbage shows an error and leaves the app navigable', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();

  page.once('dialog', (dialog) => dialog.accept());
  const fileInput = page.locator('input.stats-file-input');
  await fileInput.setInputFiles({
    name: 'garbage.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid json {{{'),
  });

  await expect(page.locator('.stats-message')).toContainText('Import failed');
  await shot(page, '25-stats-import-error');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
});
