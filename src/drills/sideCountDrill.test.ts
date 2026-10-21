import { describe, expect, it } from 'vitest';
import { decksText, gradeSideAnswer, makeSideCountRun, NEAR_TRIGGER, RUN_COUNT_MAX, startSideCount } from './sideCountDrill';
import type { SideCountRun, SideRunSpec } from './sideCountDrill';
import { hiLoTag } from '../engine/count';
import { RANKS, snapDecksRemaining } from '../engine/cards';
import { PUBLISHED_COUNTS } from '../engine/sideBets/counts';
import { sidePlan } from '../engine/sideBets/plan';
import type { SideBetId } from '../engine/sideBets/payTables';
import { SIDE_COUNT_SPOKEN_MAX } from '../ui/sideBetFeedback';

const TEN = PUBLISHED_COUNTS.luckyLadies![0]!;
const SUIT = PUBLISHED_COUNTS.twentyOnePlus3![0]!;

const spec = (over: Partial<SideRunSpec> = {}): SideRunSpec => ({
  count: TEN,
  plan: { always: false, count: TEN, trigger: 4, betBelow: false },
  decks: 2,
  cards: 40,
  groupSize: 1,
  checkpoints: 'few',
  withHiLo: true,
  seed: 1234,
  ...over,
});

const tenTag = (rank: (typeof RANKS)[number]) => TEN.tags![RANKS.indexOf(rank)]!;
const betQ = (run: SideCountRun) => {
  const q = run.stops.at(-1)!.questions.at(-1)!;
  if (q.kind !== 'bet') throw new Error('the run does not end on the bet question');
  return q;
};

describe('the side count drill run', () => {
  it('is deterministic in its seed', () => {
    expect(makeSideCountRun(spec())).toEqual(makeSideCountRun(spec()));
    expect(makeSideCountRun(spec())).not.toEqual(makeSideCountRun(spec({ seed: 99 })));
  });

  it('every stop asks Hi-Lo then the side count: the start plus the cards shown so far', () => {
    let midShoe = 0;
    for (let seed = 0; seed < 40; seed++) {
      const run = makeSideCountRun(spec({ seed }));
      const flat = run.groups.flat();
      expect(flat).toHaveLength(40);
      expect(run.stops.length).toBe(3); // two checkpoints and the end
      if (run.start.dealt > 0) midShoe++;
      for (const stop of run.stops) {
        const seen = flat.slice(0, stop.cardsShown);
        const hilo = run.start.hiLoRc + seen.reduce((n, c) => n + hiLoTag(c.rank), 0);
        const side = run.start.sideRc + seen.reduce((n, c) => n + tenTag(c.rank), 0);
        expect(stop.questions[0]).toEqual({ kind: 'count', count: 'hilo', actual: hilo });
        expect(stop.questions[1]).toEqual({ kind: 'count', count: 'side', actual: side });
      }
      expect(run.stops.at(-1)!.cardsShown).toBe(40);
    }
    // Picked up mid-shoe, mostly: that is the point (review S6).
    expect(midShoe).toBeGreaterThan(30);
  });

  it('ends with the bet question, at the floored true count with the decks the start and the run leave', () => {
    for (let seed = 0; seed < 40; seed++) {
      const run = makeSideCountRun(spec({ seed, withHiLo: false, checkpoints: 'off' }));
      expect(run.stops).toHaveLength(1);
      const [count, bet] = run.stops[0]!.questions;
      if (bet!.kind !== 'bet' || count!.kind !== 'count') throw new Error('shape');
      expect(bet.decksLeft).toBe(snapDecksRemaining(104 - run.start.dealt - 40, 2));
      expect(bet.tc).toBe(Math.floor(count.actual / bet.decksLeft) || 0);
      expect(bet.actual).toBe(bet.tc >= 4);
      // Never past the cut (half a deck by default).
      expect(run.start.dealt + 40).toBeLessThanOrEqual(104 - 26);
      expect(run.start.decksLeft).toBe(snapDecksRemaining(104 - run.start.dealt, 2));
    }
  });

  it('the suit spread is counted from suits, the start being the four tallies above the lowest', () => {
    for (let seed = 0; seed < 20; seed++) {
      const run = makeSideCountRun(spec({ seed, count: SUIT, plan: { always: false, count: SUIT, trigger: 3, betBelow: false }, withHiLo: false }));
      expect(run.start.suits).toHaveLength(4);
      expect(Math.min(...run.start.suits!)).toBe(0);
      expect(run.start.sideRc).toBe(0);
      const flat = run.groups.flat();
      for (const stop of run.stops) {
        const seen = flat.slice(0, stop.cardsShown);
        const n = ['s', 'h', 'd', 'c'].map((s, i) => run.start.suits![i]! + seen.filter((c) => c.suit === s).length);
        expect(stop.questions[0]).toEqual({ kind: 'count', count: 'side', actual: Math.max(...n) - Math.min(...n) });
      }
      expect(startSideCount(run.start)).toBe(Math.max(...run.start.suits!));
    }
  });

  it('grades a number against the count and a bet call against the trigger', () => {
    expect(gradeSideAnswer({ kind: 'count', count: 'side', actual: 3 }, 3)).toBe(true);
    expect(gradeSideAnswer({ kind: 'count', count: 'side', actual: 3 }, 2)).toBe(false);
    expect(gradeSideAnswer({ kind: 'bet', actual: true, tc: 4, decksLeft: 1 }, true)).toBe(true);
    expect(gradeSideAnswer({ kind: 'bet', actual: true, tc: 4, decksLeft: 1 }, false)).toBe(false);
    expect(decksText(1.5)).toBe('1½');
    expect(decksText(0.5)).toBe('½');
  });

  it('review N12: the bet answer at the trigger boundary, both directions', () => {
    // Runs that end exactly ON the trigger are the boundary: bet there (>= / <=).
    let onUp = 0;
    let onDown = 0;
    for (let seed = 0; seed < 300; seed++) {
      const up = betQ(makeSideCountRun(spec({ seed, checkpoints: 'off' })));
      expect(up.actual).toBe(up.tc >= 4);
      if (up.tc === 4) {
        onUp++;
        expect(up.actual).toBe(true);
      }
      const down = betQ(makeSideCountRun(spec({ seed, checkpoints: 'off', plan: { always: false, count: TEN, trigger: -3, betBelow: true } })));
      expect(down.actual).toBe(down.tc <= -3);
      if (down.tc === -3) {
        onDown++;
        expect(down.actual).toBe(true);
      }
    }
    expect(onUp).toBeGreaterThan(5);
    expect(onDown).toBeGreaterThan(5);
  });

  it('keeps every count inside the recorded range', () => {
    expect(RUN_COUNT_MAX).toBe(SIDE_COUNT_SPOKEN_MAX);
    for (let seed = 0; seed < 50; seed++) {
      const run = makeSideCountRun(spec({ seed, decks: 6, cutDecks: 1 }));
      expect(Math.abs(run.start.sideRc)).toBeLessThanOrEqual(RUN_COUNT_MAX);
      expect(Math.abs(run.start.hiLoRc)).toBeLessThanOrEqual(RUN_COUNT_MAX);
      for (const s of run.stops) for (const q of s.questions) if (q.kind === 'count') expect(Math.abs(q.actual)).toBeLessThanOrEqual(RUN_COUNT_MAX);
    }
  });
});

