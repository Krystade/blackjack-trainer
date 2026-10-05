import { test, expect, type Page } from '@playwright/test';
import { selectFieldTestCondition, withSettings } from './helpers';
import { FIELD_TEST_STEPS } from '../src/diag/fieldTest';

/**
 * THE VOICE YOU CHOSE IS THE VOICE THAT READS THE INSTRUCTIONS.
 *
 * The measured lines went out with `voiceURI` from settings; the
 * instruction readings did not, so they fell to `pickBestVoice` -- which on
 * an iPhone is whatever the heuristic likes, not what was picked in
 * Settings. The 2026-09-27 drive heard it: "some horrible creepy raspy
 * roboty voice instead." Every utterance this screen makes goes out with
 * the chosen voice, and the seam records which.
 */

type OptsRow = { text: string; voiceURI?: string; volume?: number };

async function optsLog(page: Page): Promise<OptsRow[]> {
  return page.evaluate(
    () => (window as unknown as { __speechOptsLog?: OptsRow[] }).__speechOptsLog ?? [],
  );
}

test('the instruction is read in the chosen voice, like the measured line', async ({ page }) => {
  await withSettings(page, { audio: { voiceURI: 'Samantha' } });
  // Named, not inherited: `FIELD_TEST_STEPS[0]` and the lock walk below are
  // routing steps, and the gate's default leg is the drill one now.
  await selectFieldTestCondition(page, 'Car, parked');
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('settings-testkit-open').click();
  await page.getByTestId('fieldtest-open').click();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();

  const step = FIELD_TEST_STEPS[0]!;
  // The control: the measured line already carried the choice.
  await expect
    .poll(async () => (await optsLog(page)).find((r) => r.text === step.say![0])?.voiceURI, {
      timeout: 8_000,
    })
    .toBe('Samantha');

  await page.getByTestId('fieldtest-read-step').click();
  await expect
    .poll(async () => (await optsLog(page)).find((r) => r.text === step.instruction)?.voiceURI, {
      timeout: 8_000,
    })
    .toBe('Samantha');
});

/**
 * THE OTHER TWO LINES THE OPERATOR HEARS. The pause cue on the gate and the
 * lock verdict were each passed the voice separately, and removing either
 * one failed nothing.
 */
test('the pause cue and the lock verdict are read in the chosen voice too', async ({ page }) => {
  await withSettings(page, { audio: { voiceURI: 'Samantha' } });
  // Named, not inherited: `FIELD_TEST_STEPS[0]` and the lock walk below are
  // routing steps, and the gate's default leg is the drill one now.
  await selectFieldTestCondition(page, 'Car, parked');
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('settings-testkit-open').click();
  await page.getByTestId('fieldtest-open').click();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();

  // Pause past the first step, then come back: the gate says where Resume is.
  await page.getByTestId('fieldtest-skip').click();
  await page.getByTestId('fieldtest-pause').click();
  await page.getByTestId('fieldtest-open').click();
  await expect
    .poll(
      async () =>
        (await optsLog(page)).find((r) => r.text.startsWith('The field test is paused')),
      { timeout: 8_000 },
    )
    // ...and carrying a volume at all: this line had dropped it.
    .toMatchObject({ voiceURI: 'Samantha', volume: expect.any(Number) });

  // Resume, walk to the lock probe, lock and unlock: the verdict is spoken.
  await page.getByTestId('fieldtest-resume').click();
  const title = page.getByTestId('fieldtest-title');
  for (let i = 0; i < FIELD_TEST_STEPS.length + 2; i++) {
    if ((await title.getAttribute('data-step')) === 'lock-probe') break;
    await page.getByTestId('fieldtest-skip').click();
  }
  await expect(title).toHaveAttribute('data-step', 'lock-probe');
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  // Longer than the allowed gap (5 s) plus a tick, or the window is
  // `too-short` and a different line is spoken.
  await page.waitForTimeout(7_500);
  await setVisibility('visible');
  await expect
    .poll(
      async () =>
        (await optsLog(page)).find((r) => r.text.startsWith('The page kept running')),
      { timeout: 8_000 },
    )
    .toMatchObject({ voiceURI: 'Samantha', volume: expect.any(Number) });
});
