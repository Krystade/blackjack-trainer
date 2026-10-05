import { test, expect, type Page } from '@playwright/test';

/**
 * The three microphone experiments, on the phone screen they are set from.
 *
 * WHY E2E AND NOT ONLY UNIT TESTS. The gate, the classifier and the settings
 * are all unit-tested, and all of that can be green while this panel is
 * unreachable, mis-wired, or three screens tall on a 375px phone in a car
 * park. Two things here cannot be tested anywhere else:
 *
 *   1. That the spectrum probe actually OPENS A MICROPHONE and returns a
 *      verdict. `probeMicSpectrum` resolves with an error object when
 *      `getUserMedia` rejects, so a test run without a microphone device
 *      would exercise only the rejection path and could not fail for the
 *      thing it is named after. The chromium project launches with
 *      `--use-fake-device-for-media-stream`, which is a generated tone, so
 *      the measuring path runs for real. Nothing is recorded and nothing is
 *      heard.
 *   2. That choosing an arm sticks, because the whole point is separating the
 *      arms across drives.
 */
/**
 * The buttons of one setting row, found by that row's label.
 *
 * Scoped rather than page-wide because this screen carries several segmented
 * controls and the labels collide -- "Test" appears on another one, and "3"
 * is a plausible option anywhere. A page-wide locator here matched two
 * elements and failed in strict mode, which is the good version of the
 * failure: the silent version picks the wrong control and passes.
 */
function row(page: Page, label: string) {
  return page.locator('.settings-row', { has: page.getByText(label, { exact: true }) });
}

/**
 * Which option of a segmented control is selected.
 *
 * Read from the class, because `Segmented` marks the active option with
 * `segmented-btn-active` and sets no `aria-pressed` -- so there is no
 * accessible state to assert on. Noted rather than fixed here: that component
 * backs around twenty controls across the app and changing it is not this
 * change's business.
 */
async function selected(page: Page, label: string): Promise<string | null> {
  return row(page, label).locator('.segmented-btn-active').first().textContent();
}

async function openPanel(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).click();
  // No click on the summary: `?e2e=1` force-opens every CollapsibleSection
  // (see e2eForcesOpen), so clicking would CLOSE this one.
  await expect(page.getByText('Microphone experiments')).toBeVisible();
}

function storedAudio(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.settings.v1');
    const parsed = raw ? (JSON.parse(raw) as { audio?: Record<string, unknown> }) : null;
    return parsed?.audio ?? {};
  });
}

test('ships gated on real audio, and says why', async ({ page }) => {
  await openPanel(page);

  // The shipped default is the fix, not the control arm.
  expect(await selected(page, 'Cue when the mic is')).toBe('Recording');
  expect(await selected(page, 'Readings per answer')).toBe('10');

  const text = await page.evaluate(() => document.body.innerText);
  // The explanation has to carry the mechanism, because the setting is
  // meaningless without it and he reads this in a car park.
  expect(text).toContain('before the microphone is recording');

  await page.getByText('Microphone experiments').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/mic-experiments.png' });
});

test('switching to the control arm sticks', async ({ page }) => {
  await openPanel(page);
  const cue = row(page, 'Cue when the mic is');
  await cue.getByText('Started', { exact: true }).click();

  await expect.poll(() => storedAudio(page).then((a) => a.micCueOn)).toBe('start');

  // And back, so a drive can be re-armed without a reinstall.
  await cue.getByText('Recording', { exact: true }).click();
  await expect.poll(() => storedAudio(page).then((a) => a.micCueOn)).toBe('audiostart');
});

test('asking for ten readings sticks', async ({ page }) => {
  await openPanel(page);
  /*
   * NOT asserted against storage before a change. A fresh install has
   * written nothing, so the stored value is `undefined` and the default
   * lives only in `DEFAULT_AUDIO` -- which `mergeSettings` spreads under
   * whatever was stored. The shipped default is asserted in the unit suite
   * and, on screen, in the first test here; what this one owns is the round
   * trip, because an arm that will not come back is an arm he can only use
   * once.
   */
  const readings = row(page, 'Readings per answer');
  await readings.getByText('3', { exact: true }).click();
  await expect.poll(() => storedAudio(page).then((a) => a.voiceAlternatives)).toBe(3);

  await readings.getByText('10', { exact: true }).click();
  await expect.poll(() => storedAudio(page).then((a) => a.voiceAlternatives)).toBe(10);
});

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
