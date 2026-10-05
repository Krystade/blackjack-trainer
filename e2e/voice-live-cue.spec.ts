import { test, expect, type Page } from '@playwright/test';

/**
 * "The microphone is open now."
 *
 * On the 2026-09-30 drive, `echo-voice-1` took 6033ms to reach `listening`:
 * attempt 1 fired no event at all for the full five-second watchdog while the
 * permission state was still `prompt`, was torn down, and attempt 2 confirmed
 * in 460ms. That is iOS establishing the permission, once per page load, and
 * shortening the watchdog would only tear down a session that might have been
 * about to confirm.
 *
 * The defect underneath it is the one that matters eyes-free: nothing is
 * AUDIBLE when the microphone goes live. The operator flips the toggle and
 * gets silence for six seconds, then silence again -- so the first thing they
 * say goes into a microphone that is not listening yet, and the drill looks
 * broken. `useVoiceControl` already chimes when a word was not understood and
 * had nothing at all for the state that precedes it.
 *
 * ONCE, and that is the half worth testing. The cloud recogniser ends a
 * session roughly every ninety seconds by design and the controller restarts
 * it, so a cue on every arrival at `listening` would be a beep every ninety
 * seconds for the whole drive. It fires on the first one after the microphone
 * is asked for, which is the moment the operator is waiting on.
 */

async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }

      start(): void {
        setTimeout(() => {
          this.onstart?.();
          // Safari fires audiostart right after start; without it the app waits out AUDIOSTART_GRACE_MS.
          this.onaudiostart?.();
        }, 0);
      }

      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

function chimes(page: Page, kind: string): Promise<number> {
  return page.evaluate(
    (k) => (window.__speechLog ?? []).filter((l) => l === `chime:${k}`).length,
    kind,
  );
}

async function openFlashcardsWithVoice(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

test('the microphone going live is audible, once', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  await expect
    .poll(() => chimes(page, 'ready'), { timeout: 5_000 })
    .toBe(1);

  // A session ending and coming back is routine -- the engine does it every
  // ninety seconds or so on its own. Cueing that would put a beep in the
  // middle of the drive every ninety seconds for no event the operator caused.
  await page.evaluate(() => {
    (window as unknown as { __rec?: { onend?: () => void } }).__rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  expect(await chimes(page, 'ready'), 'a routine session restart cued again').toBe(1);
});

/**
 * The cue is its own tone, not a verdict.
 *
 * Reusing `good` would put "the microphone is open" and "that answer was
 * right" on one frequency, in the one mode where sound is the only channel
 * there is. `speech.ts` already keeps five kinds apart for exactly this
 * reason, and asserts no two share a frequency.
 */
test('the live cue is not one of the answer tones', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await expect.poll(() => chimes(page, 'ready'), { timeout: 5_000 }).toBe(1);

  for (const verdict of ['good', 'bad']) {
    expect(await chimes(page, verdict), `the live cue was heard as "${verdict}"`).toBe(0);
  }
});
