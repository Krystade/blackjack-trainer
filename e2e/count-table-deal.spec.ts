import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * Wave X (item 8): the count drill's Table mode, dealt. "Cards dealt out at
 * the selected speed (or instant if instant is selected), and then a set
 * post-round payout stage ... before the cards are collected. Animated in the
 * same order a casino actually deals and collects."
 *
 * A round used to appear whole and vanish whole. A recorder on the page logs
 * every card as it lands, the hole card turning, the payout and each collect,
 * on the page's fake clock; the log must be casino order at casino pace:
 *
 *   a card to each seat from first base, the dealer's up-card; again, the
 *   hole card face down; each seat's draw, first base first; the hole turns;
 *   the dealer draws -- one time-per-card apart -- then the payout, a set
 *   beat, then the dealer takes third base's cards first, back to first
 *   base, and its own last.
 *
 * The rounds are random, so the expected order is built from each round's
 * own shape (how many cards each seat and the dealer ended with).
 */

test.use({ viewport: { width: 375, height: 812 } });

const CARD_MS = 1000;
const PAYOUT_MS = 1500;
const COLLECT_MS = 250;
const TICK = 50;
/** Every hold is a whole number of ticks, so on a paused clock each beat lands exactly. */
const SLACK = 2;

type Entry = { what: 'round' | 'card' | 'reveal' | 'payout' | 'collect'; where?: string; down?: boolean; t: number };

async function openTable(page: Page, drill: Record<string, unknown>): Promise<void> {
  await page.clock.install();
  await withProfile(page);
  await withSettings(page, {
    drill: { countManual: false, countTableMode: true, countTableRounds: 5, countIntervalMs: CARD_MS, ...drill },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await page.evaluate(() => {
    const log: unknown[] = [];
    (window as unknown as { __felt: unknown[] }).__felt = log;
    const where = (el: Element): string | undefined => {
      const seat = el.closest('.bot-seat');
      if (seat?.parentElement) return `S${[...seat.parentElement.children].indexOf(seat)}`;
      return el.closest('.count-table-dealer') ? 'D' : undefined;
    };
    new MutationObserver((muts) => {
      const t = performance.now();
      for (const m of muts) {
        const el = m.target as Element;
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (!(n instanceof Element)) continue;
            if (n.matches('.count-table') || n.querySelector('.count-table')) log.push({ what: 'round', t });
            const cards = n.matches('.card') ? [n] : [...n.querySelectorAll('.card')];
            for (const c of cards) {
              // A card still to come holds its place unseen; it lands when it is dealt.
              if (c.closest('.count-table') && !c.closest('.count-table-pending')) log.push({ what: 'card', where: where(c), down: c.classList.contains('card-back'), t });
            }
          }
        } else if (m.attributeName === 'class') {
          const was = m.oldValue ?? '';
          if (el.matches('.count-table .card') && was.includes('card-back') && !el.classList.contains('card-back')) {
            log.push({ what: 'reveal', t });
          }
          if (el.classList.contains('is-collected') && !was.includes('is-collected')) log.push({ what: 'collect', where: where(el), t });
        } else if (m.attributeName === 'data-stage' && el.getAttribute('data-stage') === 'payout') {
          log.push({ what: 'payout', t });
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'data-stage'],
    });
  });
  // From here time moves only when the test moves it, so every beat is exact.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

/** The log, once the page has rendered (and run its effects for) the last tick. */
const felt = (page: Page) =>
  page.evaluate(async () => {
    // Real macrotask hops: the page's own timers are paused.
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((r) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => r();
        ch.port2.postMessage(0);
      });
    }
    return (window as unknown as { __felt: Entry[] }).__felt;
  });

/** Run the fake clock a tick at a time (so every render lands between ticks) until `done`. */
async function runUntil(page: Page, done: (log: Entry[]) => boolean, maxMs = 90_000): Promise<Entry[]> {
  for (let ms = 0; ms < maxMs; ms += TICK) {
    const log = await felt(page);
    if (done(log)) return log;
    await page.clock.runFor(TICK);
  }
  const log = await felt(page);
  throw new Error(`the clock ran out first: ${JSON.stringify(log.slice(-6))} stage=${await page.getByTestId('count-table').getAttribute('data-stage').catch(() => 'none')}`);
}

/** The rounds in the log, each from its table's mount to the next's. */
function rounds(log: Entry[]): Entry[][] {
  const out: Entry[][] = [];
  for (const e of log) {
    if (e.what === 'round') out.push([]);
    else out.at(-1)?.push(e);
  }
  return out;
}

