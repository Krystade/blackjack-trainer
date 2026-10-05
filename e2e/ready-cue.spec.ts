import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * "I didn't hear any chime indicating the mic was activated" -- Jack,
 * 2026-10-02. The chime played. From his own log:
 *
 *   16:22:58.527  speak clip-chain files="you-have-ace-five.mp3, dealer-shows-ten.mp3"
 *   16:22:58.597  speak chime     kind=ready volume=1
 *   16:23:01.556  speak clip-end  ms=3029
 *
 * Seventy milliseconds into a three-second prompt: a 120ms sine at half scale
 * underneath a voice at full. There is no `chime-suspended` line, so the tone
 * was generated and simply masked. It was also premature -- anything said
 * during that prompt is discarded as the app's own voice -- so the moment
 * worth marking is when the app shuts up, not when the recogniser confirms.
 *
 * WHAT THIS SPEC IS FOR, and it is not the holding. The holding is decided in
 * `chimeWhenQuiet` and is unit-tested there against live speech, clip endings,
 * a lost `onend`, a cancel and a second cue. None of those tests touch the ONE
 * LINES that make any of it reach the car: the seven `onListening` cues, which
 * all read `audio.ding('ready')`. Swap one back and every unit test stays
 * green -- `ding` writes a `chime` entry and no cue entry at all, which is
 * exactly what this reads.
 *
 * Written against Count Drill for a reason. The first version of this spec
 * went red on the real code: four of the seven sites live in the per-drill
 * views (CountDrillView, ProduceTcDrillView, TrueCountDrillView) and Table,
 * and only the three in Drills.tsx had been converted. A spec aimed at one of
 * those three would have passed and shipped a cue that still fired under the
 * app's own voice in the drill Jack actually runs.
 *
 * Under `?e2e=1` `speak()` short-circuits before anything is pending, so the
 * cue finds the app quiet and sounds at once with `why=quiet`. That is the
 * right outcome for this harness and not what is under test; the event's
 * PRESENCE is.
 */

const KEY = 'bjtrainer.diagnostics.v1';

async function cueEvents(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return entries.filter((e) => e.event === 'cue-held' || e.event === 'cue-waiting');
  } catch {
    return [];
  }
}

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

test('the microphone-open cue goes through the held path, not a bare chime', async ({ page }) => {
  test.setTimeout(60_000);
  await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countIntervalMs: 0, countManual: false, countLengthCards: 6 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  // Eyes-free, then the microphone: `onListening` does not fire until the
  // recogniser reaches 'listening', and that is the cue's only trigger.
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  await expect.poll(async () => (await cueEvents(page)).length, { timeout: 20_000 }).toBeGreaterThan(0);

  // And it is the ready cue, not some other chime that happens to be held.
  const kinds = (await cueEvents(page)).map((e) => (e.detail as Record<string, unknown>).kind);
  expect(kinds, 'the held cue was not the microphone-open one').toContain('ready');
});