describe('review S6: "bet the side?" is a real question', () => {
  // The rows the review measured at 0% "bet" with a 26-card run from a fresh shoe.
  const rows: [SideBetId, string, number][] = [
    ['over13', 'ou-even', 6],
    ['luckyLadies', 'll-b', 6],
    ['buster', 'bu-evo', 6],
    ['twentyOnePlus3', '213-v1', 6],
    ['under13', 'ou-even', 6],
  ];
  for (const [bet, table, decks] of rows) {
    it(`${bet} ${table}, ${decks} decks, 26 cards: bet and no bet both about half, the no-bets near the trigger`, () => {
      const plan = sidePlan(bet, table, decks, true)!;
      expect(plan.count).not.toBeNull();
      const lite = { always: plan.always, count: plan.count, trigger: plan.trigger, betBelow: plan.betBelow };
      let yes = 0;
      let near = 0;
      const N = 300;
      for (let seed = 0; seed < N; seed++) {
        const q = betQ(makeSideCountRun({ count: plan.count!, plan: lite, decks, cutDecks: 1, cards: 26, groupSize: 1, checkpoints: 'one', withHiLo: true, seed }));
        if (q.actual) yes++;
        else if (Math.abs(q.tc - plan.trigger!) <= NEAR_TRIGGER) near++;
      }
      expect(yes / N).toBeGreaterThan(0.4);
      expect(yes / N).toBeLessThan(0.6);
      expect(near).toBe(N - yes);
    });
  }
});

describe('re-review R1: decks left does not answer "bet the side?"', () => {
  // Before: a fresh depth per try, kept on the first that matched the coin, so
  // bet runs ended ~1 deck deeper and "bet if <= X decks left" scored 64-70%
  // without counting a card.
  const rows: [SideBetId, string, number][] = [
    ['over13', 'ou-even', 6],
    ['royalMatch', 'rm-v3', 6],
    ['twentyOnePlus3', '213-v1', 2],
  ];
  for (const [bet, table, decks] of rows) {
    it(`${bet} ${table}, ${decks} decks: "bet if <= X decks left" scores about half, at every X`, () => {
      const plan = sidePlan(bet, table, decks, true)!;
      const lite = { always: plan.always, count: plan.count, trigger: plan.trigger, betBelow: plan.betBelow };
      const N = 1000;
      const runs: { left: number; bet: boolean }[] = [];
      for (let seed = 0; seed < N; seed++) {
        const q = betQ(makeSideCountRun({ count: plan.count!, plan: lite, decks, cutDecks: decks > 2 ? 1 : 0.5, cards: 26, groupSize: 1, checkpoints: 'one', withHiLo: false, seed }));
        runs.push({ left: q.decksLeft, bet: q.actual });
      }
      const lefts = [...new Set(runs.map((r) => r.left))].sort((a, b) => a - b);
      expect(lefts.length).toBeGreaterThan(1);
      for (const x of lefts) {
        const right = runs.filter((r) => r.left <= x === r.bet).length / N;
        expect(right, `bet if <= ${x} decks left`).toBeGreaterThan(0.45);
        expect(right, `bet if <= ${x} decks left`).toBeLessThan(0.55);
      }
      const mean = (b: boolean) => {
        const v = runs.filter((r) => r.bet === b).map((r) => r.left);
        return v.reduce((a, c) => a + c, 0) / v.length;
      };
      expect(Math.abs(mean(true) - mean(false))).toBeLessThan(0.2);
    }, 60_000);
  }
});
