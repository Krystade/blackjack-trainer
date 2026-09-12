import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * D2: Countdown, from the driver's seat.
 *
 * Countdown deals fifty-one cards from a deck and asks which one never came
 * out. It was the one drill eyes-free could not reach: the cards advanced on a
 * TAP and the answer was a tap on one of three buttons, so the mode that
 * exists for people who cannot look at the screen was the mode it excluded.
 *
 * The operator's own description of what it should be: "the voice listing off
 * card values and me having to keep track". So the voice reads the deck at its
 * own pace, and the tag is spoken through the same propose-and-confirm gate
 * the running count already uses -- nothing is graded on hearing it once.
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

/** Say something, having first waited out whatever the app is saying. */
async function sayWhenListening(page: Page, transcript: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate((text) => {
          const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
          rec?.onresult?.({ results: [[{ transcript: text }]] });
        }, transcript);
        return page.locator('.voice-status-heard').textContent();
      },
      { timeout: 15_000, intervals: [300] },
    )
    .not.toContain('the app was speaking');
}

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
}

/** Countdown mode, eyes-free, microphone on, one tap from running. */
async function openCountdown(page: Page, opts: { voice?: boolean } = {}): Promise<void> {
  if (opts.voice) await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countIntervalMs: 0, countManual: false },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.locator('label', { hasText: 'Countdown' }).locator('input').check();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  if (opts.voice) {
    await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
    await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  }
}

/** The tag prompt is the marker that the deck has been read out. */
const TAG_PROMPT = 'Plus one, zero, or minus one?';

test('eyes-free is offered in Countdown at all', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.locator('label', { hasText: 'Countdown' }).locator('input').check();

  await expect(page.locator('label', { hasText: 'Eyes-free audio' })).toBeVisible();
  // Strict mode stays out: it swaps in a keypad, and this answer is three words.
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await expect(page.locator('label', { hasText: 'Strict mode' })).toHaveCount(0);
});

/**
 * The drill itself. Fifty-one cards have to be READ, not tapped through --
 * a tap per card is exactly what the mode cannot ask for.
 */
test('the voice reads the whole deck without a single tap, then asks for the tag', async ({
  page,
}) => {
  await openCountdown(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect
    .poll(async () => (await spoken(page)).includes(TAG_PROMPT), { timeout: 30_000 })
    .toBe(true);

  const log = await spoken(page);
  const prompt = log.indexOf(TAG_PROMPT);
  // Every card before the prompt, and there are fifty-one of them. A
  // tap-driven mode would have stopped dead on the first one.
  expect(prompt).toBe(51);
});

test('a spoken tag is read back and only graded once confirmed', async ({ page }) => {
  await openCountdown(page, { voice: true });
  await sayWhenListening(page, 'yes'); // starts the run
  await expect(page.locator('.tag-guess')).toBeVisible({ timeout: 30_000 });

  await sayWhenListening(page, 'minus one');
  // Proposed, not graded: the read-back is what makes a three-way choice safe
  // to answer by voice.
  await expect
    .poll(async () => (await spoken(page)).some((l) => l === 'minus 1. Correct?'))
    .toBe(true);
  await expect(page.locator('.tag-guess')).toBeVisible();

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toBeVisible();
  await expect
    .poll(async () => (await spoken(page)).some((l) => l.includes('The card left over was')))
    .toBe(true);
});

/**
 * A Hi-Lo tag is one of three numbers. A perfectly-heard "plus four" is not a
 * near miss, and proposing it would offer a value the confirm step could never
 * accept.
 */
test('a number that is not a tag is refused rather than proposed', async ({ page }) => {
  await openCountdown(page, { voice: true });
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.tag-guess')).toBeVisible({ timeout: 30_000 });

  await sayWhenListening(page, 'plus four');
  await expect
    .poll(async () => (await spoken(page)).some((l) => l.includes('is not a tag')))
    .toBe(true);

  // And "yes" now has nothing to confirm, rather than confirming the four.
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.tag-guess')).toBeVisible();
  await expect
    .poll(async () => (await spoken(page)).some((l) => l.startsWith('I have no tag yet')))
    .toBe(true);
});

/** The run has to reach Stats, or practice done in the car stays invisible. */
test('a spoken countdown answer is recorded', async ({ page }) => {
  await openCountdown(page, { voice: true });
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.tag-guess')).toBeVisible({ timeout: 30_000 });

  const before = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.countDrill?.history
        ?.length ?? 0,
  );

  await sayWhenListening(page, 'zero');
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toBeVisible();

  const after = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.countDrill?.history ??
      [],
  );
  expect(after.length).toBe(before + 1);
});
