import { test, expect, type Page } from '@playwright/test';

/**
 * Playing a hand out loud.
 *
 * The table has something the drills do not: MODALS. A correction, an
 * insurance prompt and a count check each stack over a round that is still in
 * progress, and a word said while one is up must act on the thing in front of
 * the operator rather than on the round behind it. Getting that wrong would
 * apply an answer to the wrong question and stake real bankroll on it, which
 * is why most of these specs are about what voice must NOT do.
 *
 * A fixed seed throughout: an unseeded shoe settles some rounds instantly and
 * opens insurance on others, so the branch under test would vary run to run.
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

async function openTableWithVoice(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play a shoe' }).click();
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

/** Everything the app has said, in e2e mode. */
async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
}

test('the microphone is off until it is asked for, and shows when it is on', async ({ page }) => {
  await withFakeEngine(page);
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play a shoe' }).click();

  // Nothing may open the microphone except the operator.
  await expect(page.locator('.voice-status')).toHaveCount(0);
  await expect(page.locator('.voice-btn')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.voice-status')).toBeVisible();
});

test('"yes" deals the next hand, so a shoe needs no tapping', async ({ page }) => {
  await openTableWithVoice(page);
  await expect(page.locator('.deal-btn')).toBeVisible();
  await say(page, 'yes');
  await expect(page.locator('.deal-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeVisible();
});

test('a spoken action plays the hand', async ({ page }) => {
  await openTableWithVoice(page);
  await say(page, 'yes');
  const before = await page.locator('.hand-cards').first().textContent();
  await say(page, 'uh, hit');
  await expect(page.locator('.hand-cards').first()).not.toHaveText(before ?? '');
});

/**
 * Legality comes from the engine, not from the card list: only it knows about
 * split depth, doubling after a split, and how many cards the hand holds. A
 * refusal is SPOKEN because a greyed-out button conveys nothing to a driver.
 */
test('an illegal call is refused out loud and changes nothing', async ({ page }) => {
  await openTableWithVoice(page);
  await say(page, 'yes');

  const split = page.getByRole('button', { name: 'Split', exact: true });
  await expect(split).toBeDisabled();

  const before = await page.locator('.hand-cards').first().textContent();
  await say(page, 'split');

  await expect(page.locator('.hand-cards').first()).toHaveText(before ?? '');
  expect((await spoken(page)).join(' | ')).toContain("Split isn't available");
});

/**
 * The stacking rule. A correction is modal over a round still in progress, so
 * an action word here must not reach the hand underneath -- it would answer a
 * question that is no longer being asked, with money on it.
 */
test('a word said over a correction does not reach the hand behind it', async ({ page }) => {
  await openTableWithVoice(page);
  await say(page, 'yes');
  // Hit on this hand is graded wrong, which raises the correction panel.
  await say(page, 'hit');
  await expect(page.locator('.overlay-continue-btn')).toBeVisible();

  const before = await page.locator('.hand-cards').first().textContent();

  // The word must arrive AFTER the app has finished reading the correction,
  // or suppression swallows it first and this proves nothing about the modal
  // guard -- which is exactly how an earlier version of this spec passed
  // against a build with the guard removed. Repeat until it is genuinely
  // heard, then assert that being heard still changed nothing.
  await expect
    .poll(
      async () => {
        await say(page, 'hit');
        return page.locator('.voice-status-heard').textContent();
      },
      { timeout: 15_000, intervals: [400] },
    )
    .toContain('→ hit');

  await expect(page.locator('.hand-cards').first()).toHaveText(before ?? '');
  await expect(page.locator('.overlay-continue-btn')).toBeVisible();
});

/**
 * Acknowledging a correction by voice -- but only once the app has finished
 * reading it out.
 *
 * The app speaks the correction, which takes a few seconds, and the
 * microphone is deaf for exactly that long by design: a "yes" arriving mid
 * sentence is far more likely to be the app's own voice than the operator's.
 * So the spec says the word repeatedly until it lands, which is also what a
 * person does, and asserts that it eventually does.
 */
test('"yes" acknowledges a correction once the app has stopped talking', async ({ page }) => {
  await openTableWithVoice(page);
  await say(page, 'yes');
  await say(page, 'hit');
  await expect(page.locator('.overlay-continue-btn')).toBeVisible();

  await expect
    .poll(
      async () => {
        await say(page, 'yes');
        return page.locator('.overlay-continue-btn').count();
      },
      { timeout: 15_000, intervals: [400] },
    )
    .toBe(0);
});

/**
 * The failure that would otherwise be constant and self-sustaining: the app
 * reads the correction aloud -- "Wrong. You played Hit..." -- the car speaker
 * plays it, and the microphone takes its words as the answer to the next
 * question.
 *
 * A graded action is the table's real speaking moment: the deal itself
 * narrates nothing at default verbosity, so using it here would have tested
 * silence.
 */
test('the app does not play its own voice back as a command', async ({ page }) => {
  await openTableWithVoice(page);
  await say(page, 'yes');
  await say(page, 'hit');

  // The app is now reading the correction out.
  expect((await spoken(page)).length).toBeGreaterThan(0);

  await say(page, 'yes');
  await expect(page.locator('.voice-status-heard')).toContainText('the app was speaking');
});

test('switching voice off closes the microphone and the strip', async ({ page }) => {
  await openTableWithVoice(page);
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-btn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.voice-status')).toHaveCount(0);
});
