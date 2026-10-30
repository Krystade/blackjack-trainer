import { test, expect } from '@playwright/test';
import { withStats } from './helpers';

/**
 * B7: the training data gets the casino log's backup reminder. B25: Settings
 * says whether the phone promised to keep the data.
 */

const practised = { categories: { hard: { right: 60, wrong: 5 } } };

test('Home reminds to back up once there is practice worth keeping, and a download clears it', async ({ page }) => {
  await withStats(page, practised);
  await page.goto('/?e2e=1');
  const nudge = page.getByTestId('backup-nudge');
  await expect(nudge).toContainText('Never backed up');
  const [download] = await Promise.all([page.waitForEvent('download'), nudge.getByRole('button', { name: 'Export now' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^bjtrainer-backup-/);
  await expect(nudge).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.lastBackup.v1'))).not.toBeNull();
  await page.reload();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
});

test('a dismissed share sheet is not a backup: the reminder stays', async ({ page }) => {
  await withStats(page, practised);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('dismissed', 'AbortError');
      },
    });
  });
  await page.goto('/?e2e=1');
  const nudge = page.getByTestId('backup-nudge');
  await nudge.getByRole('button', { name: 'Export now' }).click();
  await expect(nudge).toContainText('not saved');
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.lastBackup.v1'))).toBeNull();
});

test('no reminder on a phone with nothing to lose, or one backed up recently', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);

  await withStats(page, practised);
  await page.addInitScript(() => localStorage.setItem('bjtrainer.lastBackup.v1', new Date(Date.now() - 3 * 86_400_000).toISOString()));
  await page.reload();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
});

test('a Stats export is remembered as the last backup', async ({ page }) => {
  await withStats(page, practised);
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await expect(page.getByTestId('stats-last-backup')).toHaveText('Never backed up');
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup', exact: true }).click()]);
  await expect(page.getByTestId('stats-last-backup')).toHaveText('Last backup today');
});

test('Settings > Offline says whether the phone promised to keep the data', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: async () => false, persist: async () => false, estimate: async () => ({}) },
    });
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('summary', { hasText: 'Offline' }).click();
  await expect(page.getByTestId('storage-persisted')).toHaveText('The phone may clear it: keep a backup');
});
