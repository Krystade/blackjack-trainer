import { test, expect, type Page } from '@playwright/test';
import { shownHandRightPlay, withProfile, withSettings } from './helpers';

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
 * Give the shown hand's basic-strategy play and return the card it promoted.
 *
 * The drill draws at random with no seed hook, and the E2 learning step
 * re-deals a missed card a few cards later, so "keep answering Stand until one
 * lands" can loop on Stand-is-wrong hands (each miss speaks a long correction
 * in eyes-free) until the test times out. Reading the hand and answering it
 * correctly makes one answer enough.
 *
 * `deliver` must not return until its answer has actually been recorded.
 */
async function answerCorrectly(
  page: Page,
  deliver: (play: string, before: number) => Promise<void>,
): Promise<StoredCard> {
  const play = await shownHandRightPlay(page);
  await deliver(play, await reviewCount(page));
  const hit = firstPromoted(await readFlashSr(page));
  if (!hit) throw new Error(`answered ${play} (the right play) but no card was promoted`);
  return hit;
}

/** Wait until one more review has been written than `before`. */
async function awaitReview(page: Page, before: number): Promise<void> {
  await expect.poll(() => reviewCount(page), { timeout: 10_000 }).toBeGreaterThan(before);
}

/**
 * Hard totals only, seeded rather than clicked.
 *
 * Keeps the dealt hands to plain two-card hard totals, which is the shape
 * shownHandRightPlay reads.
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

  const entry = await answerCorrectly(page, async (play, before) => {
    await page.locator('.action-bar button', { hasText: play }).click();
    await awaitReview(page, before);
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

  const entry = await answerCorrectly(page, async (play, before) => {
    // Zone layout from audio/zones.ts, as fractions of the pad's own rect:
    // quadrants for hit/stand/double/split, the centre circle for surrender.
    // Computed from the live rect, not a fixed viewport point: the pad starts
    // below the control strip, whose height is measured at runtime.
    const at: Record<string, [number, number]> = {
      Hit: [0.1, 0.1],
      Stand: [0.9, 0.1],
      Double: [0.1, 0.9],
      Split: [0.9, 0.9],
      Surrender: [0.5, 0.5],
    };
    const [fx, fy] = at[play];
    const box = await zonePad.boundingBox();
    if (!box) throw new Error('ZonePad has no bounding box');
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await awaitReview(page, before);
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
          // Safari fires audiostart right after start; without it the app waits out AUDIOSTART_GRACE_MS.
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
  await page.goto('/?e2e=1');
  await openFlashcards(page);
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  const entry = await answerCorrectly(page, async (play, before) => {
    // A word spoken while the app is talking is deliberately IGNORED -- that
    // guard is what stops the app grading its own correction as the next
    // answer -- so a single utterance is not enough here. Repeat until one is
    // actually heard, which is also what a real driver does.
    await expect
      .poll(
        async () => {
          await page.evaluate((word) => {
            const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } })
              .__rec;
            rec?.onresult?.({ results: [[{ transcript: word }]] });
          }, play.toLowerCase());
          return reviewCount(page);
        },
        { timeout: 20_000, intervals: [200] },
      )
      .toBeGreaterThan(before);
  });

  expect(entry.channels).toBe(3);
});
