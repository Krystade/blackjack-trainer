import { test, expect } from '@playwright/test';

/**
 * Wave O (review S2): Play and Stats are lazy chunks. Opening one whose chunk
 * is still on its way must leave the current screen painted and live -- the
 * navigation is a transition under an already-revealed Suspense boundary --
 * never a blank frame with only the tab bar. The chunk is held back here
 * (the dev server serves the screen module itself), so the wait is long
 * enough to sample many frames.
 */

test.use({ viewport: { width: 375, height: 812 } });

const HOLD_MS = 1500;

test('opening Play while its chunk loads keeps Home on screen until the table mounts', async ({ page }) => {
  let held = 0;
  await page.route(/\/src\/ui\/screens\/Table\.tsx(\?.*)?$/, async (route) => {
    held += 1;
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue();
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-title')).toBeVisible();

  // Every animation frame from the tap until the table mounts: something
  // other than the tab bar must be painted in each one.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: { home: boolean; table: boolean }[]; __sampling: boolean };
    w.__frames = [];
    w.__sampling = true;
    const tick = () => {
      if (!w.__sampling) return;
      w.__frames.push({ home: !!document.querySelector('.home-title'), table: !!document.querySelector('.table-screen') });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  // Still loading: Home is up, and still takes input (a wheel press reaches
  // the live screen -- Home has no wheel claim, so it is ignored and logged).
  await page.waitForTimeout(300);
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.locator('.table-screen')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __wheelPress: (c: string) => boolean }).__wheelPress('forward'))).toBe(false);
  await expect(page.locator('.home-title')).toBeVisible();

  await expect(page.locator('.table-screen')).toBeVisible({ timeout: HOLD_MS + 10_000 });
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: { home: boolean; table: boolean }[]; __sampling: boolean };
    w.__sampling = false;
    return w.__frames;
  });
  expect(held, 'the chunk was never held back, so nothing was tested').toBeGreaterThan(0);
  expect(frames.length, 'too few frames sampled to mean anything').toBeGreaterThan(20);
  const blank = frames.filter((f) => !f.home && !f.table).length;
  expect(blank, `${blank} of ${frames.length} frames showed neither Home nor the table`).toBe(0);
});

test('the Play chunk is fetched when idle after the first paint, before any tap', async ({ page }) => {
  const requested: number[] = [];
  page.on('request', (r) => {
    if (/\/src\/ui\/screens\/Table\.tsx(\?.*)?$/.test(new URL(r.url()).pathname + new URL(r.url()).search)) requested.push(Date.now());
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-title')).toBeVisible();
  await expect.poll(() => requested.length, { timeout: 10_000 }).toBeGreaterThan(0);
});
