import { describe, expect, it } from 'vitest';
import { bestSideEvHour, gameSideFigures, sideFigureOf, sideStakeOf } from './casinoSideFigures';
import { rankedEvHour } from './casinoRanking';
import type { RankRow } from './casinoRanking';
import { blankGame } from '../store/casinoLog';
import { saveSideRow, sideCutOf, sideRowFor, sideRowSpec, sideSpecKey } from '../store/casinoSideRows';
import { SIM_VERSION } from '../store/casinoGameStats';
import { SIDE_SIM_VERSION } from '../engine/sideBets/build';
import { sideBetRow } from '../engine/sideBets/plan';

describe('a casino game\'s side bets on the stats card', () => {
  const game = { ...blankGame('g'), decks: 6 as const, s17: true, cutDecksLeft: 1, roundsPerHour: 100 };

  it('reads a game cut at the standard cut straight from the generated table', () => {
    const sb = { bet: 'buster' as const, payTable: 'bu-evo' };
    expect(sideCutOf(game)).toBe(1);
    expect(sideRowFor(game, sb)).toBe(sideBetRow('buster', 'bu-evo', 6, true));
    // Cut anywhere else, the game's own run is needed.
    expect(sideRowFor({ ...game, cutDecksLeft: 1.75 }, sb)).toBeNull();
    expect(sideRowSpec({ ...game, cutDecksLeft: 1.75 }, sb).cutDecks).toBe(1.75);
  });

  it('counted EV per hour: units per 100 rounds x stake x rounds per hour', () => {
    const row = sideBetRow('buster', 'bu-evo', 6, true)!;
    const c = row.candidates.find((x) => x.id === row.chosen)!;
    const f = sideFigureOf({ bet: 'buster', payTable: 'bu-evo', minBet: 10 }, row, 100);
    expect(f.stake).toBe(10);
    expect(f.evHour).toBeCloseTo((c.per100 / 100) * 10 * 100, 9);
    expect(f.trigger).toBe(c.trigger);
    expect(f.edge).toBe(row.edge);
  });

  it('a bet positive off the top is worth its edge every round; under a shuffler only that kind is', () => {
    const row = sideBetRow('royalMatch', 'rm-v2', 6, true)!;
    expect(row.always).toBe(true);
    const f = sideFigureOf({ bet: 'royalMatch', payTable: 'rm-v2' }, row, 80);
    expect(f.evHour).toBeCloseTo(-row.edge * 25 * 80, 9);
    const counted = sideBetRow('buster', 'bu-evo', 6, true)!;
    expect(sideFigureOf({ bet: 'buster', payTable: 'bu-evo' }, counted, 80, true).evHour).toBe(0);
  });

  it('the stake is the side minimum (else $25), never above the side maximum', () => {
    expect(sideStakeOf({ bet: 'over13', payTable: 'ou-even' })).toBe(25);
    expect(sideStakeOf({ bet: 'over13', payTable: 'ou-even', minBet: 5 })).toBe(5);
    expect(sideStakeOf({ bet: 'over13', payTable: 'ou-even', maxBet: 10 })).toBe(10);
  });

  it('the best side bet is the most positive; a losing or uncomputed one adds nothing', () => {
    const figs = gameSideFigures(
      { ...game, sideBets: [{ bet: 'buster', payTable: 'bu-evo' }, { bet: 'perfectPairs', payTable: 'pp-a' }, { bet: 'over13', payTable: 'ou-even' }] },
      100,
    );
    expect(figs.map((f) => f.evHour! > 0)).toEqual([true, false, true]);
    const best = bestSideEvHour(figs);
    expect(best.evHour).toBe(Math.max(figs[0]!.evHour!, figs[2]!.evHour!));
    expect(bestSideEvHour(gameSideFigures({ ...game, cutDecksLeft: 1.75, sideBets: [{ bet: 'over13', payTable: 'ou-even' }] }, 100)).evHour).toBe(0);
    // Not countable here: nothing is "best", so the card badges nothing.
    expect(bestSideEvHour(gameSideFigures({ ...game, sideBets: [{ bet: 'perfectPairs', payTable: 'pp-a' }] }, 100))).toEqual({ evHour: 0, fig: null });
  });

  it('the ranking ranks on the figure with the side bet where it uses one (review S1), else the game\'s', () => {
    const row = { figures: { evHour: 30 }, sideEvHour: 12, withSide: { evHour: 41, sideEvHour: 12, method: null } } as unknown as RankRow;
    expect(rankedEvHour(row)).toBe(41);
    expect(rankedEvHour({ figures: { evHour: 30 }, sideEvHour: 12 } as unknown as RankRow)).toBe(30);
    expect(rankedEvHour({ figures: null } as unknown as RankRow)).toBeNull();
  });

  it('review S5: a cached row is keyed by both simulators\' versions, so an engine fix retires it', () => {
    const spec = sideRowSpec({ ...game, cutDecksLeft: 1.75 }, { bet: 'buster', payTable: 'bu-evo' });
    expect(sideSpecKey(spec)).toBe(`side${SIDE_SIM_VERSION}.sim${SIM_VERSION}/buster/bu-evo/6/s17/1.75/${spec.rounds}`);
    const row = sideBetRow('buster', 'bu-evo', 6, true)!;
    saveSideRow(spec, row);
    expect(sideRowFor({ ...game, cutDecksLeft: 1.75 }, { bet: 'buster', payTable: 'bu-evo' })).toEqual(row);
  });
});

describe('Wave L merge: side bets at a 4- or 5-deck shoe (Wave M)', () => {
  const sb = { bet: 'luckyLadies' as const, payTable: 'll-b' };
  it('is dealt from the shoe it is, not the 6-deck chart the main game plays', () => {
    const four = { ...blankGame('g4'), decks: 4 as const, s17: true, cutDecksLeft: 1 };
    const spec = sideRowSpec(four, sb);
    expect(spec.decks).toBe(4);
    expect(spec.cutDecks).toBe(1);
    // Not in the generated table (1, 2, 6, 8 decks): the game's own run.
    expect(sideRowFor(four, sb)).toBeNull();
    // The cut is clamped to the 4-deck shoe, as the main simulator clamps it.
    expect(sideCutOf({ ...four, cutDecksLeft: 3.9 })).toBe(3.5);
    expect(sideRowSpec({ ...four, decks: 5 }, sb).decks).toBe(5);
  });
  it('leaves 1, 2, 6 and 8 decks keyed as before (their seeds and cached rows unchanged)', () => {
    const six = { ...blankGame('g6'), decks: 6 as const, s17: true, cutDecksLeft: 1.25 };
    const spec = sideRowSpec(six, sb);
    expect(spec.decks).toBe(6);
    expect(sideSpecKey(spec)).toBe(`side${SIDE_SIM_VERSION}.sim${SIM_VERSION}/luckyLadies/ll-b/6/-/1.25/${spec.rounds}`);
  });
});
