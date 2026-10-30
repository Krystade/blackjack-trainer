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
 *
 * Fix round 1 (review): a recount is only a recount if the answer has not
 * been given. Tapping, a wrong count's answer is WITHHELD -- not on screen,
 * not said -- and the deal it was asked on waits. The sheet offers Rewind
 * (from +2, round 2's five cards again, then the question) and Show count;
 * its Deal shows the count and deals in one tap. The recount's verdict gives
 * the answer either way. Eyes-free, as before: the answer is said and play
 * goes on, Rewind offered beside it.
 */

test.use({ viewport: { width: 375, height: 812 } });

const ROUND2 = ['7d', '4c', '8s', '10h', '4s'];
const ANSWER = 'The count is plus three.';
const FROM = 'Running count plus two.';
const PROMPT = "What's the running count?";

async function enter(page: Page, n: number): Promise<void> {
  const pad = page.locator('.numpad');
  for (const d of String(Math.abs(n))) await pad.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
  if (n < 0) await pad.getByRole('button', { name: 'Plus or minus' }).click();
  await pad.locator('.numpad-ok').click();
}

const deal = (page: Page) => page.locator('.action-bar').getByRole('button', { name: 'Deal', exact: true }).click();
const round = (page: Page) => page.locator('.topbar-stat', { hasText: /^Round / });

async function standOut(page: Page): Promise<void> {
  await resolveInsurance(page, false);
  const stand = page.getByRole('button', { name: 'Stand', exact: true });
  while (await stand.isVisible().catch(() => false)) await stand.click();
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

/** Through round 2 to its check, answered +9. Returns the speech log's length just before the answer. */
async function toTheWrongCheck(page: Page, voice = false): Promise<number> {
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
  const before = (await spoken(page)).length;
  await enter(page, 9);
  return before;
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

/** Nothing on the page or in the voice gives the true count away, and the deal waits. */
async function expectWithheld(page: Page, spokenFrom: number): Promise<void> {
  await expect(page.getByTestId('count-held')).toBeVisible();
  await expect(page.getByTestId('count-held-verdict')).toHaveText('Count ✗ you said +9');
  expect(await page.locator('body').innerText()).not.toMatch(/it was|\+3\b/);
  expect((await spoken(page)).slice(spokenFrom)).not.toContain(ANSWER);
  // The peek would give it away too.
  await expect(page.locator('.peek-hold-btn')).toHaveCount(0);
  // Round 2 is still the round on the felt: nothing dealt, nothing to play.
  await expect(round(page)).toHaveText('Round 2');
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toHaveCount(0);
}

/** Is the element what a tap at its centre lands on, and wholly on screen? */
const hit = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      hit: top === el || el.contains(top),
      onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      cy: r.top + r.height / 2,
      vh: innerHeight,
    };
  });

test('tapping, a wrong count is withheld and the deal waits; Rewind replays from the last right count, and the recount gives the answer', async ({ page }) => {
  const before = await toTheWrongCheck(page);
  await expectWithheld(page, before);

  await recordReplay(page);
  await page.getByTestId('count-rewind').click();
  const sheet = page.getByTestId('rewind-sheet');
  await expect(sheet).toHaveAttribute('data-stage', 'replay');
  // From the count last had right, shown and said before the cards.
  await expect(page.getByTestId('rewind-from')).toHaveText('From +2');
  await expect(page.locator('.peek-hold-btn')).toHaveCount(0);
  await expect(sheet).toHaveAttribute('data-stage', 'ask', { timeout: 10_000 });
  expect(await replayed(page)).toEqual(ROUND2);
  await expect(page.getByTestId('rewind-from')).toHaveText('From +2');
  const said = (await spoken(page)).slice(before);
  expect(said).not.toContain(ANSWER);
  expect(said.indexOf(FROM), 'the start count is said').toBeGreaterThanOrEqual(0);
  expect(said.indexOf(FROM), 'before the first card').toBeLessThan(said.indexOf('seven'));
  // No live round under the recount.
  await expect(round(page)).toHaveText('Round 2');

  await enter(page, 3);
  await expect(page.getByTestId('rewind-verdict')).toHaveText('Recount ✓ +3');
  expect((await spoken(page)).slice(before)).toContain(ANSWER);
  // Deal: the recount closes and the next round is dealt, the whole verdict with it.
  await sheet.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(round(page)).toHaveText('Round 3');
  await resolveInsurance(page, false);
  await expect(page.locator('.result-strip', { hasText: 'Count ✗ you said +9, it was +3' })).toBeVisible();
  await expect(page.getByTestId('count-held')).toHaveCount(0);
  await expect(page.getByTestId('count-rewind')).toHaveCount(0);

  // The +9 stands in Stats; the recount added nothing.
  const stats = (await readStats(page)) as { categories: { countCheck: { right: number; wrong: number } } };
  expect(stats.categories.countCheck).toEqual({ right: 1, wrong: 1 });
  // And the diagnostic log shows the recount was used, and how it went.
  const stored = await page.evaluate(() => Object.values(localStorage).join('\n'));
  expect(stored).toMatch(/count rewind/);
});

