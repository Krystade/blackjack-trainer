import { test, expect, type Page } from '@playwright/test';

/**
 * The audio unlock, in a real browser.
 *
 * The unit tests (src/audio/unlock.test.ts) model the iOS activation gate with
 * a fake. What they cannot show is that the listener is actually WIRED INTO
 * the running app -- that a tap on whatever the operator happens to touch
 * first reaches it. A module that is perfect and never installed looks exactly
 * the same from inside its own tests.
 *
 * Why it matters: `AudioContext.resume()` and the first `play()` on an element
 * are both honoured only inside a user activation, and nothing in the drill
 * runs inside one -- clips play off timers and recogniser callbacks. Without
 * this, `amplify()` found a suspended graph and refused to route (so the
 * Volume setting did nothing above 100%) and every amplified line met the gate
 * on a fresh element (`NotAllowedError`, then live TTS, which is capped at
 * 1.0). Jack asked for more volume off Bluetooth on 2026-10-02; turning it up
 * would have made the car quieter until this existed.
 */

const KEY = 'bjtrainer.diagnostics.v1';

async function unlockEntries(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return entries.filter((e) => e.event === 'audio-unlock');
  } catch {
    return [];
  }
}

test('nothing claims an unlock before the operator has touched anything', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.getByRole('button', { name: 'Settings', exact: true }).first()).toBeVisible();

  // The page has loaded and React has mounted -- the listener is installed and
  // waiting. An unlock recorded here would mean the app believed it had a user
  // activation it never had, which is the bug in the other direction: it would
  // consume the one-shot on nothing and leave the real tap unserved.
  expect(await unlockEntries(page)).toHaveLength(0);
});

test('the first tap anywhere unlocks the audio', async ({ page }) => {
  await page.goto('/?e2e=1');
  const settings = page.getByRole('button', { name: 'Settings', exact: true }).first();
  await expect(settings).toBeVisible();

  await settings.click();

  // The log flushes on a 1s buffer, so poll rather than race it.
  await expect
    .poll(async () => (await unlockEntries(page)).length, { timeout: 6000 })
    .toBe(1);
});

test('it runs once, not on every tap for the rest of the drive', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect
    .poll(async () => (await unlockEntries(page)).length, { timeout: 6000 })
    .toBe(1);

  // Priming builds elements and plays silence on them. Re-running it on every
  // tap would leave a drive's worth of audio elements behind for nothing.
  await page.getByRole('button', { name: 'Back to Home' }).first().click();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.waitForTimeout(1500);

  expect(await unlockEntries(page)).toHaveLength(1);
});

test('the unlock says what state it found the graph in', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect
    .poll(async () => (await unlockEntries(page)).length, { timeout: 6000 })
    .toBe(1);

  // The detail is the whole point of logging it: on a phone this is the line
  // that says whether the graph was suspended when the gesture arrived, which
  // is the difference between "the boost is off" and "the boost is broken".
  const [entry] = await unlockEntries(page);
  const detail = entry!.detail as Record<string, unknown>;
  expect(detail.reason).toBe('gesture');
  expect(typeof detail.state).toBe('string');
  expect(detail.state).not.toBe('');
});
