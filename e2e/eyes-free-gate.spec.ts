import { test, expect } from '@playwright/test';

/**
 * "The button to turn on audio mode doesn't work."
 *
 * `audio.enabled` ships FALSE, and the drill screens gated 19 controls on it
 * -- including "Eyes-free audio", which is this app's driving mode. So on a
 * cold install the control that turns on the feature was a disabled
 * checkbox: tapping it produced no event at all, and the only cure was a
 * toggle on a different screen, pointed at by one line of dim helper text
 * under the very control that had just ignored the tap.
 *
 * These specs run from the SHIPPED default rather than a seeded state,
 * because the default is the whole bug.
 */

const DRILLS = ['Flashcards', 'Deviation Quiz', 'Count Drill', 'True Count Drill'];

for (const drill of DRILLS) {
  test(`${drill}: eyes-free turns on from a cold default`, async ({ page }) => {
    await page.goto('/?e2e=1');

    // Precondition: audio really is off out of the box. If this ever stops
    // being true the specs below still pass but stop testing the bug.
    const enabled = await page.evaluate(
      () => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}')?.audio?.enabled,
    );
    expect(enabled ?? false).toBe(false);

    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: drill, exact: true }).click();

    const toggle = page.locator('label', { hasText: 'Eyes-free audio' }).locator('input');
    await expect(toggle).toBeVisible();
    // The heart of it: the control must be operable, not disabled.
    await expect(toggle).toBeEnabled();

    await toggle.check();
    await expect(toggle).toBeChecked();
  });
}

test('turning on eyes-free enables audio and persists it', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();

  const stored = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'),
  );
  expect(stored.audio.enabled).toBe(true);
});

/**
 * Promoting a setting on the user's behalf is only defensible if it promotes
 * exactly the one thing. Silently rewriting their volume or voice while
 * doing it would be a worse bug than the one this replaced.
 */
test('enabling audio this way changes nothing else', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'bjtrainer.settings.v1',
      JSON.stringify({ version: 1, audio: { enabled: false, volume: 0.3, rate: 1.7, useClips: true } }),
    );
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();

  const audio = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}').audio,
  );
  expect(audio).toMatchObject({ enabled: true, volume: 0.3, rate: 1.7, useClips: true });
});

/** The "Dim screen" companion follows eyes-free, and must come alive with it. */
test('the dim-screen companion becomes usable once eyes-free is on', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  const dim = page.locator('label', { hasText: 'Dim screen' }).locator('input');
  await expect(dim).toBeDisabled();

  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await expect(dim).toBeEnabled();
});
