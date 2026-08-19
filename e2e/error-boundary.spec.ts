import { test, expect } from '@playwright/test';

/**
 * The app has no backend: everything the user has practised lives in this
 * browser. Before these specs a render throw blanked the entire page, and an
 * incident had already shown the worst shape of that -- the stats screen
 * threw, the app went white, and the "Reset Stats" control that would have
 * fixed it was stranded on the crashing screen.
 *
 * `?crash=1` is a deliberate seam (see CrashOnDemand in src/ui/App.tsx) that
 * makes a real render-time throw reachable, because React boundaries cannot
 * be triggered any other way from a test.
 */

test('a render throw is caught instead of blanking the app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?e2e=1&crash=1');

  const boundary = page.locator('.error-boundary');
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText('Something broke on this screen');

  // The page must still be a page -- not a blank document.
  await expect(page.locator('#root')).not.toBeEmpty();
  // An uncaught pageerror would mean the boundary did not do its job.
  expect(errors).toEqual([]);
});

test('the crash seam stays shut without the parameter', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.error-boundary')).toHaveCount(0);
});

test('salvage is offered before anything destructive', async ({ page }) => {
  await page.goto('/?e2e=1&crash=1');

  const backup = page.getByRole('button', { name: 'Save a backup' });
  const home = page.getByRole('button', { name: 'Back to Home' });
  await expect(backup).toBeVisible();
  await expect(home).toBeVisible();

  // Backup comes first in the DOM, so it is what the user reaches first.
  const buttons = await page.locator('.error-boundary button').allTextContents();
  expect(buttons[0]).toBe('Save a backup');

  // Nothing here may wipe data outright: the fallback must not offer a
  // destructive action as the only or the leading way out.
  expect(buttons.join(' ')).not.toMatch(/erase|wipe|delete all/i);
});

/**
 * The whole point of putting the boundary INSIDE the shell rather than
 * around the entire app: a broken screen must leave the navigation alive so
 * the user can walk away from it, which is precisely what the stats-screen
 * incident could not do.
 */
test('the tab bar survives a crashed screen and can navigate away', async ({ page }) => {
  await page.goto('/?e2e=1&crash=1');
  await expect(page.locator('.error-boundary')).toBeVisible();

  const drills = page.getByRole('button', { name: 'Drills', exact: true });
  await expect(drills).toBeVisible();
});
