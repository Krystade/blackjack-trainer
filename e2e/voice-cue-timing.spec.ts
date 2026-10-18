import { test, expect, type Page } from '@playwright/test';
import { readStoredDiagnostics } from './helpers';

/**
 * B2 #5, #6, #7: when the app tells the driver to speak, the microphone must
 * already be taking answers.
 *
 * The microphone stays deaf for SPEECH_TAIL_MS (700ms) after a prompt ends,
 * because the recogniser's results lag the audio. The "your turn" tone used to
 * sound 350ms after the ending, inside that window, so an answer given on the
 * tone was thrown away as "the app was speaking" (#5). The "say again" chime
 * then added another full speech tail on top of itself, so the repeat was
 * dropped too, silently (#6). And after the first prompt, two "talk now"
 * tones sounded 350ms apart (#7).
 *
 * The timing runs INSIDE the page. A Playwright round trip between seeing a
 * cue and answering it would add its own unknown delay, which is exactly the
 * quantity under test.
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

async function voiceOn(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

const log = (page: Page) => page.evaluate(() => window.__speechLog ?? []);
const CUES = new Set(['chime:ready', 'chime:turn']);

test('#5: an answer given on the "your turn" tone is graded, not ignored', async ({ page }) => {
  await openFlashcards(page);
  await voiceOn(page);
  await page.waitForTimeout(500); // let the opening cue settle
  const before = (await log(page)).length;

  // The hand, repeated off the wheel, then answer the instant the tone sounds.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const start = (window.__speechLog ?? []).length;
        window.__wheelPress?.('back');
        const give = Date.now() + 8000;
        const poll = () => {
          const fresh = (window.__speechLog ?? []).slice(start);
          if (fresh.some((e) => e === 'chime:turn' || e === 'chime:ready')) {
            const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
            rec?.onresult?.({ results: [[{ transcript: 'hit' }]] });
            resolve();
            return;
          }
          if (Date.now() > give) reject(new Error('no your-turn tone after the prompt'));
          else setTimeout(poll, 2);
        };
        poll();
      }),
  );

  const after = (await log(page)).slice(before);
  expect(after, 'the answer on the tone was suppressed').not.toContain('chime:again');
  await expect(page.locator('.feedback-cell')).toHaveCount(1);
});

/**
 * How long the wheel's "repeat the hand" line sounds. Under `?e2e=1`, speak()
 * ends each line at its own estimate, which the diagnostics log records as the
 * `deafen` window. Read rather than recomputed, so the spec follows the app.
 */
async function repeatLineMs(page: Page): Promise<number> {
  await page.evaluate(() => window.__wheelPress?.('back'));
  const said = (await log(page)).at(-1);
  const readMs = () => readStoredDiagnostics(page).then((stored) => {
    const text = said;
    const raw = JSON.parse(stored || '{}') as
      | { entries?: { event?: string; detail?: { ms?: number; said?: string } }[] }
      | { event?: string; detail?: { ms?: number; said?: string } }[];
    const entries = Array.isArray(raw) ? raw : (raw.entries ?? []);
    const hit = [...entries].reverse().find((e) => e.event === 'deafen' && e.detail?.said === text);
    return hit?.detail?.ms ?? -1;
  });
  // The diagnostics log is written behind the event; wait for the entry.
  await expect.poll(readMs, { message: 'no deafen entry for the repeated line' }).toBeGreaterThan(0);
  const ms = await readMs();
  // Let that line and its tail pass before the timed run.
  await page.waitForTimeout(ms + 1200);
  return ms;
}

test('#6: saying it again after the "say again" chime is heard', async ({ page }) => {
  await openFlashcards(page);
  await voiceOn(page);
  const lineMs = await repeatLineMs(page);

  // Answer 100ms after the line ends: inside the 700ms speech tail, so it is
  // dropped and cued with "say again". Say it again 800ms after that chime,
  // once the line's own tail has passed. The chime itself must not have
  // bought another 700ms speech tail on top of its tone.
  const result = await page.evaluate(
    (lineMs) =>
      new Promise<{ attention: number }>((resolve, reject) => {
        const rec = () => (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
        const start = (window.__speechLog ?? []).length;
        window.__wheelPress?.('back');
        setTimeout(() => {
          rec()?.onresult?.({ results: [[{ transcript: 'double' }]] });
          const fresh = (window.__speechLog ?? []).slice(start);
          const attention = fresh.filter((e) => e === 'chime:again').length;
          if (attention !== 1) {
            reject(new Error(`expected one say-again chime, log: ${fresh.join(' | ')}`));
            return;
          }
          setTimeout(() => {
            rec()?.onresult?.({ results: [[{ transcript: 'double' }]] });
            resolve({ attention });
          }, 800);
        }, lineMs + 100);
      }),
    lineMs,
  );
  expect(result.attention).toBe(1);
  await expect(page.locator('.feedback-cell')).toHaveCount(1);
});

test('#5: an answer lost to the speech tail says it was too soon, not that the app was speaking', async ({ page }) => {
  await openFlashcards(page);
  await voiceOn(page);
  const lineMs = await repeatLineMs(page);
  await page.evaluate(
    (lineMs) =>
      new Promise<void>((resolve) => {
        window.__wheelPress?.('back');
        setTimeout(() => {
          const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
          rec?.onresult?.({ results: [[{ transcript: 'double' }]] });
          resolve();
        }, lineMs + 100);
      }),
    lineMs,
  );
  await expect(page.locator('.voice-status')).toContainText('ignored (too soon)');
  await expect(page.locator('.feedback-cell')).toHaveCount(0);
});

test('#5: an answer over the prompt itself still says the app was speaking', async ({ page }) => {
  await openFlashcards(page);
  await voiceOn(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__wheelPress?.('back');
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: 'double' }]] });
  });
  await expect(page.locator('.voice-status')).toContainText('the app was speaking');
  await expect(page.locator('.feedback-cell')).toHaveCount(0);
});

test('#7: one "talk now" tone after the first prompt, not two', async ({ page }) => {
  await openFlashcards(page);
  // The microphone comes up WHILE a prompt is sounding, as it does on a real
  // device (the engine takes longer than the opening line).
  await page.evaluate(() => window.__wheelPress?.('back'));
  const before = (await log(page)).length;
  await voiceOn(page);
  await page.waitForTimeout(3500);
  const cues = (await log(page)).slice(before).filter((e) => CUES.has(e));
  expect(cues, 'every "talk now" tone after the first prompt').toHaveLength(1);
});
