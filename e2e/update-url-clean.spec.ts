import { test, expect } from '@playwright/test';

/**
 * R5 (lane B review): an update reload lands on `?v=<build>`, and the worker
 * gives a `?v=` navigation up to 15s for the network (B8). Left in the URL,
 * every later reload in that session -- the crash screen's Reload, iOS
 * restoring a discarded page -- waited that long again on weak signal for a
 * document it already had. The app drops it once loaded, keeping the rest.
 */
test('the update stamp is dropped from the address once the app has loaded', async ({ page }) => {
  await page.goto('/?e2e=1&v=B2');
  await expect(page.locator('.home-stats-link')).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.has('v')).toBe(false);
  expect(url.searchParams.get('e2e')).toBe('1');
});
