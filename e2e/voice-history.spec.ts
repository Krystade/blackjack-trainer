import { test, expect, type Page } from '@playwright/test';
import { sayOnceListening } from './helpers';

/**
 * The microphone history, end to end: heard in a drill, offered for teaching.
 *
 * It exists because the alias table only improves when a real mishearing is
 * caught, and the one caught so far -- "Stant" for "stand" -- was found by
 * the operator happening to look at the screen mid-drill. That method does
 * not work in a car, which is where road noise and a phone microphone produce
 * the substitutions worth knowing about.
 *
 * Its own read-back panel ("What the microphone heard") is gone: every phrase
 * is in the diagnostic log, and the only thing worth doing with a rejection on
 * the phone is teaching it, so the history surfaces in "Teach it your words".
 * voice-aliases.spec.ts seeds storage directly; this spec owns the path from
 * a real drill into that list, and the privacy half -- it is a record of what
 * an open microphone heard, so it must be clearable, and clearing must clear.
 */

async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      phrases: unknown[] = [];
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

async function say(page: Page, transcript: string, alternatives: string[] = []): Promise<void> {
  await page.evaluate(({ text, alts }) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    const readings = [{ transcript: text }, ...alts.map((a) => ({ transcript: a }))];
    rec?.onresult?.({ results: [readings] });
  }, { text: transcript, alts: alternatives });
}

/**
 * Speak once the microphone is actually trusting what it hears.
 *
 * Grading an answer makes the app talk, and while it talks the microphone
 * discards everything as its own voice. A test that fires straight afterwards
 * is testing suppression, not what it claims to test.
 */
async function sayWhenListening(
  page: Page,
  transcript: string,
  alternatives: string[] = [],
): Promise<void> {
  await sayOnceListening(page, transcript, alternatives);
}

async function drillWithVoice(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

async function openHistory(page: Page) {
  // A drill hides the tab bar, so leave it first. Turning voice off on the
  // way out is also what a person does, and it proves the history survives
  // the microphone closing.
  const back = page.locator('.drill-back-btn');
  if (await back.count()) await back.first().click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page
    .locator('.settings-section')
    .filter({ has: page.locator('summary', { hasText: 'Teach it your words' }) });
  await expect(section).toBeVisible();
  return section;
}

/** The offered rejections, in the order the panel lists them. */
function offers(section: ReturnType<Page['locator']>) {
  return section.locator(`.settings-row:has(select[aria-label^='What "']) .settings-label`);
}

test('a word misheard in a drill is offered for teaching', async ({ page }) => {
  await drillWithVoice(page);
  // A word nothing can reach: not an alias, and far enough from every command
  // that the near-miss rule will not claim it either. "Stant" was the original
  // real example and has since been taught, and "stend" now resolves to stand
  // by consonant skeleton -- both would test the opposite of what this claims.
  await say(page, 'wombat');

  const section = await openHistory(page);
  await expect(offers(section)).toHaveText(['“wombat” ×1']);
});

test('understood speech is not offered -- there is nothing to teach', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'stand');

  const section = await openHistory(page);
  await expect(offers(section)).toHaveCount(0);
});

/**
 * The ranking is the whole value. A substitution the engine keeps producing
 * is a real alias worth adding; a phrase said once near the microphone is
 * not, and only the count tells them apart.
 */
test('a repeated miss outranks a one-off', async ({ page }) => {
  await drillWithVoice(page);
  // Each miss now plays a "say it again" cue, and the microphone is deafened
  // for the length of it -- so a repeat fired instantly would be swallowed as
  // the app hearing its own chime.
  await sayWhenListening(page, 'wombat');
  await sayWhenListening(page, 'wombat');
  await sayWhenListening(page, 'what time is it');

  const section = await openHistory(page);
  await expect(offers(section)).toHaveText(['“wombat” ×2', '“what time is it” ×1']);
});

/**
 * It records what an open microphone heard, so forgetting it has to be one
 * tap away and has to actually delete.
 */
test('what it heard can be forgotten outright', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'wombat');

  let section = await openHistory(page);
  await expect(offers(section)).toHaveCount(1);

  await section.getByRole('button', { name: 'Forget what it heard' }).click();
  await expect(offers(section)).toHaveCount(0);

  // And it stays deleted, rather than reappearing from storage on reload.
  await page.reload();
  section = await openHistory(page);
  await expect(offers(section)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.voiceHistory.v1'))).toBeNull();
});
