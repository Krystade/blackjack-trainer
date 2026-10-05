import { test, expect, type Page } from '@playwright/test';

/**
 * The app saying out loud what opening the microphone costs.
 *
 * WHAT THE NOTICE SAYS NOW. Since 2026-10-05 recorded clips and chimes are
 * played through Web Audio once a microphone has been opened, and that stays on
 * the loud speaker (7/7 on the operator's phone against 2/7 for <audio>). Only
 * the phone's own speech-synthesis voice, which cannot be routed through Web
 * Audio, may still use the earpiece. The notice says that, and no longer tells
 * anyone to reopen the app.
 *
 * THE ORIGINAL PROBLEM. Jack, 2026-10-03: "Whenever I turn on the
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
 * What these tests pin is that the notice appears only after a microphone has
 * opened, survives voice being switched off, and says what is true.
 */

/** A recogniser that starts, as the real one does once permission is granted. */
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

/**
 * The hand drills cut the listening strip to one line (state + last heard) so
 * the action bar fits the screen -- see e2e/drill-layout.spec.ts. The earpiece
 * line is left to Settings, which shows it for the rest of the page load (the
 * test below); the drill strip no longer repeats it on every card.
 */
test('the Flashcards strip leaves the earpiece note to Settings', async ({ page }) => {
  await openFlashcards(page);
  const strip = page.locator('.voice-status');
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(strip).toHaveAttribute('data-voice-state', 'listening');
  await expect(page.locator('.voice-status-earpiece')).toBeHidden();
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
  const notice = page.locator('.settings-earpiece');
  await expect(notice).toContainText('Recorded lines and alert tones stay on the loud speaker');
  await expect(notice).toContainText('phone\u2019s own voice may still come from the earpiece');
  // The old advice was wrong for recorded lines: nothing needs reopening.
  await expect(notice).not.toContainText('reopen');
});

