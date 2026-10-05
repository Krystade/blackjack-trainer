import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * The app grading its own voice, reported from the 2026-10-02 drive as "it was
 * also hearing its own corrections".
 *
 *   09:49:08.267  speak deafen ms=5000 said="Wrong. Basic hit versus dealer
 *                 three. Correct play was hit. True count was zero."
 *   09:49:13.906  tts-end ms=5615        -- 61ms before the window shut
 *   09:49:16.225  mic result heard="Correct play was hit true count was zero"
 *                 -> mic verdict verdict=hit
 *
 * The deaf window was open for the whole utterance and still lost it, because
 * `isSuppressed` is asked when the RESULT ARRIVES and the engine took 2258ms
 * to deliver one. A Web Speech result carries no timestamp for its audio.
 *
 * WHY THIS IS AN E2E AND NOT ANOTHER UNIT TEST. The fix spans three files --
 * selfEcho.ts decides, voiceControl.ts asks it, and useVoiceControl.ts is the
 * one line that hands the controller the words to compare against. All three
 * have unit tests and the joining line had none: deleting the `text` argument
 * from `controller.suppressFor(ms, text)` left every unit suite green. That is
 * precisely the line the drive bug lives on.
 *
 * It is checked through the DIAGNOSTIC LOG rather than through the status bar,
 * and that is the point of the design here. `suppressed-echo` is written by
 * the word check alone; the timer writes `suppressed`. In a live drill the app
 * may start talking between any two steps of a test, so a status bar reading
 * "ignored (the app was speaking)" cannot say WHICH of the two caught it --
 * and a test that passes because the timer happened to be open is a test that
 * passes with the fix deleted.
 */

const KEY = 'bjtrainer.diagnostics.v1';

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

async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
}

async function diagEvents(page: Page, event: string): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return entries.filter((e) => e.event === event);
  } catch {
    return [];
  }
}

async function openCountDrillListening(page: Page): Promise<void> {
  await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countIntervalMs: 0, countManual: false, countLengthCards: 6 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  // Eyes-free, then the microphone: the voice status bar does not exist until
  // both are on, and nor does the thing under test.
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

test('a transcript of the app’s own voice is refused on its words, not on the clock', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCountDrillListening(page);
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // Hand the app back whatever it last said, over and over, until one of them
  // lands after the deaf window has shut -- the engine's 2.3-second delivery
  // lag, reproduced. Only the word check can catch one of those, and only the
  // word check writes this event.
  await expect
    .poll(
      async () => {
        const said = (await spoken(page)).at(-1) ?? '';
        if (said.trim().split(/\s+/).length > 2) await say(page, said.replace(/[.,!?]/g, ''));
        return (await diagEvents(page, 'suppressed-echo')).length;
      },
      { timeout: 60_000, intervals: [400] },
    )
    .toBeGreaterThan(0);

  // And it says what it matched against, so a drive can be read afterwards.
  const [entry] = await diagEvents(page, 'suppressed-echo');
  const detail = entry!.detail as Record<string, unknown>;
  expect(typeof detail.said).toBe('string');
  expect(typeof detail.sinceMs).toBe('number');
});

test('a one-word answer is never dismissed as an echo, however well it matches', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCountDrillListening(page);
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // THE HALF THAT DECIDES WHETHER THE FIX IS WORTH HAVING, and it has to be
  // fed a word the app GENUINELY JUST SAID or it proves nothing: a word the
  // app never uttered is refused by containment alone, with or without the
  // floor. So each round takes one word out of the app's own last sentence and
  // hands that back -- the strongest possible echo match at the shortest
  // possible length.
  //
  // Every phrase in the vocabulary is one or two words, so if ECHO_MIN_WORDS
  // ever stopped protecting them the drill would start eating real answers and
  // then sit in silence, which is what a dead microphone sounds like and the
  // thing this app is most often accused of.
  const tried: string[] = [];
  for (let i = 0; i < 25; i++) {
    const said = (await spoken(page)).at(-1) ?? '';
    const word = said.replace(/[.,!?]/g, '').trim().split(/\s+/)[0] ?? '';
    if (word) {
      tried.push(word.toLowerCase());
      await say(page, word);
    }
    await page.waitForTimeout(250);
  }
  expect(tried.length, 'nothing was ever fed back, so nothing was tested').toBeGreaterThan(5);

  // Not one of them may have been thrown away by the WORDS. The timer is free
  // to have caught some -- that is its job, and it is not what this guards.
  const echoed = (await diagEvents(page, 'suppressed-echo')).map((e) =>
    String((e.detail as Record<string, unknown>).heard ?? '').toLowerCase(),
  );
  const eaten = echoed.filter((h) => h.trim().split(/\s+/).length < 3);
  expect(eaten, 'a single word was dismissed as the app hearing itself').toEqual([]);
});
