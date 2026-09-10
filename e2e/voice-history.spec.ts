import { test, expect, type Page } from '@playwright/test';

/**
 * The microphone log.
 *
 * It exists because the alias table only improves when a real mishearing is
 * caught, and the one caught so far -- "Stant" for "stand" -- was found by
 * the operator happening to look at the screen mid-drill. That method does
 * not work in a car, which is where road noise and a phone microphone produce
 * the substitutions worth knowing about.
 *
 * It is also a record of what an open microphone heard, so the specs below
 * cover the privacy affordances as seriously as the diagnostics: it must be
 * clearable, and clearing must actually clear.
 */

async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      phrases: unknown[] = [];
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
  await expect
    .poll(
      async () => {
        await say(page, transcript, alternatives);
        return page.locator('.voice-status-heard').textContent();
      },
      { timeout: 15_000, intervals: [400] },
    )
    .not.toContain('the app was speaking');
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
  // way out is also what a person does, and it proves the log survives the
  // microphone closing.
  const back = page.locator('.drill-back-btn');
  if (await back.count()) await back.first().click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.locator('.settings-section', { hasText: 'What the microphone heard' });
  await expect(section).toBeVisible();
  return section;
}

test('nothing is recorded until the microphone is actually on', async ({ page }) => {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  const section = await openHistory(page);
  await expect(section).toContainText('none yet');
});

test('a misheard word is kept, so it can be taught later', async ({ page }) => {
  await drillWithVoice(page);
  // A word nothing can reach: not an alias, and far enough from every command
  // that the near-miss rule will not claim it either. "Stant" was the original
  // real example and has since been taught, and "stend" now resolves to stand
  // by consonant skeleton -- both would test the opposite of what this claims.
  await say(page, 'wombat');

  const section = await openHistory(page);
  await expect(section).toContainText('1 not');
  await expect(section).toContainText('wombat');
});

test('understood speech is recorded too, not only the misses', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'stand');

  const section = await openHistory(page);
  await expect(section).toContainText('1 understood');
});

/**
 * The ranking is the whole value. A substitution the engine keeps producing
 * is a real alias worth adding; a phrase said once near the microphone is
 * not, and only the count tells them apart.
 */
test('a repeated miss outranks a one-off', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'wombat');
  await say(page, 'wombat');
  await say(page, 'what time is it');

  const section = await openHistory(page);
  await expect(section).toContainText('Commonest miss');
  await expect(section).toContainText('“wombat” ×2');
});

test('the full log can be read on screen', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'wombat');

  const section = await openHistory(page);
  await section.getByRole('button', { name: 'Show' }).click();
  await expect(section.locator('pre')).toContainText('candidate aliases');
  await expect(section.locator('pre')).toContainText('[flashcards]');
});

/**
 * It records what an open microphone heard, so deleting it has to be one tap
 * away and has to actually delete.
 */
test('the recording can be deleted outright', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'wombat');

  let section = await openHistory(page);
  await expect(section).toContainText('wombat');

  await section.getByRole('button', { name: 'Delete recording' }).click();
  await expect(section).toContainText('none yet');

  // And it stays deleted, rather than reappearing from storage on reload.
  await page.reload();
  section = await openHistory(page);
  await expect(section).toContainText('none yet');
});

test('the panel says plainly that nothing leaves the device', async ({ page }) => {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  const section = await openHistory(page);
  await expect(section).toContainText('never uploaded');
});

/**
 * How much help the engine needed, broken out by kind.
 *
 * A word the engine ranked second and a word it never produced at all are
 * different facts about the microphone. Counting them together would leave
 * the log unable to say whether near-miss matching is earning its place or
 * quietly guessing, which is the question the next drive has to answer.
 */
test('the log separates a word ranked second from one never said at all', async ({ page }) => {
  await drillWithVoice(page);

  // Verbatim from the drive: the engine had "Stand" and ranked it third.
  await sayWhenListening(page, 'Band', ['Send', 'Stand']);
  // And here it never produced the word at all -- reached by consonant
  // skeleton. Said only once the app has stopped talking about the last
  // answer, or it would be swallowed as the app hearing itself.
  await sayWhenListening(page, 'send');

  const section = await openHistory(page);
  await expect(section).toContainText('Needed help');
  await expect(section).toContainText('1 ranked second');
  await expect(section).toContainText('1 near miss');
});

// A row of zeroes is noise on a screen read while driving.
test('no help needed means no row about help', async ({ page }) => {
  await drillWithVoice(page);
  await say(page, 'stand');

  const section = await openHistory(page);
  await expect(section).toContainText('1 understood');
  await expect(section).not.toContainText('Needed help');
});
