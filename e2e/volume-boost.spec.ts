import { test, expect } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The volume slider now runs to 200%, but "louder" is not one mechanism.
 * Measured platform behaviour:
 *
 *   HTMLMediaElement.volume = 2       -> throws IndexSizeError
 *   SpeechSynthesisUtterance.volume=2 -> silently clamps to 1
 *   GainNode.gain.value = 4           -> accepted
 *
 * So above unity only a GainNode works, and it reaches only the recorded
 * clips. These specs pin the user-visible half of that.
 */

async function openAudioSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test('the slider goes past 100%', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 2 } });
  await openAudioSettings(page);

  const row = page.locator('.settings-row', { hasText: 'Volume' }).first();
  await expect(row).toContainText('200%');

  // And the control still refuses to go further.
  const inc = row.getByRole('button', { name: '+' });
  await expect(inc).toBeDisabled();
});

test('a boost with live speech explains that it will not apply', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 1.5, useClips: false } });
  await openAudioSettings(page);

  await expect(page.locator('.settings-section', { hasText: 'Audio' })).toContainText(
    'Live speech is capped at 100%',
  );
});

test('the explanation disappears once the recorded voice is on', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 1.5, useClips: true } });
  await openAudioSettings(page);

  await expect(page.locator('.settings-section', { hasText: 'Audio' })).not.toContainText(
    'Live speech is capped at 100%',
  );
});

test('no explanation at or below 100%, where nothing is being promised', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, volume: 1, useClips: false } });
  await openAudioSettings(page);

  await expect(page.locator('.settings-section', { hasText: 'Audio' })).not.toContainText(
    'Live speech is capped at 100%',
  );
});

/**
 * The regression that would be silent and severe: an element volume above 1
 * throws, and the throw would take out the whole utterance rather than just
 * the loudness. Drive a real boosted drill and assert nothing threw.
 */
test('a boosted volume never throws into playback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await withSettings(page, { audio: { enabled: true, volume: 2, useClips: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.waitForTimeout(600);

  expect(errors.filter((e) => /IndexSize|volume/i.test(e))).toEqual([]);
  expect(errors).toEqual([]);
});
