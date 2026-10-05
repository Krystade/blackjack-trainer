import { test, expect, type Page } from '@playwright/test';

/**
 * The microphone probe, on the phone screen it is run from.
 *
 * WHY E2E AND NOT ONLY UNIT TESTS. The classifier is unit-tested, and all of
 * that can be green while this panel is unreachable or mis-wired. What cannot
 * be tested anywhere else is that the spectrum probe actually OPENS A
 * MICROPHONE and returns a verdict. `probeMicSpectrum` resolves with an error
 * object when `getUserMedia` rejects, so a test run without a microphone
 * device would exercise only the rejection path and could not fail for the
 * thing it is named after. The chromium project launches with
 * `--use-fake-device-for-media-stream`, which is a generated tone, so the
 * measuring path runs for real. Nothing is recorded and nothing is heard.
 *
 * The two A/B switches that used to share this section (cue on start or on
 * audio, three or ten readings) are gone -- their defaults are now simply the
 * behaviour -- and so are their tests.
 */
async function openPanel(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).click();
  // No click on the summary: `?e2e=1` force-opens every CollapsibleSection
  // (see e2eForcesOpen), so clicking would CLOSE this one.
  await expect(page.locator('summary', { hasText: 'Which microphone?' })).toBeVisible();
}

test('the spectrum probe opens a microphone and reaches a verdict', async ({ page }) => {
  /*
   * THE ONE THAT MATTERS. Everything else here tests a settings screen; this
   * tests that pressing Test actually measures something. Against the fake
   * device the answer must be "wideband" -- the generated tone is not band
   * limited -- so a 'no-signal' or an error verdict here means the probe
   * never got audio, which is the failure mode that would make it useless in
   * the car while still appearing to work.
   */
  await openPanel(page);
  await page.getByRole('button', { name: 'Test mic', exact: true }).click();

  // Two and a half seconds of listening, plus slack.
  await expect(page.getByText(/not the bottleneck|hands-free microphone/)).toBeVisible({
    timeout: 15_000,
  });

  const text = await page.evaluate(() => document.body.innerText);
  // A bare label would be unauditable after a drive; the ratio is what lets a
  // borderline reading be re-read rather than re-driven.
  expect(text).toMatch(/Energy above 4kHz: \d+\.\d\d%/);
  expect(text).not.toContain('Could not test the microphone');
  expect(text).not.toContain('Nothing was heard at all');

  // Scrolled to the VERDICT, not to the section title: the title is already
  // on screen, so scrolling to it framed a shot with the thing under test
  // below the fold -- a screenshot that cannot show the bug it was taken for.
  const verdict = page.getByText(/not the bottleneck|hands-free microphone/);
  await verdict.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/mic-experiments-probed.png' });
});

test('the probe gives the microphone back', async ({ page }) => {
  /*
   * A probe that leaves the stream open has taken the steering wheel for the
   * rest of the drive -- opening the microphone flips the car to hands-free
   * and every wheel button goes to that "call". So the tracks must be stopped
   * by the time the verdict is on screen, and this asserts it on the tracks
   * themselves rather than trusting the `finally`.
   */
  await openPanel(page);
  await page.evaluate(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await real(c);
      w.__tracks.push(...s.getTracks());
      return s;
    };
  });

  await page.getByRole('button', { name: 'Test mic', exact: true }).click();
  await expect(page.getByText(/not the bottleneck|hands-free microphone/)).toBeVisible({
    timeout: 15_000,
  });

  const live = await page.evaluate(
    () =>
      (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter(
        (t) => t.readyState === 'live',
      ).length,
  );
  expect(live).toBe(0);
});
