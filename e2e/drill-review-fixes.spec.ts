import { test, expect, type Page } from '@playwright/test';
import { readStats, sayOnceListening, withStats } from './helpers';
import { EMPTY_STATS } from '../src/store/types';

/**
 * Wave-1 review fixes to the hand drills:
 *  (a) every graded path feeds the B1 strip, so it never shows an old hand;
 *  (b) with voice on, a tap answer's spoken correction is not cut off by the
 *      next card's prompt;
 *  (c) a bounced double tap does not grade a hand that was never seen.
 * (d), the rules chip, is pure and lives in src/drills/rulesChip.test.ts.
 */

/** A scriptable recogniser, as in voice-answers.spec.ts. */
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
      aborted = false;
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

async function openWithVoice(page: Page, drill: string): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: drill, exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

const openFlashcardsWithVoice = (page: Page) => openWithVoice(page, 'Flashcards');

/** The hand on screen as the strip writes it: "9,7 v 10", or "Insurance v A". */
async function handOnScreen(page: Page): Promise<string> {
  // An insurance item has no cards on the table, only its prompt.
  await expect(page.locator('.dealer-area .card-rank, .quiz-insurance-prompt').first()).toBeVisible();
  if (await page.locator('.quiz-insurance-prompt').isVisible()) return 'Insurance v A';
  const ranks = await page.locator('.hands-row .card-rank').allTextContents();
  const up = await page.locator('.dealer-area .card-rank').first().textContent();
  return `${ranks.join(',')} v ${up}`;
}

for (const drill of ['Flashcards', 'Deviation quiz', 'Mixed'] as const) {
  test(`(a) ${drill}: a voice answer in visual mode is the hand the strip shows next, not an older one`, async ({
    page,
  }) => {
    await openWithVoice(page, drill);
    const strip = page.locator('[data-testid="result-strip"]');

    // A tap answer puts hand 1 on the strip and deals hand 2.
    const first = await handOnScreen(page);
    await page.locator('.action-bar button:not([disabled])').first().click();
    await expect(strip).toContainText(first);

    // Hand 2 answered by voice: the correction panel, then the advance.
    const second = await handOnScreen(page);
    // Once, when the app has stopped talking -- see sayOnceListening. An
    // insurance question takes yes/no, every other hand a play.
    await sayOnceListening(page, second.startsWith('Insurance') ? 'yes' : 'stand');
    const next = page.locator('.action-bar .drill-next-btn');
    await expect(next).toBeVisible();
    await next.click();

    await expect(strip).toContainText(second);
    // Vacuity guard: the two hands differ, or the assertion above proves nothing.
    if (first !== second) await expect(strip).not.toContainText(first);
  });
}

test('(b) with voice on, the next card waits for a tap answer\'s spoken correction', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.evaluate(() => {
    window.__speechOptsLog = [];
  });
  // The first answer of a session always speaks its correction, right or wrong.
  await page.locator('.action-bar button', { hasText: 'Hit' }).click();

  const lines = async () =>
    (await page.evaluate(() => window.__speechOptsLog ?? [])).filter((e) => !e.text.startsWith('chime:'));
  await expect.poll(async () => (await lines()).length).toBeGreaterThanOrEqual(2);
  const [correction, prompt] = await lines();
  // The correction itself still cuts off whatever was playing...
  expect(correction!.interrupt).toBe(true);
  // ...and the next card's prompt queues behind it instead of cutting it off.
  expect(prompt!.text).not.toBe(correction!.text);
  expect(prompt!.interrupt).toBe(false);
});

function graded(stats: Record<string, unknown> | null): number {
  const categories = (stats?.categories ?? {}) as Record<string, { right: number; wrong: number }>;
  return Object.values(categories).reduce((n, t) => n + t.right + t.wrong, 0);
}

for (const drill of ['Flashcards', 'Deviation quiz', 'Mixed', 'Mastery challenge'] as const) {
  test(`(c) ${drill}: a double tap grades one hand, not the one dealt under the second touch`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__e2eAnswerBounceMs = 250;
    });
    await withStats(page, EMPTY_STATS as unknown as Record<string, unknown>);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: drill, exact: true }).click();
    // The hand on screen has been readable for longer than the guard.
    await page.waitForTimeout(400);

    await page.locator('.action-bar button:not([disabled])').first().dblclick();
    await expect.poll(async () => graded(await readStats(page))).toBe(1);
    await page.waitForTimeout(400);
    expect(graded(await readStats(page))).toBe(1);

    // Non-vacuity: an answer after the guard is taken.
    await page.locator('.action-bar button:not([disabled])').first().click();
    await expect.poll(async () => graded(await readStats(page))).toBe(2);
  });
}

test('(c) Pair cancellation: a double tap grades one pair', async ({ page }) => {
  await page.addInitScript(() => {
    window.__e2eAnswerBounceMs = 250;
  });
  await withStats(page, EMPTY_STATS as unknown as Record<string, unknown>);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Pair cancellation', exact: true }).click();
  await page.waitForTimeout(400);

  const pairs = async () =>
    ((await readStats(page))?.pairCancel as { history: unknown[] } | undefined)?.history.length ?? 0;
  await page.locator('.pair-cancel-answers button').first().dblclick();
  await expect.poll(pairs).toBe(1);
  await page.waitForTimeout(400);
  expect(await pairs()).toBe(1);

  await page.locator('.pair-cancel-answers button').first().click();
  await expect.poll(pairs).toBe(2);
});
