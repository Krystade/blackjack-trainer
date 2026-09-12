import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * HOW the answer arrived, all the way from the screen to the schedule.
 *
 * The scheduler weighs the channel an answer came through (see
 * drills/spacedRepetition.ts's `CHANNEL_BASE_CAP`), and its unit tests pin
 * exactly what it does with one. What they cannot pin is that Drills.tsx
 * actually TELLS it -- the failure mode being a scheduler that reasons
 * perfectly about eyes-free and hands-free while every real answer arrives
 * labelled as a tap on the screen. These specs answer a card three ways and
 * read the persisted deck back.
 *
 * Bit 1 is eyes-free, bit 2 is hands-free (`channelBit`), so an ActionBar
 * click stores 0, a blind zone tap 1, and a spoken answer 3.
 */

const FLASH_SR_KEY = 'bjtrainer.flashsr.v1';

interface StoredCard {
  box: number;
  channels?: number;
  paceMs?: number;
}

async function readFlashSr(page: Page): Promise<Record<string, StoredCard>> {
  return page.evaluate((key) => {
    const json = window.localStorage.getItem(key);
    return json ? (JSON.parse(json) as Record<string, StoredCard>) : {};
  }, FLASH_SR_KEY);
}

/** Total reviews recorded across the deck — the honest "did an answer land". */
async function reviewCount(page: Page): Promise<number> {
  const deck = await readFlashSr(page);
  return Object.values(deck).reduce((n, c) => n + ((c as { reviews?: number }).reviews ?? 0), 0);
}

/**
 * The first cell that has been PROMOTED, i.e. answered correctly. Only a
 * correct answer records a channel, so this is what the assertions need.
 */
function firstPromoted(deck: Record<string, StoredCard>): StoredCard | undefined {
  return Object.values(deck).find((c) => c.box >= 1);
}

/**
 * Answer cards until one of them is right, and return its stored entry.
 *
 * The drill draws at random and there is no seed hook, so which card comes up
 * cannot be chosen -- but "keep answering Stand until one lands" is
 * deterministic in its OUTCOME, which is all these assertions need. Stand is
 * correct across a large share of the chart, so this settles in a handful of
 * cards; the cap exists so a genuine wiring break fails loudly, with a message
 * saying which half broke, instead of hanging.
 *
 * `deliver` must not return until its answer has actually been recorded --
 * each input path has its own reason an attempt can be swallowed, and only the
 * caller knows how to retry it.
 */
async function answerUntilCorrect(
  page: Page,
  deliver: (before: number) => Promise<void>,
): Promise<StoredCard> {
  for (let i = 0; i < 30; i++) {
    await deliver(await reviewCount(page));
    const hit = firstPromoted(await readFlashSr(page));
    if (hit) return hit;
  }
  throw new Error('30 answers of "stand" and none was correct — is the deck being written at all?');
}

/** Wait until one more review has been written than `before`. */
async function awaitReview(page: Page, before: number): Promise<void> {
  await expect.poll(() => reviewCount(page), { timeout: 10_000 }).toBeGreaterThan(before);
}

/**
 * Hard totals only, seeded rather than clicked.
 *
 * Stand is the right play on roughly two in five hard cells (every 17+, and
 * 12-16 against a small card), so the hunt above settles in a card or two
 * instead of a dozen. Across the whole chart it would still terminate, just
 * slowly enough to fight the test timeout on the paths that speak.
 */
const HARD_ONLY = { drill: { flashCategory: 'hard' } };

async function openFlashcards(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
}

/* ------------------------------------------------------------------ */

test('an ActionBar click is recorded as the screen channel', async ({ page }) => {
  test.setTimeout(120_000);
  await withProfile(page);
  await withSettings(page, HARD_ONLY);
  await page.goto('/?e2e=1');
  await openFlashcards(page);

  const entry = await answerUntilCorrect(page, async (before) => {
    await page.locator('.action-bar button', { hasText: 'Stand' }).click();
    await awaitReview(page, before);
    // Eyes-on mode waits for a tap; clear the correction before the next card.
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (await next.isVisible().catch(() => false)) await next.click();
  });

  expect(entry.channels).toBe(0); // neither eyes-free nor hands-free
  // And the clock ran: a paceMs of 0 would mean the elapsed time never made it
  // through, which is the other half of the same wiring.
  expect(entry.paceMs).toBeGreaterThan(0);
});

/**
 * The blind pad: the screen is not being looked at, but it is being touched.
 * Half credit, and the scheduler has to know it is only half.
 */
test('a blind zone tap is recorded as eyes-free but hands-on', async ({ page }) => {
  test.setTimeout(120_000);
  await withProfile(page);
  await withSettings(page, { ...HARD_ONLY, audio: { enabled: true, answerPauseMs: 0 } });
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await page.getByLabel('Eyes-free audio').check();
  const zonePad = page.locator('.zone-pad');
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible();

  const entry = await answerUntilCorrect(page, async (before) => {
    // Top-RIGHT quadrant of the pad's own rect is 'stand' (audio/zones.ts).
    // Computed from the live rect, not a fixed viewport point: the pad starts
    // below the control strip, whose height is measured at runtime.
    const box = await zonePad.boundingBox();
    if (!box) throw new Error('ZonePad has no bounding box');
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);
    await awaitReview(page, before);
    // Eyes-free auto-advances, but only once it has finished SPEAKING the
    // correction, and a wrong answer's correction is a long sentence. The
    // generous window is not slack -- it is the length of the sentence.
    await expect(page.locator('.zone-pad-quadrants')).toBeVisible({ timeout: 20_000 });
  });

  expect(entry.channels).toBe(1);
});

/**
 * The only channel that survives a steering wheel, and the only one the
 * scheduler will let reach the top of the ladder.
 */
test('a spoken answer is recorded as both eyes-free and hands-free', async ({ page }) => {
  test.setTimeout(120_000);
  await withProfile(page);
  await withSettings(page, { ...HARD_ONLY, audio: { enabled: true, answerPauseMs: 0 } });
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
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  const entry = await answerUntilCorrect(page, async (before) => {
    // A word spoken while the app is talking is deliberately IGNORED -- that
    // guard is what stops the app grading its own correction as the next
    // answer -- so a single utterance is not enough here. Repeat until one is
    // actually heard, which is also what a real driver does.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } })
              .__rec;
            rec?.onresult?.({ results: [[{ transcript: 'stand' }]] });
          });
          return reviewCount(page);
        },
        { timeout: 20_000, intervals: [200] },
      )
      .toBeGreaterThan(before);
  });

  expect(entry.channels).toBe(3);
});