/** Casino order for a round of this shape. */
function casinoOrder(round: Entry[]): string[] {
  const count = (w: string) => round.filter((e) => e.what === 'card' && e.where === w).length;
  const seats = new Set(round.filter((e) => e.where?.startsWith('S')).map((e) => e.where)).size;
  const S = [...Array(seats).keys()].map((i) => `S${i}`);
  const dealer = count('D');
  return [
    ...S.map((s) => `card ${s}`),
    'card D',
    ...S.map((s) => `card ${s}`),
    'card D down',
    ...S.flatMap((s) => Array.from({ length: count(s) - 2 }, () => `card ${s}`)),
    'reveal',
    ...Array.from({ length: dealer - 2 }, () => 'card D'),
    'payout',
    ...[...S].reverse().map((s) => `collect ${s}`),
    'collect D',
  ];
}

const said = (e: Entry) => `${e.what}${e.where ? ` ${e.where}` : ''}${e.down ? ' down' : ''}`;

test('dealt: each round goes down in casino order a time-per-card apart, pays, and is collected third base first', async ({ page }) => {
  test.setTimeout(180_000);
  await openTable(page, {});
  // Through the lead-in and two whole rounds, to the third's first card.
  const log = await runUntil(page, (l) => l.filter((e) => e.what === 'round').length >= 3);
  for (const [r, round] of rounds(log).slice(0, 2).entries()) {
    expect(round.map(said), `round ${r + 1}`).toEqual(casinoOrder(round));
    // The beat: a card (or the turn) per time-per-card, the payout a beat
    // after the last of them, held its set time, then a quick collect.
    const gaps = round.slice(1).map((e, i) => [said(e), Math.round(e.t - round[i]!.t)] as const);
    for (const [what, gap] of gaps) {
      const want = what.startsWith('collect') ? (gaps.find(([w]) => w.startsWith('collect'))![0] === what ? PAYOUT_MS : COLLECT_MS) : CARD_MS;
      expect(Math.abs(gap - want), `round ${r + 1}: ${what} came ${gap}ms after the last, not ${want}`).toBeLessThanOrEqual(SLACK);
    }
  }
  // First base is the dealer's left: the screen's right.
  const seats = page.locator('.count-table .bot-seat');
  if ((await seats.count()) >= 2) {
    const [first, second] = [(await seats.nth(0).boundingBox())!, (await seats.nth(1).boundingBox())!];
    expect(first.x).toBeGreaterThan(second.x);
  }
});

test('instant: the round is down at once, the hole up, for as long as dealing it would take; then the payout and the collect', async ({ page }) => {
  test.setTimeout(180_000);
  await openTable(page, { countTableDeal: 'instant' });
  const log = await runUntil(page, (l) => l.filter((e) => e.what === 'round').length >= 2);
  const [round] = rounds(log);
  const cards = round!.filter((e) => e.what === 'card');
  expect(new Set(cards.map((e) => e.t)).size, 'every card at once').toBe(1);
  expect(cards.some((e) => e.down), 'no card face down').toBe(false);
  const payout = round!.find((e) => e.what === 'payout')!;
  expect(Math.abs(payout.t - cards[0]!.t - cards.length * CARD_MS)).toBeLessThanOrEqual(SLACK);
  const collects = round!.filter((e) => e.what === 'collect');
  expect(Math.abs(collects[0]!.t - payout.t - PAYOUT_MS)).toBeLessThanOrEqual(SLACK);
  expect(collects.at(-1)!.where).toBe('D');
});

test('on tap: a tap mid-deal lays the round down, the payout waits for the next tap, which collects and moves on', async ({ page }) => {
  test.setTimeout(120_000);
  await openTable(page, { countManual: true });
  await runUntil(page, (l) => l.some((e) => e.what === 'round'));
  const table = page.getByTestId('count-table');
  await expect(table).toHaveAttribute('data-stage', 'deal');
  await page.locator('.manual-tap-zone').click();
  await expect(table).toHaveAttribute('data-stage', 'payout');
  // The whole round is down, the hole turned.
  await expect(table.locator('.card-back')).toHaveCount(0);
  // It waits: no clock moves it on.
  await page.clock.runFor(10_000);
  await expect(table).toHaveAttribute('data-stage', 'payout');
  await expect(page.locator('.manual-tap-hint')).toContainText('1/5');
  await page.locator('.manual-tap-zone').click();
  await expect(table).toHaveAttribute('data-stage', 'collect');
  await runUntil(page, (l) => l.filter((e) => e.what === 'round').length >= 2, 10_000);
  await expect(page.locator('.manual-tap-hint')).toContainText('2/5');
});

test('Dealing is a Table-mode setting: Card by card unless set Instant', async ({ page }) => {
  await withSettings(page, { drill: { countTableMode: true } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  const byCard = page.getByRole('button', { name: 'Card by card', exact: true });
  await expect(byCard).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Instant', exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(stored.drill.countTableDeal).toBe('instant');
  // Not a choice off the table.
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Instant', exact: true })).toHaveCount(0);
});
