import { test, expect } from '@playwright/test';
import { withSettings, shot } from './helpers';

/**
 * The global mute button.
 *
 * The requirement is a sentence long and every clause is load-bearing
 * (operator, 2026-09-16): "for mute i want to just be able to use it in public
 * without turning my sound all the way down and being forced to have noise
 * playing". So: reachable from wherever you already are, silent immediately,
 * and it must not cost you the volume you had set -- a mute that eats the
 * level is a mute you use once.
 *
 * `?e2e=1` stubs the audio layer into `window.__speechLog`, which is what
 * makes "is it actually silent" checkable at all: the spec reads the volume
 * each utterance was spoken at rather than trusting the button's own styling.
 */

const MUTE = '[data-testid~="mute-btn"]';

test('there is no mute button until the app has a voice', async ({ page }) => {
  // Audio off is not the same state as muted: nothing can make noise, so a
  // control for silencing noise would be a control that does nothing.
  await page.goto('/?e2e=1');
  await expect(page.locator(MUTE)).toHaveCount(0);
});

test('it is reachable from every screen, including the immersive ones', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await expect(page.locator(MUTE)).toBeVisible();

  // The table stands the tab bar down and owns the whole viewport. A
  // per-screen button would be missing here, which is the case that matters:
  // it is the screen that talks the most.
  await page.getByRole('button', { name: 'Play a shoe' }).click();
  await expect(page.locator(MUTE)).toBeVisible();

  await page.locator('.end-btn').click();
  await page.getByRole('button', { name: 'Drills', exact: true }).first().click();
  await expect(page.locator(MUTE)).toBeVisible();
});

test('it silences speech and keeps the volume you had set', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', volume: 1.4 } });
  await page.goto('/?e2e=1');

  await page.locator(MUTE).click();
  await expect(page.locator('[data-testid~="mute-btn-on"]')).toBeVisible();

  // Silent in fact, not merely in appearance: the stub records the volume
  // every utterance was spoken at. Cleared first so only what was said AFTER
  // the button was pressed is under test.
  await page.evaluate(() => {
    window.__speechOptsLog = [];
  });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Test audio' }).click();
  const volumes = await page.evaluate(() => window.__speechOptsLog ?? []);
  expect(volumes.length).toBeGreaterThan(0); // vacuity guard: something was said
  for (const entry of volumes) expect(entry.volume).toBe(0);

  // And the level is still there, which is the half a volume slider gets wrong.
  await expect(page.getByText('140%').first()).toBeVisible();
  await shot(page, '99-mute');
});

test('unmuting gives the voice back at the level it had', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', volume: 1.4 } });
  await page.goto('/?e2e=1');

  await page.locator(MUTE).click();
  await page.locator(MUTE).click();
  await expect(page.locator('[data-testid~="mute-btn-on"]')).toHaveCount(0);

  await page.evaluate(() => {
    window.__speechOptsLog = [];
  });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Test audio' }).click();
  const volumes = await page.evaluate(() => window.__speechOptsLog ?? []);
  expect(volumes.length).toBeGreaterThan(0);
  expect(volumes.some((e) => e.volume === 1.4)).toBe(true);
});

test('it survives a reload, because a quiet room does not end when the app reloads', async ({
  page,
}) => {
  // Audio is enabled through the real toggle rather than seeded, deliberately:
  // `withSettings` re-writes localStorage on every navigation, so a seeded
  // run would prove the harness persisted, not the app.
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByLabel('Audio enabled').check();

  await page.locator(MUTE).click();
  await expect(page.locator('[data-testid~="mute-btn-on"]')).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-testid~="mute-btn-on"]')).toBeVisible();
});

/**
 * The one that proves the WIRING rather than the function.
 *
 * The drill screens do not speak through `useAudio`; they call `speak()` with
 * a bag built by `speechOptsFrom()`. That split is exactly how the original
 * volume control shipped working everywhere except the eyes-free drills, so
 * mute gets a test on the same path, through a real drill, saying real lines.
 */
test('a drill speaking eyes-free is silent when muted', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results', answerPauseMs: 300, volume: 0.8 },
  });

  await page.goto('/?e2e=1');
  await page.locator(MUTE).click();

  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await page.evaluate(() => {
    window.__speechOptsLog = [];
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 10_000 });

  const spoken = await page.evaluate(() => window.__speechOptsLog ?? []);
  // Vacuity guard: the drill really did run its prompt/pause/answer sequence.
  expect(spoken.some((e) => e.text.startsWith('Running count'))).toBe(true);
  expect(spoken.some((e) => e.text.startsWith('True count'))).toBe(true);
  for (const entry of spoken) expect(entry.volume).toBe(0);
});
