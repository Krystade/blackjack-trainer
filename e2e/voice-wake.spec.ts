import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * A15: the microphone is woken by the events the recogniser cannot see.
 *
 * useVoiceControl listens for the page coming back (visibilitychange), the
 * network returning (online) and the audio route settling (devicechange on
 * navigator.mediaDevices), and each restarts a backed-off session at once
 * (controller.resume). Without them the microphone stays deaf for the whole
 * backoff, with Jack already talking into it.
 *
 * The page clock is paused and never run past the restart delay, so the
 * only thing that can bring a session back is the event under test. The fake
 * recogniser confirms on a microtask, which the clock does not hold.
 */

declare global {
  interface Window {
    __rec?: { onend: (() => void) | null };
    __recCount?: number;
  }
}

async function installFakeRecognition(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      constructor() {
        window.__rec = this;
        window.__recCount = (window.__recCount ?? 0) + 1;
      }
      start(): void {
        queueMicrotask(() => {
          this.onstart?.();
          this.onaudiostart?.();
        });
      }
      abort(): void {
        this.onend?.();
      }
      stop(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

const status = (page: Page) => page.locator('.voice-status');

async function openVoiceFlashcards(page: Page): Promise<void> {
  await page.clock.install();
  await installFakeRecognition(page);
  await withProfile(page);
  await withSettings(page, { drill: { flashCategory: 'hard' }, audio: { enabled: true, answerPauseMs: 0 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(status(page)).toHaveAttribute('data-voice-state', 'listening');
  // install() leaves time flowing; from here no timer fires unless run.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

/**
 * End the live session as a dead one (no word heard, gone at once), and check
 * it is left backing off: with the clock held, nothing restarts it.
 */
async function killSession(page: Page): Promise<number> {
  const before = await page.evaluate(() => window.__recCount ?? 0);
  await page.evaluate(() => window.__rec?.onend?.());
  await expect(status(page)).toHaveAttribute('data-voice-state', 'restarting');
  // Well short of the restart delay (RESTART_DELAY_MS doubled per failure).
  await page.clock.runFor(100);
  await expect(status(page)).toHaveAttribute('data-voice-state', 'restarting');
  expect(await page.evaluate(() => window.__recCount ?? 0), 'restarted without the event').toBe(before);
  return before;
}

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { get: () => s, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('the page coming back restarts a backed-off microphone at once', async ({ page }) => {
  await openVoiceFlashcards(page);
  const before = await killSession(page);
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(status(page)).toHaveAttribute('data-voice-state', 'listening');
  expect(await page.evaluate(() => window.__recCount)).toBe(before + 1);
});

test('the network coming back restarts it, but not while the page is hidden', async ({ page }) => {
  await openVoiceFlashcards(page);
  const before = await killSession(page);

  // Hidden: the wake is refused (the recogniser cannot run on a hidden page).
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  await page.clock.runFor(100);
  await expect(status(page)).toHaveAttribute('data-voice-state', 'restarting');
  expect(await page.evaluate(() => window.__recCount)).toBe(before);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(status(page)).toHaveAttribute('data-voice-state', 'listening');
  expect(await page.evaluate(() => window.__recCount)).toBe(before + 1);
});

test('the audio route settling (devicechange) restarts it at once', async ({ page }) => {
  await openVoiceFlashcards(page);
  const before = await killSession(page);
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  await expect(status(page)).toHaveAttribute('data-voice-state', 'listening');
  expect(await page.evaluate(() => window.__recCount)).toBe(before + 1);
});
