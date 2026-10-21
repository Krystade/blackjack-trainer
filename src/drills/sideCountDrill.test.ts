import { describe, expect, it } from 'vitest';
import { decksText, gradeSideAnswer, makeSideCountRun } from './sideCountDrill';
import type { SideRunSpec } from './sideCountDrill';
import { hiLoTag } from '../engine/count';
import { RANKS } from '../engine/cards';
import { PUBLISHED_COUNTS } from '../engine/sideBets/counts';

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

describe('the side count drill run', () => {
  it('is deterministic in its seed', () => {
    expect(makeSideCountRun(spec())).toEqual(makeSideCountRun(spec()));
    expect(makeSideCountRun(spec())).not.toEqual(makeSideCountRun(spec({ seed: 99 })));
  });

  it('every stop asks Hi-Lo then the side count, each the true tally of the cards shown so far', () => {
    const run = makeSideCountRun(spec());
    const flat = run.groups.flat();
    expect(flat).toHaveLength(40);
    expect(run.stops.length).toBe(3); // two checkpoints and the end
    for (const stop of run.stops) {
      const seen = flat.slice(0, stop.cardsShown);
      const hilo = seen.reduce((n, c) => n + hiLoTag(c.rank), 0);
      const side = seen.reduce((n, c) => n + TEN.tags![RANKS.indexOf(c.rank)]!, 0);
      expect(stop.questions[0]).toEqual({ kind: 'count', count: 'hilo', actual: hilo });
      expect(stop.questions[1]).toEqual({ kind: 'count', count: 'side', actual: side });
    }
    expect(run.stops.at(-1)!.cardsShown).toBe(40);
  });

  it('ends with the bet question, at the true count the run ends on', () => {
    const run = makeSideCountRun(spec({ withHiLo: false, checkpoints: 'off' }));
    expect(run.stops).toHaveLength(1);
    const [count, bet] = run.stops[0]!.questions;
    expect(count!.kind).toBe('count');
    expect(bet!.kind).toBe('bet');
    if (bet!.kind !== 'bet' || count!.kind !== 'count') return;
    // 2 decks, 40 cards gone: 64 left -> 1.25 is not a half deck; snapped to 1.0 (the half-deck rule above 52 cards).
    expect(bet.decksLeft).toBe(1);
    expect(bet.tc).toBe(Math.floor(count.actual / bet.decksLeft) || 0);
    expect(bet.actual).toBe(bet.tc >= 4);
  });

  it('the suit spread is counted from suits', () => {
    const run = makeSideCountRun(spec({ count: SUIT, plan: { always: false, count: SUIT, trigger: 3, betBelow: false }, withHiLo: false }));
    const flat = run.groups.flat();
    for (const stop of run.stops) {
      const seen = flat.slice(0, stop.cardsShown);
      const n = ['s', 'h', 'd', 'c'].map((s) => seen.filter((c) => c.suit === s).length);
      expect(stop.questions[0]).toEqual({ kind: 'count', count: 'side', actual: Math.max(...n) - Math.min(...n) });
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
});
