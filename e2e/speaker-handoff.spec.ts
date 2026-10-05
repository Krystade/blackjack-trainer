import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * Taking the microphone down so the sound comes out of the loud speaker.
 *
 * THE PROBLEM. On iOS, opening the microphone moves all output to the earpiece
 * at the top of the phone, and in a moving car that is inaudible. It is
 * WebKit bug 218012, open since 2020: Safari sets the audio session to allow
 * Bluetooth and mix with others when capture starts, and never
 * `defaultToSpeaker`. Chrome and Firefox on iOS are the same engine, which
 * Jack confirmed from the road, so there is no browser to switch to.
 *
 * WHAT DID NOT WORK. `navigator.audioSession.type = 'playback'` exists and the
 * app sets it, and the 2026-10-04 drive proved it is not enough:
 *
 *   route audio-session was=auto wanted=playback got=playback ok=true
 *   route session-at-mic-open  type=playback
 *   route session-at-mic-close type=playback
 *
 * -- the declared category held all the way through, and the sound was on the
 * earpiece anyway. The category a PAGE DECLARES and the category the session
 * is IN are different things once something is capturing.
 *
 * WHAT USED TO BE TESTED HERE. "Switch" mode tried the one workaround reported
 * to work -- an ORDER, not a flag: stop capturing, declare playback, then make
 * the sound. The 2026-10-04 evening drive ran it exactly and the sound was
 * still on the earpiece, so store/persist.ts rewrote a stored 'switch' to
 * 'auto' on every load, and the mode and its handoff have since been deleted
 * along with the three tests that drove it.
 *
 * WHAT IS LEFT is the guard that the two remaining settings never take the
 * microphone down to speak: a handoff costs about 1.2 seconds of deafness per
 * line, and nothing that remains is supposed to pay it.
 */

const KEY = 'bjtrainer.diagnostics.v1';

async function withCountingEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__micLog = [] as string[];
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
        (w.__micLog as string[]).push('start');
        setTimeout(() => this.onstart?.(), 0);
      }
      stop(): void {
        (w.__micLog as string[]).push('stop');
        setTimeout(() => this.onend?.(), 0);
      }
      abort(): void {
        (w.__micLog as string[]).push('abort');
        this.onend?.();
      }
    }
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

async function handoffs(page: Page): Promise<string[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return entries
      .filter((e) => e.event === 'handoff')
      .map((e) => String((e.detail as Record<string, unknown>).to ?? ''));
  } catch {
    return [];
  }
}

/** Times the recogniser was told to stop -- what a handoff would have done. */
async function micStops(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      ((window as unknown as { __micLog?: string[] }).__micLog ?? []).filter((e) => e === 'stop')
        .length,
  );
}

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
}

async function listenInCountDrill(page: Page, outputRoute: string): Promise<void> {
  await withCountingEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0, outputRoute },
    drill: { countIntervalMs: 0, countManual: false, countLengthCards: 6 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

test('on Speaker, nothing touches the microphone', async ({ page }) => {
  test.setTimeout(90_000);
  await listenInCountDrill(page, 'playback');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // Speaker declares the category and accepts the earpiece rather than paying
  // 1.2 seconds of deafness per line, so there must be no handoff at all.
  await page.waitForTimeout(2000);
  expect(await handoffs(page)).toEqual([]);
  expect(await micStops(page)).toBe(0);
});

test('on Auto, nothing touches the microphone either', async ({ page }) => {
  test.setTimeout(90_000);
  await listenInCountDrill(page, 'auto');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  expect(await handoffs(page)).toEqual([]);
  expect(await micStops(page)).toBe(0);
});
