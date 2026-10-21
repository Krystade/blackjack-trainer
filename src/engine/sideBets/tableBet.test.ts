import { describe, expect, it } from 'vitest';
import type { Card, Rank, Suit } from '../cards';
import { Game, DEFAULT_SPREAD } from '../game';
import type { GameConfig } from '../game';
import { DEFAULT_RULES } from '../ruleset';
import { payTableOf } from './payTables';
import { sideExpected } from './tableBet';
import type { SideBetConfig, SidePlanLite } from './tableBet';
import type { SideBetId } from './payTables';

const c = (rank: Rank, suit: Suit = 's'): Card => ({ rank, suit });

/** Lucky Ladies' published Ten count, as a plan with a trigger chosen for the test. */
const TEN_COUNT = { id: 'ten', name: 'Ten', kind: 'tags' as const, tags: [0, 1, 1, 1, 1, 1, 1, 1, 1, -2, -2, -2, -2] };

function side(bet: SideBetId, payTable: string, plan: Partial<SidePlanLite> = {}): SideBetConfig {
  return {
    bet,
    name: bet,
    pays: payTableOf(bet, payTable)!.pays,
    plan: { always: false, count: TEN_COUNT, trigger: 2, betBelow: false, ...plan },
    stake: 25,
  };
}

function cfg(sideBet: SideBetConfig, overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    penetration: 0.75,
    betSpreadOn: false,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 1,
    rules: { ...DEFAULT_RULES, decks: 1 },
    sideBet,
    ...overrides,
  };
}

describe('the trigger boundary', () => {
  const plan: SidePlanLite = { always: false, count: TEN_COUNT, trigger: 3, betBelow: false };
  it('bets at the trigger and above, not below', () => {
    expect(sideExpected(plan, 2)).toBe(false);
    expect(sideExpected(plan, 3)).toBe(true);
    expect(sideExpected(plan, 4)).toBe(true);
  });
  it('a count that bets low bets at the trigger and below', () => {
    const low = { ...plan, trigger: -5, betBelow: true };
    expect(sideExpected(low, -4)).toBe(false);
    expect(sideExpected(low, -5)).toBe(true);
    expect(sideExpected(low, -6)).toBe(true);
  });
  it('a bet with no trigger is never right; a bet positive off the top always is', () => {
    expect(sideExpected({ ...plan, trigger: null }, 99)).toBe(false);
    expect(sideExpected({ ...plan, always: true, trigger: null }, -99)).toBe(true);
  });
});

describe('Play grades the side bet against the side count', () => {
  /**
   * Round 1: player 5,6 (+1 +1), dealer up 4 (+1), hole J; the player hits a
   * 9 (+1, 20) and stands; the dealer turns the J (-2) and draws an 8 (+1):
   * 22, bust. Ten count: +4 before the hole is turned, +3 after.
   * One deck, 6 cards gone: 46 left -> 1 deck (nearest quarter in the last
   * deck), so TC = +3.
   */
  const round1 = [c('5'), c('4'), c('6'), c('J'), c('9'), c('8')];
  const rest = [c('K'), c('8'), c('Q'), c('9'), ...Array<Card>(20).fill(c('8'))];

  it('the count is kept from the cards shown, the hole only once it is turned', () => {
    const game = Game.withRiggedShoe(cfg(side('luckyLadies', 'll-a')), [...round1, ...rest]);
    game.startRound(1);
    expect(game.sideRunningCount).toBe(3);
    game.act('hit');
    expect(game.sideRunningCount).toBe(4);
    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.sideRunningCount).toBe(3);
    expect(game.sideTrueCount).toBe(3);
  });

  it('at the trigger: placed is right, skipped is wrong', () => {
    for (const placed of [true, false]) {
      const game = Game.withRiggedShoe(cfg(side('luckyLadies', 'll-a', { trigger: 3 })), [...round1, ...rest]);
      game.startRound(1); // round 1: chip off at TC 0 -> right
      game.act('hit');
      game.act('stand');
      expect(game.sideDecisions[0]).toMatchObject({ placed: false, expected: false, correct: true });
      game.setSideOn(placed);
      game.startRound(1); // round 2 at TC +3, exactly the trigger
      const d = game.sideDecisionThisRound!;
      expect(d.tc).toBe(3);
      expect(d.expected).toBe(true);
      expect(d.correct).toBe(placed);
      expect(game.sideTally).toMatchObject({ right: placed ? 2 : 1, wrong: placed ? 0 : 1, placed: placed ? 1 : 0 });
    }
  });

  it('one below the trigger: placing it is wrong', () => {
    const game = Game.withRiggedShoe(cfg(side('luckyLadies', 'll-a', { trigger: 4 })), [...round1, ...rest]);
    game.startRound(1);
    game.act('hit');
    game.act('stand');
    game.setSideOn(true);
    game.startRound(1);
    expect(game.sideDecisionThisRound).toMatchObject({ tc: 3, expected: false, correct: false });
  });

  it('a round out has no side decision', () => {
    const game = Game.withRiggedShoe(cfg(side('luckyLadies', 'll-a')), [...round1, ...Array(30).fill(c('8'))]);
    game.setSideOn(true);
    game.sitOut();
    expect(game.sideDecisions).toHaveLength(0);
  });
});

describe('Play settles the side bet', () => {
  it('Lucky Ladies: a suited 20 pays 9 to 1 on table A', () => {
    // Player K♠ Q♠ (suited 20), dealer 9♥ / 8♥: stands on 17.
    const game = Game.withRiggedShoe(cfg(side('luckyLadies', 'll-a')), [c('K'), c('9', 'h'), c('Q'), c('8', 'h'), ...Array(20).fill(c('8'))]);
    game.setSideOn(true);
    game.startRound(1);
    game.act('stand');
    expect(game.sideDecisionThisRound).toMatchObject({ outcome: 'suited20', net: 225 });
    expect(game.sideTally.net).toBe(225);
  });

  it('Lucky Ladies: anything but 20 loses the stake', () => {
    const game = Game.withRiggedShoe(cfg(side('luckyLadies', 'll-a')), [c('K'), c('9', 'h'), c('9'), c('8', 'h'), ...Array(20).fill(c('8'))]);
    game.setSideOn(true);
    game.startRound(1);
    game.act('stand');
    expect(game.sideDecisionThisRound).toMatchObject({ outcome: null, net: -25 });
  });

  it('Buster: the dealer plays out after the player busts, and a five-card bust pays 4 to 1', () => {
    // Player 10,6 hits a 10: bust. Dealer 6 / 4 draws 2 (12), 3 (15), 10 (25): bust with five cards.
    const game = Game.withRiggedShoe(cfg(side('buster', 'bu-v1')), [c('10'), c('6', 'h'), c('6'), c('4', 'h'), c('10'), c('2', 'h'), c('3', 'h'), c('10', 'h'), ...Array(20).fill(c('8'))]);
    game.setSideOn(true);
    game.startRound(1);
    game.act('hit'); // 26: bust
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.map((x) => x.rank)).toEqual(['6', '4', '2', '3', '10']);
    expect(game.sideDecisionThisRound).toMatchObject({ outcome: 'b5', net: 100 });
  });

  it('without a Buster bet the dealer does not draw for a busted player', () => {
    const game = Game.withRiggedShoe(cfg(side('buster', 'bu-v1')), [c('10'), c('6', 'h'), c('6'), c('4', 'h'), c('10'), c('2', 'h'), c('3', 'h'), c('10', 'h'), ...Array(20).fill(c('8'))]);
    game.startRound(1);
    game.act('hit');
    expect(game.dealerCards).toHaveLength(2);
  });
});
