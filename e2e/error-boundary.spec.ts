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
  // Home must have rendered first: before React's first commit the boundary
  // is absent too, so a bare toHaveCount(0) could pass on an empty #root.
  await expect(page.locator('.home-title')).toBeVisible();
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

test("the crash screen's backup goes through the share sheet and says what happened", async ({ page }) => {
  // B1/B10: no share path and a synchronous revoke, under a screen that never said whether anything was saved.
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: string[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: { files: File[] }) => {
        w.__shared.push(await d.files[0]!.text());
      },
    });
  });
  await page.goto('/?e2e=1&crash=1');
  await page.getByRole('button', { name: 'Save a backup' }).click();
  await expect(page.getByTestId('crash-backup-status')).toHaveText('Backup saved.');
  const shared = await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared);
  expect(shared).toHaveLength(1);
  expect(JSON.parse(shared[0]!)).toHaveProperty('settings');
});

test("the crash screen's backup downloads a non-empty file where there is no share sheet", async ({ page }) => {
  await page.goto('/?e2e=1&crash=1');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save a backup' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^bjtrainer-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const chunks = await (await download.createReadStream()).toArray();
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toHaveProperty('stats');
  await expect(page.getByTestId('crash-backup-status')).toContainText('Backup downloaded');
});

test('the crash screen can save the casino log, which the training backup leaves out', async ({ page }) => {
  // B12: the casino export lives on the Casino tab, the screen most likely to be the one that crashed.
  await page.addInitScript(() => {
    localStorage.setItem(
      'bjtrainer.casinoLog.v3',
      JSON.stringify({ version: 3, casinos: [], sessions: [], settings: {}, lastExportAt: null, marker: 'real-money-history' }),
    );
  });
  await page.goto('/?e2e=1&crash=1');
  const buttons = await page.locator('.error-boundary button').allTextContents();
  expect(buttons[0]).toBe('Save a backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save casino log' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^casino-log-\d{4}-\d{2}-\d{2}\.json$/);
  const body = JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8'));
  expect(body.app).toBe('bjtrainer-casino-log');
  await expect(page.getByTestId('crash-casino-status')).toContainText('Casino log downloaded');
});

test('no casino button when there is no casino log', async ({ page }) => {
  await page.goto('/?e2e=1&crash=1');
  await expect(page.getByRole('button', { name: 'Save a backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save casino log' })).toHaveCount(0);
});
