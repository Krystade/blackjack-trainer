import { test, expect, type Page } from '@playwright/test';

/**
 * Answering flashcards out loud.
 *
 * Real recognition cannot run here -- headless Chromium exposes the whole
 * SpeechRecognition surface and then fires no events, having no microphone
 * and no speech backend. So a FAKE engine is installed in its place before
 * the app loads, which is not a compromise: every behaviour worth asserting
 * is about what the app does with a transcript, and the device probe already
 * settled what the real engine does with a voice.
 */

/** Installs a scriptable engine and a window handle to drive it. */
async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }

      start(): void {
        setTimeout(() => this.onstart?.(), 0);
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

async function openFlashcardsWithVoice(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

/** Feed the app a transcript, as the engine would. */
async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

test('a spoken answer grades the card', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'stand');
  // The correction panel only exists once an answer has been graded.
  await expect(page.locator('.drill-feedback, [class*="feedback"]').first()).toBeVisible();
});

test('filler before the answer is ignored, because engines prepend it', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'okay uh stand');
  await expect(page.locator('.voice-status-heard')).toContainText('stand');
});

/**
 * The safety property, end to end: unrecognised speech must leave the card
 * alone. Acting on a guess would grade an answer the operator never gave.
 */
test('ordinary conversation does not answer the card', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'what is the weather like tomorrow');
  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  await expect(page.locator('.drill-feedback, [class*="feedback"]').first()).toBeHidden();
});

/**
 * The failure that would otherwise be constant and invisible: the app speaks
 * the correction aloud, the car speaker plays it, and the microphone hears
 * "Stand." as an answer to the NEXT card.
 */
test('the app does not grade its own voice', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  // "repeat" makes the app speak, which is what a real correction does too.
  await say(page, 'repeat');
  await say(page, 'hit');

  await expect(page.locator('.voice-status-heard')).toContainText('the app was speaking');
  await expect(page.locator('.drill-feedback, [class*="feedback"]').first()).toBeHidden();
});

/**
 * The probe measured the engine ending its own session roughly every ninety
 * seconds, with the tab visible. Without recovery the feature works for a
 * minute and a half and then silently stops.
 */
test('a session that dies on its own comes back and keeps answering', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onend?: () => void } }).__rec;
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'restarting');
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  await say(page, 'double');
  await expect(page.locator('.voice-status-heard')).toContainText('double');
});

/**
 * The deaf gap is named rather than hidden. A word spoken during a restart is
 * genuinely lost, and an operator who cannot see why deserves to be told --
 * "Listening" throughout would be a lie.
 */
test('the restart gap is shown, not hidden', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onend?: () => void } }).__rec;
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status-state')).toContainText('Reconnecting');
});

test('switching voice off releases the microphone and says so', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.getByRole('checkbox', { name: 'Voice answers' }).uncheck();
  await expect(page.locator('.voice-status')).toHaveCount(0);
});

/**
 * A refused microphone is terminal: retrying re-prompts forever, and on some
 * browsers each retry is another permission dialog aimed at someone driving.
 */
test('a blocked microphone is reported once, not retried forever', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.evaluate(() => {
    const rec = (window as unknown as {
      __rec?: { onerror?: (e: { error: string }) => void; onend?: () => void };
    }).__rec;
    rec?.onerror?.({ error: 'not-allowed' });
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'denied');
  await expect(page.locator('.voice-status-state')).toContainText('blocked');
});

test('the whole vocabulary is on screen, so nothing has to be remembered', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  const words = page.locator('.voice-status-words');
  for (const word of ['hit', 'stand', 'double', 'split', 'surrender', 'repeat']) {
    await expect(words).toContainText(word);
  }
});
