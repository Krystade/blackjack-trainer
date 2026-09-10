import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * The true-count drill, answered out loud.
 *
 * Same shape as the count drill, for the same reason: eyes-free spoke a
 * question into the car and then wanted a keypad. The answer is a number, so
 * it is a PROPOSAL -- read back before anything is submitted, because a
 * misheard digit would otherwise score the attempt against an answer nobody
 * gave.
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

/** Say something, having first waited out whatever the app is saying. */
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

async function openTcDrill(page: Page, opts: { eyesFree: boolean }): Promise<void> {
  await withFakeEngine(page);
  await withProfile(page);
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', answerPauseMs: 0 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
  if (opts.eyesFree) await page.getByLabel('Eyes-free audio').check();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

/** The correct answer to the question currently on screen. */
async function correctTc(page: Page): Promise<number> {
  const rc = Number(
    ((await page.locator('.quiz-tc').textContent()) ?? '').replace(/[^-\d]/g, ''),
  );
  const decks = Number(
    ((await page.locator('.tag-guess-label').textContent()) ?? '').replace(/[^\d.]/g, ''),
  );
  return Math.round(rc / decks);
}

test('"yes" starts a question without touching Start', async ({ page }) => {
  await openTcDrill(page, { eyesFree: false });
  await expect(page.locator('.count-setup')).toBeVisible();

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.count-setup')).toHaveCount(0);
});

test('a spoken true count becomes a proposal, not an answer', async ({ page }) => {
  await openTcDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible();

  await sayWhenListening(page, 'minus two');
  await expect(page.locator('.count-voice-value')).toHaveText('-2');
  await expect(page.locator('.numpad')).toBeVisible();
});

test('"yes" submits the proposal and the attempt is graded', async ({ page }) => {
  await openTcDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible();

  const answer = await correctTc(page);
  await sayWhenListening(page, String(answer));
  await sayWhenListening(page, 'yes');

  await expect(page.locator('.drill-result .result-correct')).toHaveText('Correct!');
  const history = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.trueCount?.history ?? [],
  );
  expect(history.at(-1).guess).toBe(answer);
});

test('"yes" with nothing proposed submits nothing', async ({ page }) => {
  await openTcDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible();

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toHaveCount(0);
  expect(await spoken(page)).toContain('I have no true count yet');
});

test('a bare "no" clears the proposal and asks the question again', async ({ page }) => {
  await openTcDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible();

  await sayWhenListening(page, 'four');
  await expect(page.locator('.count-voice-value')).toHaveText('+4');
  await sayWhenListening(page, 'no');
  await expect(page.locator('.count-voice-value')).toHaveCount(0);
  await expect(page.locator('.numpad')).toBeVisible();
});

/** The runner-up rescue: the winning reading parses as nothing at all. */
test('a true count ranked second by the engine is still heard', async ({ page }) => {
  await openTcDrill(page, { eyesFree: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.count-voice')).toBeVisible();

  await sayWhenListening(page, 'my nurse tea', ['minus three']);
  await expect(page.locator('.count-voice-value')).toHaveText('-3');
});

test('"yes" claims the eyes-free self-check', async ({ page }) => {
  await openTcDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result .result-correct')).toHaveText('Correct!');
});

test('a spoken self-report is recorded, and states no guess', async ({ page }) => {
  await openTcDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I missed it' })).toBeVisible({ timeout: 15_000 });

  await sayWhenListening(page, 'no');
  await expect(page.locator('.drill-result .result-wrong')).toHaveText('Wrong');

  const history = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? '{}')?.trueCount?.history ?? [],
  );
  expect(history).toHaveLength(1);
  expect(history[0].correct).toBe(false);
  expect(history[0].guess).toBeUndefined();
});

test('"yes" on the result screen asks the next question', async ({ page }) => {
  await openTcDrill(page, { eyesFree: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I had it' })).toBeVisible({ timeout: 15_000 });
  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toBeVisible();
  expect(await spoken(page)).toContain('Say yes for the next one');

  await sayWhenListening(page, 'yes');
  await expect(page.locator('.drill-result')).toHaveCount(0);
});
