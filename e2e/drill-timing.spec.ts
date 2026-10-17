import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip, readStats, waitForMic, withProfile, withSettings } from './helpers';

/**
 * Wave A F3 + s09: when the hand drills' clocks start and stop.
 *
 * - The answer clock starts when a spoken prompt has finished, not when the
 *   card was drawn (eyes-free / voice).
 * - The shot clock is suspended eyes-free and by voice.
 * - After a miss in visual mode the next card's clock waits for the
 *   correction to be read.
 * - Two unanswered cards in a row stop the clock instead of grading a miss
 *   for every card that goes by with nobody there.
 */

async function openFlashcards(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
}

function timeouts(stats: Record<string, unknown> | null): number {
  return ((stats?.mistakes as Record<string, number> | undefined)?.timeout) ?? 0;
}

test('the shot clock stops after a timeout and a second unanswered card, and an answer restarts it', async ({ page }) => {
  test.setTimeout(40_000);
  await withSettings(page, { drill: { shotClockMs: 3000 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  // First expiry: graded, as before.
  await expect(page.locator('[data-testid="result-strip"][data-tone="miss"]')).toBeVisible({ timeout: 8000 });
  const firstAt = Date.now();
  expect(timeouts(await readStats(page))).toBe(1);

  // The card dealt under that miss gets reading time before its clock runs:
  // no expiry at the bare 3s mark.
  await expect(page.getByTestId('shot-clock').locator('.shot-clock-fill')).toHaveAttribute('data-delay-ms', '2500');
  await page.waitForTimeout(Math.max(0, 3700 - (Date.now() - firstAt)));
  await expect(page.getByTestId('shot-clock-idle')).toHaveCount(0);

  // Second expiry in a row: nobody is there. Not graded; the clock stops.
  await expect(page.getByTestId('shot-clock-idle')).toBeVisible({ timeout: 6000 });
  expect(timeouts(await readStats(page)), 'the idle card must not be graded').toBe(1);
  // And it stays stopped.
  await page.waitForTimeout(3500);
  expect(timeouts(await readStats(page))).toBe(1);

  // An answer means somebody is back: the clock runs again on the next card.
  await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
  await expect(page.getByTestId('shot-clock-idle')).toHaveCount(0);
  await expect(page.getByTestId('shot-clock')).toBeVisible();
  // Wave A review: that answer was given with the clock stopped, so it is not
  // a timed one in Stats' split (the timeout before it carries no stamp).
  const split = (await readStats(page))!.shotClockSplit as { timed: { right: number; wrong: number }; untimed: { right: number; wrong: number } };
  expect(split.timed.right + split.timed.wrong).toBe(0);
  expect(split.untimed.right + split.untimed.wrong).toBe(1);
});

test('after a miss, the seconds spent reading the correction are not answer time', async ({ page }) => {
  test.setTimeout(60_000);
  await withProfile(page);
  await withSettings(page, { drill: { shotClockMs: 0, flashCategory: 'hard' } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  const stand = page.locator('.action-bar button.action-btn', { hasText: 'Stand' });
  // Answer Stand until one is a miss; the card dealt under it is the subject.
  let missed = false;
  for (let i = 0; i < 30 && !missed; i++) {
    await page.waitForTimeout(300);
    missed = (await answerAndReadStrip(page, stand)) === 'miss';
  }
  expect(missed, '30 answers of Stand and none was a miss').toBe(true);
  const before = ((await readStats(page))!.latencyHistory as unknown[]).length;
  // Read the correction for the grace, then answer: 4.2s after the deal.
  await page.waitForTimeout(4200);
  await answerAndReadStrip(page, stand);
  await expect.poll(async () => ((await readStats(page))!.latencyHistory as unknown[]).length).toBe(before + 1);
  const latency = (await readStats(page))!.latencyHistory as { elapsedMs: number }[];
  const last = latency[latency.length - 1]!.elapsedMs;
  // From the deal it is >= 4200 (hesitant, over FLUENT_MS 4000). With the
  // 2.5s reading grace off, about 1.7s -- floored at the grace itself.
  expect(last).toBeLessThan(3000);
  expect(last).toBeGreaterThanOrEqual(2500);
});

test('a right answer gives the next card no reading delay', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { drill: { shotClockMs: 60_000, flashCategory: 'hard' } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  // Answer Stand until one is right; check the delay that follows each.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    await page.locator('.action-bar button.action-btn', { hasText: 'Stand' }).click();
    const tone = await page.locator('[data-testid="result-strip"]').getAttribute('data-tone');
    const fill = page.getByTestId('shot-clock').locator('.shot-clock-fill');
    if (tone === 'miss') {
      await expect(fill).toHaveAttribute('data-delay-ms', '2500');
    } else {
      await expect(fill).not.toHaveAttribute('data-delay-ms', /.*/);
      return;
    }
  }
  throw new Error('30 answers of Stand and none was right');
});

test('eyes-free suspends the shot clock', async ({ page }) => {
  await withSettings(page, { drill: { shotClockMs: 3000 }, audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await expect(page.getByTestId('shot-clock')).toBeVisible();
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.getByTestId('shot-clock')).toHaveCount(0);
  await page.waitForTimeout(4500);
  expect(timeouts(await readStats(page))).toBe(0);
});

test('eyes-free: the answer clock starts when the spoken prompt ends', async ({ page }) => {
  test.setTimeout(40_000);
  await withProfile(page);
  await withSettings(page, { drill: { flashCategory: 'hard' }, audio: { enabled: true, answerPauseMs: 0 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible();
  // The prompt ("You have twelve. Dealer shows six.") is ~2s at the e2e
  // estimate. Answer well after it, 4s after the card was put up.
  await page.waitForTimeout(4000);
  const box = await page.locator('.zone-pad').boundingBox();
  if (!box) throw new Error('no zone pad');
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);
  await expect.poll(async () => ((await readStats(page))?.latencyHistory as unknown[] | undefined)?.length ?? 0).toBe(1);
  const latency = (await readStats(page))!.latencyHistory as { elapsedMs: number }[];
  // From the draw it would be >= 4000. From the prompt's end it is what is
  // left after the prompt: well under that.
  expect(latency[0]!.elapsedMs).toBeLessThan(3200);
  expect(latency[0]!.elapsedMs).toBeGreaterThan(0);
});

/** A scriptable SpeechRecognition (see voice-answers.spec.ts). */
async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      aborted = false;
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        this.aborted = false;
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, 0);
      }
      abort(): void {
        this.aborted = true;
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

test('voice-only Deviation quiz: the answer clock starts when the spoken prompt ends', async ({ page }) => {
  // Wave A review: with voice on and eyes-free off, the quiz prompt went
  // through sayFull with no end callback, so its seconds were answer time.
  test.setTimeout(40_000);
  await withFakeEngine(page);
  await withSettings(page, { drill: { quizIndex: '16v10' }, audio: { enabled: true, verbosity: 'full' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  const shownAt = Date.now();
  await waitForMic(page);
  // Answer well after the prompt: 4.5s after voice went on.
  await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - shownAt)));
  await waitForMic(page);
  const answeredAt = Date.now();
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: 'stand' }]] });
  });
  await expect.poll(async () => ((await readStats(page))?.latencyHistory as unknown[] | undefined)?.length ?? 0).toBe(1);
  const latency = (await readStats(page))!.latencyHistory as { elapsedMs: number }[];
  // From the draw (or voice going on) it would be >= 4500.
  expect(latency[0]!.elapsedMs).toBeLessThan(answeredAt - shownAt - 1000);
  expect(latency[0]!.elapsedMs).toBeGreaterThan(0);
});