test('Show count gives the answer and the deal still waits; Deal then deals', async ({ page }) => {
  const before = await toTheWrongCheck(page);
  await expectWithheld(page, before);
  await page.getByTestId('count-show').click();
  await expect(page.getByTestId('count-held-verdict')).toHaveText('Count ✗ you said +9, it was +3');
  expect((await spoken(page)).slice(before)).toContain(ANSWER);
  // Given away: no Rewind now, and the peek is back.
  await expect(page.getByTestId('count-rewind')).toHaveCount(0);
  await expect(page.locator('.peek-hold-btn')).toHaveCount(1);
  await expect(round(page)).toHaveText('Round 2');
  await page.getByTestId('count-held-deal').click();
  await expect(round(page)).toHaveText('Round 3');
  await expect(page.getByTestId('count-held')).toHaveCount(0);
});

test('Deal gives the answer and deals, in one tap', async ({ page }) => {
  const before = await toTheWrongCheck(page);
  await expectWithheld(page, before);
  await page.getByTestId('count-held-deal').click();
  await expect(round(page)).toHaveText('Round 3');
  await resolveInsurance(page, false);
  await expect(page.getByTestId('count-held')).toHaveCount(0);
  await expect(page.locator('.result-strip', { hasText: 'Count ✗ you said +9, it was +3' })).toBeVisible();
  expect((await spoken(page)).slice(before)).toContain(ANSWER);
});

test('Close mid-replay keeps the answer back and the offer up; a wrong recount gives the answer too', async ({ page }) => {
  const before = await toTheWrongCheck(page);
  await page.getByTestId('count-rewind').click();
  const sheet = page.getByTestId('rewind-sheet');
  await expect(sheet).toHaveAttribute('data-stage', 'replay');
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expectWithheld(page, before);
  await page.getByTestId('count-rewind').click();
  await expect(sheet).toHaveAttribute('data-stage', 'ask', { timeout: 10_000 });
  await enter(page, -1);
  await expect(page.getByTestId('rewind-verdict')).toHaveText('Recount ✗ you said −1, it was +3');
  await sheet.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(round(page)).toHaveText('Round 3');
});

test('a right count offers no Rewind and holds nothing', async ({ page }) => {
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
  await expect(page.getByTestId('count-held')).toHaveCount(0);
  await expect(round(page)).toHaveText('Round 2');
});

test('320x568: the offer is in the thumb zone, on screen, and a tap lands on it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await toTheWrongCheck(page);
  await expect(page.getByTestId('count-held')).toBeVisible();
  for (const id of ['count-held-verdict', 'count-rewind', 'count-show', 'count-held-deal']) {
    const h = await hit(page, id);
    expect(h.onScreen, `${id} on screen`).toBe(true);
    expect(h.hit, `${id} is what a tap at its centre reaches`).toBe(true);
    if (id !== 'count-held-verdict') expect(h.cy, `${id} in the thumb zone`).toBeGreaterThan(h.vh * 0.6);
  }
});

