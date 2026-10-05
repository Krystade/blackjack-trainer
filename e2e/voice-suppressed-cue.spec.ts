import { test, expect, type Page } from '@playwright/test';

/**
 * The answer given over the tail of a prompt.
 *
 * Reported from the car (2026-09-16): "need audio feedback when attempted even
 * if not valid word". A rejected word already chimed. A SUPPRESSED one did
 * not, and suppression is the more common way to lose an answer -- the app is
 * still talking, the microphone is deliberately deaf, and the utterance is
 * dropped without a sound. Silence is what a dead microphone sounds like too,
 * so from the driver's seat the two are the same event.
 *
 * The one suppressed utterance that must stay silent is the app hearing its
 * own voice come back through the microphone, which is what suppression is
 * FOR. Both directions are asserted here; a cue on everything would be worse
 * than the silence it replaces.
 */

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

async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

/**
 * Start a long utterance and hand back what it said.
 *
 * The wheel's back button repeats the hand, which is a whole sentence -- so
 * the suppression window opens at a known moment rather than being raced
 * against whatever the screen happened to be saying on arrival.
 */
async function startTalking(page: Page): Promise<string> {
  await page.evaluate(() => window.__wheelPress?.('back'));
  const log = await spoken(page);
  return log[log.length - 1] ?? '';
}

test('an answer said over the app earns a cue instead of vanishing', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  await startTalking(page);
  const before = (await spoken(page)).length;

  await say(page, 'double');

  const after = await spoken(page);
  expect(after.slice(before)).toContain('chime:attention');
  // Suppressed, not acted on: the card must not have been graded.
  await expect(page.locator('.feedback-cell')).toHaveCount(0);
});

test('the app hearing its own voice stays silent', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  const said = await startTalking(page);
  expect(said, 'the prompt was not spoken, so nothing was suppressed').not.toBe('');
  const before = (await spoken(page)).length;

  // A fragment of the app's own sentence, as the microphone would return it.
  const echo = said.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  await say(page, echo);

  expect((await spoken(page)).slice(before)).not.toContain('chime:attention');
});

/**
 * The cue is a chime, and a chime is a sound.
 *
 * A sound deafens the microphone for its own duration, so a cue per suppressed
 * utterance extends the window that suppressed it -- talk to the app while it
 * is talking and it never hears you again. The count drill's voice suite found
 * this by polling an utterance every 400ms and never getting back out.
 *
 * One cue per thing the app says. Not a nicety: the loop is the bug.
 */
test('the cue is given once per utterance, not once per attempt', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  await startTalking(page);
  const before = (await spoken(page)).length;

  await say(page, 'double');
  await say(page, 'double');
  await say(page, 'double');

  const cues = (await spoken(page)).slice(before).filter((e) => e === 'chime:attention');
  expect(cues).toHaveLength(1);
});
