import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * B23: eyes-free, a failed save is SAID at the drill's next pause (a toast
 * cannot be read from the driver's seat), once, and the diagnostic log
 * records it.
 */
test('eyes-free, a save that fails is said at the next pause, once', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.3;
  });
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' }, drill: { wheelMode: 'answer' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  const wheel = page.getByTestId('car-status').locator('[data-part="wheel"]');
  await expect(wheel).toHaveText(/reveal/);
  // Storage is full from here on, for the stats.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'bjtrainer.stats.v1') throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    };
    ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).length = 0;
  });
  const press = () => page.evaluate(() => window.__wheelPress?.('forward') ?? false);
  await press();
  await expect(wheel).toHaveText(/yes/);
  await press(); // "had it": the answer whose save fails
  await expect(page.getByTestId('storage-toast')).toBeVisible();
  await expect(wheel).toHaveText(/reveal/, { timeout: 15_000 });
  const said = () => page.evaluate(() => [...((window as unknown as { __speechLog?: string[] }).__speechLog ?? [])]);
  await expect.poll(async () => (await said()).filter((l) => l.includes('Not saved. The phone storage is full.')).length).toBe(1);
  // A second failed answer is not said again.
  await press();
  await expect(wheel).toHaveText(/yes/);
  await press();
  await expect(wheel).toHaveText(/reveal/, { timeout: 15_000 });
  expect((await said()).filter((l) => l.includes('Not saved. The phone storage is full.'))).toHaveLength(1);
});
