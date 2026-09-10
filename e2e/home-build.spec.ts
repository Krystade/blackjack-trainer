import { test, expect } from '@playwright/test';

/**
 * The build stamp on Home.
 *
 * The app runs installed on an iPhone home screen, where iOS can serve a
 * cached document and keep it on an old bundle indefinitely. updateCheck.ts
 * exists to prevent that, but nothing about it is visible -- so the id is on
 * screen, and a deploy either changes it or the update never landed.
 */

test('Home shows the build it is actually running', async ({ page }) => {
  await page.goto('/?e2e=1');

  const build = page.locator('.home-build');
  await expect(build).toBeVisible();

  // A stamp, not an empty label: the attribute carries the raw id, and it
  // has to be non-empty or the line is decoration.
  const id = await build.getAttribute('data-build');
  expect(id).toBeTruthy();
  await expect(build).toContainText(id!);
});

/**
 * It must be the SAME string version.json carries, because comparing the two
 * is the entire point -- a line that cannot be compared proves nothing.
 */
test('the shown build matches the one served beside the app', async ({ page }) => {
  await page.goto('/?e2e=1');
  const shown = await page.locator('.home-build').getAttribute('data-build');

  const served = await page.evaluate(async () => {
    const res = await fetch('version.json', { cache: 'no-store' });
    return ((await res.json()) as { buildId?: string }).buildId ?? null;
  });

  expect(served).toBeTruthy();
  expect(shown).toBe(served);
});

test('it stays out of the way of the primary action', async ({ page }) => {
  await page.goto('/?e2e=1');

  const play = await page.getByRole('button', { name: 'Play a shoe' }).boundingBox();
  const build = await page.locator('.home-build').boundingBox();

  // Below the play button, never competing with it.
  expect(build!.y).toBeGreaterThan(play!.y + play!.height);
});
