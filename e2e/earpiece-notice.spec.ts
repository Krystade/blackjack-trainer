import { test, expect, type Page } from '@playwright/test';

/**
 * The app saying out loud what opening the microphone costs.
 *
 * WHAT THIS IS NOT. It is not a fix. Jack, 2026-10-03: "Whenever I turn on the
 * mic it switches my speaker to the phone speaker like I'm on a phone call...
 * It works fine until I turn on voice and then it's stuck like that." Asked
 * whether turning voice back off brings the loud speaker back: "No -- stays on
 * the earpiece." iOS puts the audio session into play-and-record the instant
 * anything opens a microphone, play-and-record routes output to the receiver,
 * and Safari exposes no part of the audio session to a web page -- no category,
 * no `defaultToSpeaker`, no `setSinkId`, no output device list. There is nothing
 * to call, and the app cannot even detect it (the hardware rate read 48000 on
 * both sides of every mic-open that drive).
 *
 * So what is left is not hiding it. The two things the operator cannot work out
 * from the symptom alone are that the microphone caused it and that reopening
 * the app is the way back, and those are what these tests pin.
 */

/** A recogniser that starts, as the real one does once permission is granted. */
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

async function openFlashcards(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
}

/**
 * Through the tab bar, never through `page.goto`. A reload is a new page, and a
 * new page has not opened the microphone -- so a test that navigated by URL
 * would clear the very flag it is here to check and pass for the wrong reason.
 */
async function openTab(page: Page, name: 'Drills' | 'Settings'): Promise<void> {
  await page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();
}

test('the strip says where the sound went, once the microphone has opened', async ({ page }) => {
  await openFlashcards(page);
  const strip = page.locator('.voice-status');
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(strip).toHaveAttribute('data-voice-state', 'listening');
  await expect(page.locator('.voice-status-earpiece')).toContainText('earpiece');
});

test('Settings keeps saying so after voice is switched back off', async ({ page }) => {
  // The moment it matters most: voice is off, the cabin has gone quiet, and
  // the operator is in Settings looking for the reason. A notice that lived
  // only in the listening strip would have disappeared with the strip.
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await openTab(page, 'Settings');
  // The premise: silent until something has actually cost the loud speaker.
  await expect(page.locator('.settings-earpiece')).toHaveCount(0);

  await openTab(page, 'Drills');
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.getByRole('checkbox', { name: 'Voice answers' }).uncheck();
  await expect(page.locator('.voice-status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await openTab(page, 'Settings');
  await expect(page.locator('.settings-earpiece')).toContainText('reopen');
});


/**
 * The control itself, end to end.
 *
 * `audioSession.ts` is unit-tested to death and all of it is dead weight if
 * the three buttons do not reach the setting. Chromium does not implement
 * `navigator.audioSession` at all, which makes this the other assertion worth
 * having here: the app must be completely unbothered by its absence, since
 * that is also every desktop browser Jack might open it in.
 */
test('the route control reaches the setting, with no audioSession API present', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Belt and braces: assert the absent-API path rather than trusting the
    // browser to keep not implementing it.
    delete (navigator as unknown as Record<string, unknown>).audioSession;
  });
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Settings', exact: true }).click();

  const read = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem('bjtrainer.settings.v1');
      return raw ? (JSON.parse(raw) as { audio?: { outputRoute?: string } }).audio?.outputRoute : undefined;
    });

  const row = page.locator('.settings-row', { hasText: 'Sound with the mic on' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect.poll(read).toBe('auto');

  // No Switch: it was retired on load by store/persist.ts and then deleted.
  await expect(row.getByRole('button', { name: 'Switch', exact: true })).toHaveCount(0);

  await row.getByRole('button', { name: 'Speaker', exact: true }).click();
  await expect.poll(read).toBe('playback');

  // And nothing anywhere threw over the missing API.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  expect(errors).toEqual([]);
});