test('the replay waits for each line to be said, and asks only after the last', async ({ page }) => {
  // Every line takes 700ms to say; the deal beat is 300ms.
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eSpeechDelayMs: number; __speechLog: string[]; __speechAt: number[] };
    w.__e2eSpeechDelayMs = 700;
    const log: string[] = [];
    const at: number[] = [];
    log.push = (...items: string[]) => {
      for (let i = 0; i < items.length; i++) at.push(performance.now());
      return Array.prototype.push.apply(log, items);
    };
    w.__speechLog = log;
    w.__speechAt = at;
  });
  const before = await toTheWrongCheck(page);
  await page.getByTestId('count-rewind').click();
  await expect(page.getByTestId('rewind-sheet')).toHaveAttribute('data-stage', 'ask', { timeout: 15_000 });
  const { log, at } = await page.evaluate(() => {
    const w = window as unknown as { __speechLog: string[]; __speechAt: number[] };
    return { log: [...w.__speechLog], at: [...w.__speechAt] };
  });
  // Words only: the chime before the question is logged too, and is not a line.
  const words = log.map((text, i) => ({ text, at: at[i]! })).slice(before).filter((e) => !e.text.startsWith('chime:'));
  const start = words.findIndex((e) => e.text === FROM);
  const ask = words.findIndex((e, i) => i > start && e.text === PROMPT);
  expect(start, JSON.stringify(words.map((e) => e.text))).toBeGreaterThan(-1);
  expect(ask, JSON.stringify(words.map((e) => e.text))).toBeGreaterThan(start);
  expect(words.slice(start, ask + 1).map((e) => e.text), 'from, the five ranks, the question').toEqual([FROM, 'seven', 'four', 'eight', 'ten', 'four', PROMPT]);
  for (let i = start + 1; i <= ask; i++) {
    const gap = Math.round(words[i]!.at - words[i - 1]!.at);
    expect(gap, `"${words[i]!.text}" came ${gap}ms after "${words[i - 1]!.text}"`).toBeGreaterThanOrEqual(650);
  }
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


test('eyes-free, as before: the answer is said and play goes on; "rewind" replays from +2, and "yes" closes the recount', async ({ page }) => {
  await withFakeEngine(page);
  const before = await toTheWrongCheck(page, true);
  await expect(page.locator('.result-strip', { hasText: 'Count ✗ you said +9, it was +3' })).toBeVisible();
  expect((await spoken(page)).slice(before)).toContain(ANSWER);
  await expect(page.getByTestId('count-held')).toHaveCount(0);
  await resolveInsurance(page, false);
  await recordReplay(page);
  const offer = page.getByTestId('count-rewind');
  await expect(offer).toBeVisible();
  await sayOnceListening(page, 'rewind');
  const sheet = page.getByTestId('rewind-sheet');
  await expect(page.getByTestId('rewind-from')).toHaveText('From +2');
  await expect(sheet).toHaveAttribute('data-stage', 'ask', { timeout: 10_000 });
  expect(await replayed(page)).toEqual(ROUND2);
  await sayOnceListening(page, 'plus three');
  await expect(sheet.locator('.count-voice-value')).toHaveText('+3');
  await sayOnceListening(page, 'yes');
  await expect(page.getByTestId('rewind-verdict')).toHaveText('Recount ✓ +3');
  await sayOnceListening(page, 'yes');
  await expect(sheet).toHaveCount(0);
  await expect(offer).toHaveCount(0);
});

test('eyes-free at 320x568: the Rewind offer sits in the dock, where a tap reaches it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await withFakeEngine(page);
  await toTheWrongCheck(page, true);
  await resolveInsurance(page, false);
  await expect(page.getByTestId('count-rewind')).toBeVisible();
  const h = await hit(page, 'count-rewind');
  expect(h.onScreen, 'on screen').toBe(true);
  expect(h.hit, 'a tap reaches it').toBe(true);
});
