import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * Wave X (item 1): "When sitting out, want the hands actually dealt like when
 * I play, not just spawned in."
 *
 * Out, the engine plays the whole round at once. The felt used to show it at
 * once too: the opening was staggered, but every bot's draws, the turned hole
 * card and the dealer's draws were all there from the first frame. Now they
 * come one deal beat apart, in the order the round was played: the opening
 * two passes, each bot's turn first base first, the hole card, the draws.
 *
 * Seed 2 with two bots, the player's seat (first base) empty, deals:
 *   P1 6d Ad, then hits 4c and stands;  P2 3c 4d, then hits 8s and 10h (bust);
 *   dealer 8d up, 7d in the hole, draws 4s.
 * The page clock is fake, so every beat is exact.
 */

test.use({ viewport: { width: 375, height: 812 } });

const BEAT = 1000;
const OPENING = 6; // P1, P2, dealer up; P1, P2, hole.

type Felt = { p1: string[]; p2: string[]; dealer: string[]; markers: number; lines: string[] };

const felt = (page: Page): Promise<Felt> =>
  page.evaluate(() => {
    const cards = (root: Element | null | undefined) =>
      [...(root?.querySelectorAll('.card') ?? [])].map((c) => c.getAttribute('data-card') ?? 'down');
    const seats = document.querySelectorAll('.bot-seat');
    return {
      p1: cards(seats[0]),
      p2: cards(seats[1]),
      dealer: cards(document.querySelector('.dealer-area')),
      markers: document.querySelectorAll('.bot-result-marker').length,
      lines: [...document.querySelectorAll('.message-bot-narration')].map((l) => l.textContent ?? ''),
    };
  });

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

async function dealOut(page: Page, dealSpeedMs = BEAT): Promise<void> {
  await page.clock.install();
  await withSettings(page, { dealSpeedMs, countCheckEvery: 0, audio: { enabled: true, verbosity: 'full' } });
  await withProfile(page, { seats: { playerHands: 1, bots: 2, botMistakePct: 0, playerPosition: 0 } });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('group', { name: 'In or out' }).getByRole('button', { name: 'Out', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.message-sat-out')).toBeVisible();
}

const OPENING_FELT: Felt = { p1: ['6d', 'Ad'], p2: ['3c', '4d'], dealer: ['8d', 'down'], markers: 0, lines: [] };

/** Each later beat, in order: what it adds to the felt. */
const BEATS: { what: string; felt: Felt }[] = [
  { what: 'P1 hits', felt: { ...OPENING_FELT, p1: ['6d', 'Ad', '4c'], lines: ['P1 hits 4♣'] } },
  { what: 'P1 stands', felt: { ...OPENING_FELT, p1: ['6d', 'Ad', '4c'], lines: ['P1 hits 4♣', 'P1 stands'] } },
  {
    what: 'P2 hits',
    felt: { ...OPENING_FELT, p1: ['6d', 'Ad', '4c'], p2: ['3c', '4d', '8s'], lines: ['P1 hits 4♣', 'P1 stands', 'P2 hits 8♠'] },
  },
  {
    what: 'P2 hits and busts',
    felt: {
      ...OPENING_FELT,
      p1: ['6d', 'Ad', '4c'],
      p2: ['3c', '4d', '8s', '10h'],
      lines: ['P1 hits 4♣', 'P1 stands', 'P2 hits 8♠', 'P2 hits 10♥', 'P2 busts'],
    },
  },
];
const ALL_BOTS = BEATS[BEATS.length - 1]!.felt;
const HOLE: Felt = { ...ALL_BOTS, dealer: ['8d', '7d'] };
const SETTLED: Felt = { ...ALL_BOTS, dealer: ['8d', '7d', '4s'], markers: 2 };

test('Out: after the opening, each bot turn, the hole card and each dealer draw land one beat apart, in casino order', async ({ page }) => {
  await dealOut(page);

  // The opening, as the CSS stagger deals it: no draw, the hole face down, no verdicts.
  await expect.poll(() => felt(page)).toEqual(OPENING_FELT);
  await page.clock.runFor(OPENING * BEAT - 100);
  expect(await felt(page), 'nothing past the opening before its last card').toEqual(OPENING_FELT);

  // Then one thing per beat -- and not a beat early.
  let before = OPENING_FELT;
  for (const [i, next] of [...BEATS, { what: 'the hole card turns', felt: HOLE }, { what: 'the dealer draws', felt: SETTLED }].entries()) {
    if (i > 0) {
      await page.clock.runFor(BEAT - 100);
      expect(await felt(page), `before ${next.what}`).toEqual(before);
    }
    await page.clock.runFor(100);
    await expect.poll(() => felt(page), { message: next.what }).toEqual(next.felt);
    before = next.felt;
  }
  await expect(page.locator('.fast-forward-btn')).toHaveCount(0);
});

test('Out: the voice is not held to the felt -- each bot line is said a beat apart from the deal, as before', async ({ page }) => {
  await dealOut(page);
  const at = (await spoken(page)).length;
  await page.clock.runFor(4 * BEAT + 50);
  // All four turns spoken while the felt is still on its opening: eyes-free is no slower.
  await expect
    .poll(async () => (await spoken(page)).slice(at).filter((l) => /^Player \w+ (hits|stands)/.test(l)).length)
    .toBe(4);
  expect(await felt(page)).toEqual(OPENING_FELT);
});

test('Out: no peek while the round is still going onto the felt -- it would count cards not shown yet', async ({ page }) => {
  await dealOut(page);
  const peekBtn = page.locator('.peek-hold-btn');
  await expect.poll(() => felt(page)).toEqual(OPENING_FELT);
  await expect(peekBtn).toHaveCount(0);
  // The hole card is up and the dealer's draw is still to come.
  await page.clock.runFor((OPENING + 4) * BEAT + BEAT / 2);
  await expect.poll(() => felt(page)).toEqual(HOLE);
  await expect(peekBtn).toHaveCount(0);
  await expect(page.locator('.fast-forward-btn')).toBeVisible();
  // On the felt, all of it: the peek is back.
  await page.clock.runFor(BEAT);
  await expect.poll(() => felt(page)).toEqual(SETTLED);
  await expect(peekBtn).toHaveCount(1);
});

test('Out: Skip puts the rest of the round on the felt at once', async ({ page }) => {
  await dealOut(page);
  await expect.poll(() => felt(page)).toEqual(OPENING_FELT);
  await page.locator('.fast-forward-btn').click();
  await expect.poll(() => felt(page)).toEqual(SETTLED);
  await expect(page.locator('.fast-forward-btn')).toHaveCount(0);
});

test('Out, reduced motion: the whole round is on the felt at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dealOut(page);
  await expect.poll(() => felt(page)).toEqual(SETTLED);
});

test('Out, deal speed 0: the whole round is on the felt at once', async ({ page }) => {
  await dealOut(page, 0);
  await page.clock.runFor(50);
  await expect.poll(() => felt(page)).toEqual(SETTLED);
});
