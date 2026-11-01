import { test, expect } from '@playwright/test';
import { openSettingsScreen, withSettings } from './helpers';

/**
 * The volume slider runs to 200%, and above 100% it no longer touches either
 * voice. Measured platform behaviour:
 *
 *   HTMLMediaElement.volume = 2       -> throws IndexSizeError
 *   SpeechSynthesisUtterance.volume=2 -> silently clamps to 1
 *   GainNode.gain.value = 4           -> accepted
 *
 * So above unity only a GainNode works. It used to carry the recorded clips,
 * and on Jack's phone on 2026-10-02 that wrecked them: a 3029ms prompt ran
 * 4455ms at 200% and 7687ms at 150%, choppy and then silent. The route is gone
 * (audio/volume.ts holds the readings), and what the headroom still reaches is
 * the CHIMES -- a bare oscillator already inside the graph, nothing to
 * resample. So the slider above 100% raises the alert tones and nothing else,
 * and the one thing these specs really guard is that THE SCREEN SAYS SO.
 *
 * A caveat that lies is worse than no caveat: it sent Jack up to 200% looking
 * for a louder voice and got him a silent one.
 *
 * The control and its caveat live under "General" (#35, 4fa1fb8). NAMED
 * HERE rather than left to a page-wide search -- one of these asserts that
 * the caveat is ABSENT, and a selector pointed at the wrong section passes it
 * without reading anything.
 *
 * No seed here sets `useClips`: the recorded voice is no longer a choice and
 * mergeSettings forces it on at every load (store/persist.ts), so a seeded
 * `useClips: false` never reached the screen and only looked like a second case.
 */

const GENERAL = 'General';
const CAVEAT = 'Above 100% raises the alert tones only';

function section(page: import('@playwright/test').Page, title: string) {
  return page
    .locator('.settings-section')
    .filter({ has: page.locator('summary', { hasText: title }) });
}

async function openAudioSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?e2e=1');
  await openSettingsScreen(page);
}

test('the slider goes past 100%', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 2 } });
  await openAudioSettings(page);

  const row = page.locator('.settings-row', { hasText: 'Volume' }).first();
  await expect(row).toContainText('200%');

  // And the control still refuses to go further. 200% is where a chime reaches
  // full scale (`chimePeak` is 0.5 at unity), so past it there is nothing left
  // to gain -- which is the answer to "is 2x a hard cap".
  const inc = row.getByRole('button', { name: '+' });
  await expect(inc).toBeDisabled();
});

test('a boost says that it reaches the tones and not the voice', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 1.5 } });
  await openAudioSettings(page);

  // The caveat depends on the volume alone (Settings.tsx: volume > 1). It
  // used to be hidden once the recorded voice was on, because that was the
  // voice the GainNode reached -- Jack's case. Nothing is routed now, so the
  // recorded voice is capped at 100% like the live one, and a screen that
  // goes quiet here promises a boost that does not exist.
  await expect(section(page, GENERAL)).toContainText(CAVEAT);
});

test('no caveat at or below 100%, where nothing is being promised', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 1 } });
  await openAudioSettings(page);

  await expect(section(page, GENERAL)).toContainText('Volume');
  await expect(section(page, GENERAL)).not.toContainText(CAVEAT);
});

/**
 * The regression that would be silent and severe: an element volume above 1
 * throws, and the throw would take out the whole utterance rather than just
 * the loudness. Drive a real boosted drill and assert nothing threw.
 */
test('a boosted volume never throws into playback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await withSettings(page, { audio: { enabled: true, volume: 2 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.waitForTimeout(600);

  expect(errors.filter((e) => /IndexSize|volume/i.test(e))).toEqual([]);
  expect(errors).toEqual([]);
});
