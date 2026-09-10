import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * The count drill, answered out loud.
 *
 * Eyes-free was already the driving mode: it speaks the cards, speaks the
 * answer, and asks "Did you have it?" -- and then required a TAP to answer
 * that question, which is the one thing the mode exists to avoid. The same
 * gap sat on strict mode, where the verdict is real but only a keypad could
 * produce it.
 *
 * So voice is wired to the drill's phases: "yes" starts a run, a spoken
 * number proposes an answer, "yes" confirms it, and "yes" claims the
 * self-check. Nothing is submitted on hearing it -- a count is a PROPOSAL,
 * read back first, because a misheard digit would otherwise score a run
 * against an answer nobody gave.
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

/**
 * Say something, having first waited out whatever the app is saying.
 *
 * Not padding: the microphone is deliberately deaf while the app talks, so a
 * transcript fired immediately would be recorded as suppressed and the spec
 * would be measuring that instead of the drill.
 */
async function sayWhenListening(
  page: Page,
  transcript: string,
  alternatives: string[] = [],
): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(
          ({ text, alts }) => {
            const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
            const readings = [{ transcript: text }, ...alts.map((a) => ({ transcript: a }))];
            rec?.onresult?.({ results: [readings] });
          },
          { text: transcript, alts: alternatives },
        );
        return page.locator('.voice-status-heard').textContent();
      },
      { timeout: 15_000, intervals: [400] },
    )
    .not.toContain('the app was speaking');
}

async function spoken(page: Page): Promise<string> {
  const log = await page.evaluate(
    () => (window as unknown as { __speechLog?: string[] }).__speechLog ?? [],
  );
  return log.join(' | ');
}

/** Reaches the count drill's setup screen with the microphone on. */
async function openCountDrill(page: Page, opts: { eyesFree: boolean }): Promise<void> {
  await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    drill: { countLengthCards: 4, countGroup: 1, countIntervalMs: 0, countManual: false },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  if (opts.eyesFree) {
    await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  }
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

test('the drill offers voice, and the strip says it is listening', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await expect(page.locator('.voice-status-state')).toHaveText('Listening');
});

test('"yes" starts a run without touching Start', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await expect(page.locator('.count-setup')).toBeVisible();

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.count-setup')).toHaveCount(0);
});

/**
 * The whole point in a car: the drill asks out loud, and the answer is a
 * word rather than a tap on a zone you cannot look at.
 */
test('"yes" claims the eyes-free self-check', async ({ page }) => {
  await openCountDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result .result-correct')).toHaveText('Correct!');
});

test('"no" reports a miss and is graded as wrong', async ({ page }) => {
  await openCountDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I missed it' })).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'no');
  await expect(page.locator('.drill-result .result-wrong')).toHaveText('Wrong');
});

/** A spoken self-report has to reach Stats, or car practice stays invisible. */
test('a spoken self-report is written to the count history', async ({ page }) => {
  await openCountDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 15_000 });

  const before = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.countDrill?.history
        ?.length ?? 0,
  );
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toBeVisible();

  const after = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.countDrill?.history ??
      [],
  );
  expect(after.length).toBe(before + 1);
  expect(after.at(-1).correct).toBe(true);
});

test('"repeat" says the answer and the question again', async ({ page }) => {
  await openCountDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 15_000 });

  const before = (await spoken(page)).split('Did you have it?').length - 1;
  await sayWhenListening(page, 'say again');
  await expect
    .poll(async () => (await spoken(page)).split('Did you have it?').length - 1)
    .toBeGreaterThan(before);
});

/** The keypad half, spoken: the number is heard, read back, and not submitted. */
test('a spoken count becomes a proposal, not an answer', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'minus three');
  await expect(page.locator('.count-voice-value')).toHaveText('-3');
  // Still open: hearing it is not the same as answering it.
  await expect(page.locator('.numpad')).toBeVisible();
});

test('"plus" and "minus" nudge the proposal by one each', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'minus three');
  await expect(page.locator('.count-voice-value')).toHaveText('-3');
  await sayWhenListening(page, 'plus plus');
  await expect(page.locator('.count-voice-value')).toHaveText('-1');
});

test('"yes" submits the proposal and the run is graded', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'minus three');
  await sayWhenListening(page, 'yes');

  await expect(page.locator('.drill-result')).toBeVisible();
  await expect(page.locator('.drill-result .result-detail')).toContainText('You entered -3');
});

/**
 * Confirming nothing must not submit anything. A "yes" landing on an empty
 * proposal would score the run against a number nobody said -- exactly the
 * corruption the read-back exists to prevent.
 */
test('"yes" with nothing proposed submits nothing', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toHaveCount(0);
  await expect(page.locator('.numpad')).toBeVisible();
  expect(await spoken(page)).toContain('I have no count yet');
});

test('a bare "no" clears the proposal and asks again', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'seven');
  await expect(page.locator('.count-voice-value')).toHaveText('+7');
  await sayWhenListening(page, 'no');
  await expect(page.locator('.count-voice-value')).toHaveCount(0);
  await expect(page.locator('.numpad')).toBeVisible();
});

/**
 * The runner-up rescue, end to end. "minus tree" is what a car microphone
 * actually returns for "minus three" -- but the top reading here is a
 * sentence that parses as nothing at all, and the count still lands.
 */
test('a count ranked second by the engine is still heard', async ({ page }) => {
  await openCountDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'my nurse tea', ['minus three']);
  await expect(page.locator('.count-voice-value')).toHaveText('-3');
});

/**
 * A run has to be repeatable without a tap, or the second lap of a drive
 * needs a phone in the hand again.
 */
test('"yes" on the result screen starts the next run', async ({ page }) => {
  await openCountDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 15_000 });
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toBeVisible();
  expect(await spoken(page)).toContain('Say yes to go again');

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toHaveCount(0);
});

/**
 * A number said while the cards are still flashing is a road sign, not an
 * answer. Proposing it would put a value in front of a question that has not
 * been asked yet.
 */
test('a number spoken mid-flash is not taken as an answer', async ({ page }) => {
  await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 },
    // Manual advance holds the flashing phase open, which is what this needs.
    drill: { countLengthCards: 26, countGroup: 1, countIntervalMs: 0, countManual: true },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.manual-tap-zone')).toBeVisible();

  await sayWhenListening(page, 'minus three');
  // Refused outright rather than quietly banked. Consuming it would also
  // read it back OUT LOUD, over the cards still being counted -- which is
  // the harm here, and the reason this is asserted on the verdict and the
  // speech log rather than on a proposal box that does not render in this
  // phase anyway.
  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  expect(await spoken(page)).not.toContain('Correct?');
  await expect(page.locator('.manual-tap-zone')).toBeVisible();
});
