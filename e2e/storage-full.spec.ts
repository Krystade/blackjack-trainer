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
  await expect(page.locator('.home-title')).toBeVisible();
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

test('once dismissed, the toast stays down while the same save keeps failing', async ({ page }) => {
  // Every answer fails the same stats write once storage is full; a toast that
  // came straight back after Dismiss kept the drill's top bar covered.
  await withProfile(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __quotaThrows: number };
    w.__quotaThrows = 0;
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'bjtrainer.stats.v1') {
        w.__quotaThrows += 1;
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return real.call(this, key, value);
    };
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.locator('.action-bar button').first().click();
  const toast = page.getByTestId('storage-toast');
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);

  const throws = () =>
    page.evaluate(() => (window as unknown as { __quotaThrows: number }).__quotaThrows);
  const before = await throws();
  await page.locator('.action-bar button').first().click();
  // The save really failed again, and a frame has rendered since.
  await expect.poll(throws).toBeGreaterThan(before);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
  await expect(toast).toHaveCount(0);
});

test('saves that land show no toast', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  const stored = () => page.evaluate(() => window.localStorage.getItem('bjtrainer.stats.v1'));
  const before = await stored();
  await page.locator('.action-bar button').first().click();
  await expect(page.locator('.message-strip')).toBeVisible();
  // The save itself is the positive: once it has landed and a frame has
  // rendered, a toast it raised would be on screen. Asserting the absence
  // before then would pass on a toast that was merely late.
  await expect.poll(stored).not.toBe(before);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
  expect(await page.getByTestId('storage-toast').count()).toBe(0);
});
