import { test, expect, type Page } from '@playwright/test';

/**
 * F2: A DEPLOY FOUND MID-RUN MUST NOT RELOAD THE APP.
 *
 * The update check reloads from a visibility change, and a phone call is one.
 * It used to wait only for a live field-test run, so a deploy landing during a
 * drill or a Play shoe dropped the driver on a silent Home.
 *
 * This drives the real wiring end to end: main.tsx's update watch with its
 * `deferWhile`, App's per-screen hold and the shared flag (ui/activityLive.ts).
 * So it loads plain `/` -- `?e2e=1` switches the watch off -- and the project's
 * --mute-audio keeps the live speech path silent. version.json is stubbed to
 * name a build other than the one running, and the page clock is moved past
 * the watch's 30s interval before each "call".
 *
 * Each case ends with the control: leave the run, take another call, and the
 * reload happens. Without it, "nothing reloaded" would also pass for a check
 * that never ran.
 */

const NEW_BUILD = 'f2-deploy-under-test';

interface Deploy {
  /** null: pass through to the dev server, which names the running build. */
  deployed: string | null;
  fetches: number;
}

async function stubDeploy(page: Page): Promise<Deploy> {
  const deploy: Deploy = { deployed: null, fetches: 0 };
  await page.route('**/version.json*', async (route) => {
    deploy.fetches += 1;
    if (!deploy.deployed) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ buildId: deploy.deployed, builtAt: new Date().toISOString() }),
    });
  });
  return deploy;
}

let skew = 0;

/** Leave the app and come back, long enough after the last check to check again. */
async function takeACall(page: Page, deploy: Deploy): Promise<void> {
  skew += 31_000;
  await page.clock.setSystemTime(Date.now() + skew);
  const before = deploy.fetches;
  await page.evaluate(() => {
    const set = (v: string) =>
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });
  await expect
    .poll(() => deploy.fetches, { message: 'the update check did not run' })
    .toBeGreaterThan(before);
}

/** How many times the watch has logged holding a reload off. */
function deferrals(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.diagnostics.v1');
    const list = raw ? (JSON.parse(raw) as { event?: string }[]) : [];
    return list.filter((e) => e.event === 'update-deferred').length;
  });
}

async function expectDeferred(page: Page, deploy: Deploy, onScreen: () => Promise<void>) {
  const url = page.url();
  const before = await deferrals(page);
  deploy.deployed = NEW_BUILD;
  await takeACall(page, deploy);
  // A positive signal that the check decided to wait (the log is flushed
  // within a second), rather than a fixed sleep and an absence.
  await expect
    .poll(() => deferrals(page), { message: 'the reload was not deferred', timeout: 10_000 })
    .toBeGreaterThan(before);
  expect(page.url(), 'the app navigated mid-run').toBe(url);
  await onScreen();
}

async function expectReloadOnceIdle(page: Page, deploy: Deploy, leave: () => Promise<void>) {
  await leave();
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await takeACall(page, deploy);
  await page.waitForURL(new RegExp(`[?&]v=${NEW_BUILD}`));
}

test.beforeEach(async ({ page }) => {
  skew = 0;
  await page.clock.install();
});

test('mid-drill: a deploy found on the way back from a call waits until the drill is left', async ({
  page,
}) => {
  const deploy = await stubDeploy(page);
  await page.goto('/');
  await expect.poll(() => deploy.fetches, { message: 'no check at start' }).toBeGreaterThan(0);

  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  await expectDeferred(page, deploy, async () => {
    await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  });
  await expectReloadOnceIdle(page, deploy, async () => {
    // The drill's Back goes to the picker, which still holds; Home does not.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  });
});

test('mid-shoe: a deploy found on the way back from a call waits until Play is left', async ({
  page,
}) => {
  const deploy = await stubDeploy(page);
  await page.goto('/');
  await expect.poll(() => deploy.fetches, { message: 'no check at start' }).toBeGreaterThan(0);

  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.topbar-profile-name')).toBeVisible();

  await expectDeferred(page, deploy, async () => {
    await expect(page.locator('.topbar-profile-name')).toBeVisible();
  });
  await expectReloadOnceIdle(page, deploy, async () => {
    // End session asks to confirm, then the report's Back to Home.
    await page.locator('.end-btn').click();
    await page.locator('.end-btn').click();
    await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  });
});
