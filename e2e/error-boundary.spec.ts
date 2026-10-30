import { test, expect, type Page } from '@playwright/test';
import { readStoredDiagnostics, withSettings, withProfile, openCountOptions } from './helpers';

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

/**
 * D1: THE CRASH REACHES THE DIAGNOSTIC LOG. Before, componentDidCatch wrote
 * only to the console, so a drill that died mid-drive left no `err` line in
 * the log exported afterwards. The root's onCaughtError writes one, with the
 * message and the component stack, and flushes it to storage at once.
 */
test('a caught render throw is written to the diagnostic log', async ({ page }) => {
  await page.goto('/?e2e=1&crash=1');
  await expect(page.locator('.error-boundary')).toBeVisible();
  // No flush helper here on purpose: the crash path flushes synchronously.
  const raw = await readStoredDiagnostics(page);
  const entries = JSON.parse(raw ?? '[]') as {
    category: string;
    event: string;
    detail?: Record<string, unknown>;
  }[];
  const crash = entries.find((e) => e.category === 'err' && e.event === 'render-crash');
  expect(crash, 'no render-crash line in the stored log').toBeTruthy();
  expect(crash!.detail?.kind).toBe('caught');
  expect(String(crash!.detail?.message)).toContain('Deliberate crash');
  expect(String(crash!.detail?.componentStack)).toContain('CrashOnDemand');
});

/**
 * D1b: AN EYES-FREE SCREEN THAT CRASHES SAYS SO. The drill's cleanups stop
 * speech on the way out and the fallback is silent, so eyes-free -- nobody
 * looking -- a crash read exactly like the app going quiet. The boundary now
 * speaks one recorded line, and the whole fallback is the tap target that
 * line promises. The throw comes from inside a RUNNING eyes-free count drill
 * (window.__bjCrashScreen, an e2e-only seam in App.tsx).
 */
const CRASH_LINE = 'Something went wrong. Tap the screen to get back to Home.';

async function startCountDrill(page: Page, eyesFree: boolean): Promise<void> {
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { countLengthCards: 52, countIntervalMs: 800, countGroup: 1, countManual: false },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
  if (eyesFree) await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Precondition: the run is under way -- cards are being spoken.
  await expect.poll(() => page.evaluate(() => (window.__speechLog ?? []).length)).toBeGreaterThan(1);
}

async function crashLines(page: Page) {
  return page.evaluate((line) => (window.__speechOptsLog ?? []).filter((s) => s.text === line), CRASH_LINE);
}

test('D1b: an eyes-free drill that crashes says so once, and a tap anywhere goes Home', async ({ page }) => {
  await startCountDrill(page, true);
  await page.evaluate(() => window.__bjCrashScreen!());

  const boundary = page.locator('.error-boundary');
  await expect(boundary).toBeVisible();
  await expect.poll(() => crashLines(page)).toHaveLength(1);
  expect((await crashLines(page))[0].interrupt, 'the line queued behind the drill').toBe(true);
  // Once: nothing else asks for it again.
  await page.waitForTimeout(500);
  expect(await crashLines(page)).toHaveLength(1);

  // "Tap the screen": a blank spot of the fallback, not one of its buttons.
  const box = (await boundary.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 8);
  await expect(boundary).toHaveCount(0);
  await expect(page.locator('.home-title')).toBeVisible();
});

test('D1b: a crash with eyes-free off stays silent, and the fallback is not a tap target', async ({ page }) => {
  await startCountDrill(page, false);
  await page.evaluate(() => window.__bjCrashScreen!());

  const boundary = page.locator('.error-boundary');
  await expect(boundary).toBeVisible();
  await page.waitForTimeout(500);
  expect(await crashLines(page)).toHaveLength(0);
  const box = (await boundary.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 8);
  await expect(boundary).toBeVisible();
});

test('D1b: the controls still do their own thing after an eyes-free crash', async ({ page }) => {
  await startCountDrill(page, true);
  await page.evaluate(() => window.__bjCrashScreen!());
  await expect(page.locator('.error-boundary')).toBeVisible();
  // Opening the details is not a tap "on the screen".
  await page.locator('.error-boundary summary').click();
  await expect(page.locator('.error-boundary')).toBeVisible();
  await expect(page.locator('.error-boundary pre')).toContainText('Deliberate crash');
});

/** Review R5: the crash hook is installed under exactly the speech harness's check, `e2e=1`. */
test('D1b: the crash hook is absent without e2e=1', async ({ page }) => {
  for (const url of ['/?e2e=0', '/?e2e', '/']) {
    await page.goto(url);
    await expect(page.locator('.home-title')).toBeVisible();
    expect(await page.evaluate(() => typeof window.__bjCrashScreen), url).toBe('undefined');
  }
  await page.goto('/?e2e=1');
  await expect(page.locator('.home-title')).toBeVisible();
  expect(await page.evaluate(() => typeof window.__bjCrashScreen)).toBe('function');
});
