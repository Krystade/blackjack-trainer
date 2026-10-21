import { describe, expect, it } from 'vitest';
import { addSideDecisions, addSideDrillRun, sideBetStatsOf, sideBetTotals, SIDE_DRILL_HISTORY_MAX } from './sideBetStats';
import { normSideBets } from './casinoSideBets';
import { normGame } from './casinoLog';
import type { Stats } from './types';
import type { SideBetDecision } from '../engine/sideBets/tableBet';

const base = {} as Stats;
const d = (over: Partial<SideBetDecision>): SideBetDecision => ({ round: 1, placed: false, expected: false, correct: true, rc: 0, tc: 0, ...over });

describe('side-bet stats', () => {
  it('adds Play decisions per bet: calls right and wrong, bets placed, net', () => {
    let s = addSideDecisions(base, 'luckyLadies', [d({}), d({ placed: true, expected: true, net: 225 }), d({ placed: true, correct: false, net: -25 })]);
    s = addSideDecisions(s, 'luckyLadies', [d({ correct: false, expected: true })]);
    s = addSideDecisions(s, 'buster', [d({ placed: true, expected: true, net: 50 })]);
    expect(sideBetStatsOf(s).play.luckyLadies).toEqual({ right: 2, wrong: 2, placed: 2, net: 200 });
    expect(sideBetTotals(s)).toEqual({ right: 3, wrong: 2, placed: 3, net: 250 });
  });

  it('is additive: a blob without the field reads as nothing, and nothing added changes nothing', () => {
    expect(sideBetStatsOf(base)).toEqual({ play: {}, drill: [] });
    expect(addSideDecisions(base, 'buster', [])).toBe(base);
    expect(sideBetStatsOf({ sideBets: 'junk' } as unknown as Stats)).toEqual({ play: {}, drill: [] });
  });

  it('keeps the newest drill runs, capped', () => {
    let s = base;
    for (let i = 0; i < SIDE_DRILL_HISTORY_MAX + 5; i++) {
      s = addSideDrillRun(s, { date: String(i), bet: 'over13', withHiLo: false, checkpoints: 2, correct: 1 });
    }
    const runs = sideBetStatsOf(s).drill;
    expect(runs).toHaveLength(SIDE_DRILL_HISTORY_MAX);
    expect(runs.at(-1)!.date).toBe(String(SIDE_DRILL_HISTORY_MAX + 4));
  });
});

describe('a casino game\'s side bets', () => {
  it('keeps known bets on known pay tables, once each, and drops the rest', () => {
    expect(
      normSideBets([
        { bet: 'luckyLadies', payTable: 'll-a', minBet: 5, maxBet: 100 },
        { bet: 'luckyLadies', payTable: 'll-b' },
        { bet: 'nope', payTable: 'll-a' },
        { bet: 'buster', payTable: 'll-a' },
        { bet: 'buster', payTable: 'bu-evo', minBet: -3 },
        'junk',
      ]),
    ).toEqual([
      { bet: 'luckyLadies', payTable: 'll-a', minBet: 5, maxBet: 100 },
      { bet: 'buster', payTable: 'bu-evo', minBet: null, maxBet: null },
    ]);
    expect(normSideBets(undefined)).toEqual([]);
  });

  it('is an optional field on the game: absent stays absent, present round-trips', () => {
    const plain = normGame({ id: 'g1', midShoeEntry: 'no' }, 'x');
    expect('sideBets' in plain).toBe(false);
    const withSide = normGame({ id: 'g2', sideBets: [{ bet: 'over13', payTable: 'ou-even' }] }, 'x');
    expect(withSide.sideBets).toEqual([{ bet: 'over13', payTable: 'ou-even', minBet: null, maxBet: null }]);
    expect(normGame(JSON.parse(JSON.stringify(withSide)), 'x')).toEqual(withSide);
  });
});
