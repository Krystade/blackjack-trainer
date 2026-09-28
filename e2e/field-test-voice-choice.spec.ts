import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';
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

type OptsRow = { text: string; voiceURI?: string };

async function optsLog(page: Page): Promise<OptsRow[]> {
  return page.evaluate(
    () => (window as unknown as { __speechOptsLog?: OptsRow[] }).__speechOptsLog ?? [],
  );
}

test('the instruction is read in the chosen voice, like the measured line', async ({ page }) => {
  await withSettings(page, { audio: { voiceURI: 'Samantha' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
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
