import { test, expect } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * F24: A FULL localStorage USED TO DROP EVERY ANSWER WITHOUT A SIGN.
 *
 * The stats write is made to throw a QuotaExceededError (as a full phone
 * does), with no diagnostic log to give way. Answering a flashcard must put a
 * "Not saved" toast on screen, and the drill must keep working under it.
 */
test('a save that cannot land shows a toast, and the drill carries on', async ({ page }) => {
  await withProfile(page);
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'bjtrainer.stats.v1') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return real.call(this, key, value);
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('storage-toast')).toHaveCount(0);

  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button').first().click();
  await expect(page.locator('.message-strip')).toBeVisible();

  const toast = page.getByTestId('storage-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Not saved');
  await expect(toast).toHaveAttribute('data-key', 'bjtrainer.stats.v1');

  // Not a modal: the answer bar is still usable.
  await page.locator('.action-bar button').first().click();
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
});

test('saves that land show no toast', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button').first().click();
  await expect(page.locator('.message-strip')).toBeVisible();
  await expect(page.getByTestId('storage-toast')).toHaveCount(0);
});
