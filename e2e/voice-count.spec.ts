import { test, expect, type Page } from '@playwright/test';

/**
 * Answering the count check out loud.
 *
 * The count was the one thing kept typed, and for a real reason: a misheard
 * "hit" costs a hand and is obvious, while a misheard count silently corrupts
 * the session's score. What makes speaking it safe is that nothing is
 * submitted on hearing it -- a number is a PROPOSAL, read back and confirmed,
 * so a bad digit costs one "no".
 *
 * The app speaks at every step here (the prompt, each read-back), and the
 * microphone is deliberately deaf while it does. So each spec waits the
 * utterance out rather than firing transcripts back to back, which is also
 * what a person does.
 */

const COUNT_EVERY_ROUND = 1;

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

/** The count check interval lives on the PROFILE, not on settings. */
async function countCheckEveryRound(page: Page): Promise<void> {
  await page.addInitScript((every) => {
    const raw = localStorage.getItem('bjtrainer.profiles.v1');
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { profiles?: unknown[] }).profiles ?? []);
    for (const p of list as Array<Record<string, unknown>>) p.countCheckEvery = every;
    localStorage.setItem('bjtrainer.profiles.v1', JSON.stringify(parsed));
  }, COUNT_EVERY_ROUND);
}

async function openCountCheck(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?seed=102&e2e=1');
  // Seeded on the first visit; applied on the second, once a profile exists.
  await countCheckEveryRound(page);
  await page.goto('/?seed=102&e2e=1');

  await page.getByRole('button', { name: 'Play a shoe' }).click();
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  await page.locator('.deal-btn').click();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible();
}

/**
 * Say something, having first waited out whatever the app is saying.
 *
 * The wait is not padding: the microphone ignores everything while the app
 * talks, so a transcript fired immediately would be discarded and the spec
 * would be testing suppression rather than the count loop.
 */
async function sayWhenListening(
  page: Page,
  transcript: string,
  alternatives: string[] = [],
): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(({ text, alts }) => {
          const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
          // The winner plus the readings ranked below it, as a real engine
          // hands them over in one result.
          const readings = [{ transcript: text }, ...alts.map((a) => ({ transcript: a }))];
          rec?.onresult?.({ results: [readings] });
        }, { text: transcript, alts: alternatives });
        return page.locator('.voice-status-heard').textContent();
      },
      { timeout: 15_000, intervals: [400] },
    )
    .not.toContain('the app was speaking');
}

test('a spoken count becomes a proposal, not an answer', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'minus three');

  await expect(page.locator('.count-voice-value')).toHaveText('-3');
  // Still open: hearing it is not the same as answering it.
  await expect(page.locator('.count-voice')).toBeVisible();
});

/**
 * The operator's shorthand: nudge the standing value by one per word, so
 * three taps up become "plus plus plus".
 */
test('"plus" and "minus" nudge the proposal by one each', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'minus three');
  await expect(page.locator('.count-voice-value')).toHaveText('-3');

  await sayWhenListening(page, 'plus');
  await expect(page.locator('.count-voice-value')).toHaveText('-2');

  await sayWhenListening(page, 'plus plus');
  await expect(page.locator('.count-voice-value')).toHaveText('+0');
});

/**
 * The ordering rule. Parsing runs before the yes/no vocabulary, so a
 * correction sets the value rather than clearing it -- matching "no" first
 * would throw away the number the operator was in the middle of giving.
 */
test('"no, minus three" corrects the value instead of clearing it', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'seven');
  await expect(page.locator('.count-voice-value')).toHaveText('+7');

  await sayWhenListening(page, 'no minus three');
  await expect(page.locator('.count-voice-value')).toHaveText('-3');
});

test('a bare "no" clears the proposal and asks again', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'minus three');
  await expect(page.locator('.count-voice-value')).toHaveText('-3');

  await sayWhenListening(page, 'no');
  await expect(page.locator('.count-voice-value')).toHaveCount(0);
  await expect(page.locator('.count-voice')).toBeVisible();
});

test('"yes" submits the proposal and the prompt closes', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'two');
  await expect(page.locator('.count-voice-value')).toHaveText('+2');

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.count-voice')).toHaveCount(0);
});

/**
 * Confirming nothing must not submit anything. A "yes" that landed on an
 * empty proposal would answer the check with a number nobody said, which is
 * precisely the corruption the read-back exists to prevent.
 */
test('"yes" with nothing proposed submits nothing', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'yes');

  await expect(page.locator('.voice-status-heard')).toContainText('nothing to confirm');
  await expect(page.locator('.count-voice')).toBeVisible();
});

/**
 * The prompt owns the microphone while it is open. A stray command must not
 * play the hand waiting behind it.
 */
test('a play command does not reach the table behind the prompt', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'hit');

  await expect(page.locator('.voice-status-heard')).toContainText('not a count');
  await expect(page.locator('.count-voice')).toBeVisible();
});

test('the keypad stays, so a refused microphone is never a dead end', async ({ page }) => {
  await openCountCheck(page);
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible();
});

/**
 * A number gets ranked the same way a word does.
 *
 * The drive of 2026-09-10 showed the engine putting the right command behind
 * an ordinary English word ("Band" winning over "Stand"). A running count is
 * worse to lose than a hand: it is harder to say again, and getting it wrong
 * is the whole thing the drill is training.
 */
test('a count ranked second is still heard', async ({ page }) => {
  await openCountCheck(page);
  // The winner is not a number at all -- the parser already forgives "tree"
  // and "free" for three, so a near-miss there would prove nothing. This one
  // is only reachable through the runner-up.
  await sayWhenListening(page, 'my nurse tea', ['minus three']);

  await expect(page.locator('.count-voice-value')).toHaveText('-3');
});

test('a confirmation ranked second still confirms', async ({ page }) => {
  await openCountCheck(page);
  await sayWhenListening(page, 'minus three');
  await expect(page.locator('.count-voice-value')).toHaveText('-3');

  await sayWhenListening(page, 'yeh', ['yes']);
  await expect(page.locator('.count-voice')).toBeHidden();
});
