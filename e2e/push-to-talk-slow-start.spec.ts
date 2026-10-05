import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The first push-to-talk press of a cold page.
 *
 * On the 2026-09-30 drive the first microphone of a page load took 6033ms to
 * reach `listening`: attempt 1 fired no event at all for the full five-second
 * watchdog while the permission was still being established, was torn down,
 * and attempt 2 confirmed in 460ms. The push-to-talk window was five seconds
 * counted FROM THE BUTTON PRESS, so that first press opened a window that was
 * over before the engine could hear anything -- the operator heard the press
 * acknowledged, spoke into a microphone that was not live, and got nothing.
 *
 * The fake engine here reproduces exactly that shape, because it is the only
 * shape that distinguishes the fix from the bug: a window counted from the
 * press passes every test where the microphone opens promptly.
 *
 * `ptt-live` is the event under test. It exists only in the fixed version --
 * it is the moment the wait becomes the speaking window.
 */

/** Attempt 1 never fires; attempt 2 onward fire immediately. The drive's shape. */
async function withSlowFirstEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let attempt = 0;
    class SlowFirstRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      start(): void {
        attempt += 1;
        // Attempt 1 is silent: no onstart, no onerror, nothing -- which is
        // what iOS did while it established the permission. The controller's
        // own watchdog is what eventually tears it down and retries.
        if (attempt === 1) return;
        setTimeout(() => this.onstart?.(), 0);
      }

      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = SlowFirstRecognition;
    w.webkitSpeechRecognition = SlowFirstRecognition;
  });
}

function micEvents(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem('bjtrainer.diagnostics.v1') ?? '[]') as {
        event: string;
      }[]
    ).map((e) => e.event),
  );
}

test('a press whose microphone is slow to open still gets its window', async ({ page }) => {
  await withSlowFirstEngine(page);
  await withSettings(page, { audio: { enabled: true }, drill: { wheelMode: 'talk' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True count drill', exact: true }).click();

  const pressed = await page.evaluate(() => window.__wheelPress?.('forward') ?? false);
  expect(pressed, 'the wheel must reach the screen or this proves nothing').toBe(true);

  await expect
    .poll(async () => (await micEvents(page)).includes('ptt-open'), { timeout: 4000 })
    .toBe(true);

  // Past the old five seconds, with the microphone still not live. The window
  // counted from the press is gone by here; this one is still waiting.
  await page.waitForTimeout(6000);

  // The watchdog has torn down the silent attempt and the retry has fired, so
  // the window has become a SPEAKING window rather than having expired unused.
  await expect
    .poll(async () => (await micEvents(page)).includes('ptt-live'), { timeout: 8000 })
    .toBe(true);
});

/**
 * A one-word answer should cost one word.
 *
 * The window could not be ended by pressing again -- while the microphone is
 * open the car owns the buttons -- and nothing closed it on a recognised word
 * either, despite `endPushToTalk`'s own comment claiming it did. So every
 * spoken answer held the wheel for the rest of the window after it had already
 * been graded.
 */
test('a recognised word closes the window instead of running it out', async ({ page }) => {
  await page.addInitScript(() => {
    class PromptRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      constructor() {
        (window as unknown as { __rec: PromptRecognition }).__rec = this;
      }

      start(): void {
        setTimeout(() => this.onstart?.(), 0);
      }

      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = PromptRecognition;
    w.webkitSpeechRecognition = PromptRecognition;
  });
  await withSettings(page, {
    audio: { enabled: true },
    // The longest window the setting allows, so a close inside it cannot be
    // the timer finishing early.
    drill: { wheelMode: 'talk', pushToTalkMs: 8000 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  expect(await page.evaluate(() => window.__wheelPress?.('forward') ?? false)).toBe(true);
  await expect
    .poll(async () => (await micEvents(page)).includes('ptt-live'), { timeout: 8000 })
    .toBe(true);

  // Say one word.
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: 'stand', confidence: 0.9 }], { isFinal: true, length: 1 }),
      ],
    });
  });

  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          (
            JSON.parse(localStorage.getItem('bjtrainer.diagnostics.v1') ?? '[]') as {
              event: string;
              detail?: { why?: string };
            }[]
          ).some((e) => e.event === 'ptt-close' && e.detail?.why === 'heard'),
        ),
      { timeout: 5000 },
    )
    .toBe(true);
});
