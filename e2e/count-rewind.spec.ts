import { test, expect, type Page } from '@playwright/test';
import { readStats, resolveInsurance, sayOnceListening, withProfile, withSettings } from './helpers';

/**
 * Wave X (item 2): "If I get the count wrong in play I'd like to rewind and
 * recount. Not forced but with the option."
 *
 * Seed 2, one hand, a count check every round, running count only:
 *   round 1: 6d 3c 8d Ad 4d, counted in that order (the hole, Ad, as it
 *            turns) -- the count is +2, answered right: the checkpoint.
 *   round 2: 7d 4c 8s 10h 4s -- the count is +3, answered +9: wrong.
 * Rewind replays round 2's five cards, in the order they were counted, a
 * deal beat apart -- not round 1's, which the right answer settled -- then
 * asks the count again. The +9 stays graded; the recount grades nothing.
 */

test.use({ viewport: { width: 375, height: 812 } });

const ROUND2 = ['7d', '4c', '8s', '10h', '4s'];

async function enter(page: Page, n: number): Promise<void> {
  const pad = page.locator('.numpad');
  for (const d of String(Math.abs(n))) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await pad.getByRole('button', { name: 'Plus or minus' }).click();
  await pad.locator('.numpad-ok').click();
}

const deal = (page: Page) => page.getByRole('button', { name: 'Deal', exact: true }).click();

async function standOut(page: Page): Promise<void> {
  await resolveInsurance(page, false);
  const stand = page.getByRole('button', { name: 'Stand', exact: true });
  while (await stand.isVisible().catch(() => false)) await stand.click();
}

async function toTheWrongCheck(page: Page, voice = false): Promise<void> {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 300, audio: { enabled: true, verbosity: 'full' } });
  await withProfile(page, {
    countCheckEvery: 1,
    countCheckAsk: 'running',
    seats: { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 },
  });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  if (voice) {
    await page.locator('.voice-btn').click();
    await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  }
  await deal(page);
  await standOut(page);
  await deal(page);
  await enter(page, 2);
  await expect(page.locator('.result-strip', { hasText: 'Count ✓ +2' })).toBeVisible();
  await standOut(page);
  await deal(page);
  await enter(page, 9);
  await expect(page.locator('.result-strip', { hasText: 'Count ✗ you said +9, it was +3' })).toBeVisible();
}

/** Record every card the Rewind puts up, in order. */
async function recordReplay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __replayed: string[] }).__replayed = seen;
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          const cards = n.matches('.card') ? [n] : [...n.querySelectorAll('.card')];
          for (const c of cards) if (c.closest('[data-testid="rewind-card"]')) seen.push(c.getAttribute('data-card') ?? '?');
        }
      }
    }).observe(document.body, { subtree: true, childList: true });
  });
}

const replayed = (page: Page) => page.evaluate(() => (window as unknown as { __replayed: string[] }).__replayed);

test('a wrong count offers Rewind: the cards since the last right count come back in order, then the count is asked again', async ({ page }) => {
  await toTheWrongCheck(page);
  // Not forced: the next round is dealt and played as ever, the offer beside it.
  const offer = page.getByTestId('count-rewind');
  await expect(offer).toBeVisible();
  await resolveInsurance(page, false);

  await recordReplay(page);
  const t0 = Date.now();
  await offer.click();
  const sheet = page.getByTestId('rewind-sheet');
  await expect(sheet).toHaveAttribute('data-stage', 'replay');
  // The count is not to be peeked mid-recount.
  await expect(page.locator('.peek-hold-btn')).toHaveCount(0);
  await expect(sheet).toHaveAttribute('data-stage', 'ask', { timeout: 10_000 });
  // At the deal pace: five cards and the beat after the last, 300ms each.
  expect(Date.now() - t0).toBeGreaterThanOrEqual(5 * 300 - 100);
  expect(await replayed(page)).toEqual(ROUND2);

  await enter(page, 3);
  await expect(page.getByTestId('rewind-verdict')).toHaveText('Recount ✓ +3');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  // Offered once: the recount is done.
  await expect(offer).toHaveCount(0);

  // The +9 stands in Stats; the recount added nothing.
  const stats = (await readStats(page)) as { categories: { countCheck: { right: number; wrong: number } } };
  expect(stats.categories.countCheck).toEqual({ right: 1, wrong: 1 });
});

test('Close mid-replay keeps the offer; a recount can be wrong too; the round underneath is untouched', async ({ page }) => {
  await toTheWrongCheck(page);
  await resolveInsurance(page, false);
  const offer = page.getByTestId('count-rewind');
  await offer.click();
  const sheet = page.getByTestId('rewind-sheet');
  await expect(sheet).toHaveAttribute('data-stage', 'replay');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(offer).toBeVisible();
  await offer.click();
  await expect(sheet).toHaveAttribute('data-stage', 'ask', { timeout: 10_000 });
  await enter(page, -1);
  await expect(page.getByTestId('rewind-verdict')).toHaveText('Recount ✗ you said −1, it was +3');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(offer).toHaveCount(0);
  // The hand underneath is still there to play.
  await expect(page.getByRole('button', { name: 'Stand', exact: true }).or(page.getByRole('button', { name: 'Deal', exact: true }))).toBeVisible();
});

test('a right count offers no Rewind', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 300 });
  await withProfile(page, {
    countCheckEvery: 1,
    countCheckAsk: 'running',
    seats: { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 },
  });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await deal(page);
  await standOut(page);
  await deal(page);
  await enter(page, 2);
  await expect(page.locator('.result-strip', { hasText: 'Count ✓ +2' })).toBeVisible();
  await expect(page.getByTestId('count-rewind')).toHaveCount(0);
});

/** The recogniser, faked as voice-table.spec.ts fakes it; `sayOnceListening` delivers a transcript. */
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
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        setTimeout(() => {
          this.onstart?.();
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

test('out loud: "rewind" replays, the recount is said and confirmed, and "yes" closes it', async ({ page }) => {
  await withFakeEngine(page);
  await toTheWrongCheck(page, true);
  await resolveInsurance(page, false);
  await recordReplay(page);
  await expect(page.getByTestId('count-rewind')).toBeVisible();
  await sayOnceListening(page, 'rewind');
  const sheet = page.getByTestId('rewind-sheet');
  await expect(sheet).toHaveAttribute('data-stage', 'ask', { timeout: 10_000 });
  expect(await replayed(page)).toEqual(ROUND2);
  await sayOnceListening(page, 'plus three');
  await expect(sheet.locator('.count-voice-value')).toHaveText('+3');
  await sayOnceListening(page, 'yes');
  await expect(page.getByTestId('rewind-verdict')).toHaveText('Recount ✓ +3');
  await sayOnceListening(page, 'yes');
  await expect(sheet).toHaveCount(0);
});
