import { describe, it, expect } from 'vitest';
import { Game } from '../engine/game';
import type { GameConfig, SeatConfig } from '../engine/game';
import { DEFAULT_RULES } from '../engine/ruleset';
import { makeDownswingShoe, DOWNSWING_CARDS_PER_ROUND } from './downswingShoe';

const SOLO_SEATS: SeatConfig = { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 };

function soloCfg(): GameConfig {
  return {
    penetration: 0.75,
    betSpreadOn: false,
    spread: [],
    bankrollStart: 1000,
    countCheckEvery: 0,
    rules: DEFAULT_RULES,
    seats: SOLO_SEATS,
  };
}

describe('makeDownswingShoe (ET1)', () => {
  it('is deterministic and sized rounds*4 + buffer', () => {
    const a = makeDownswingShoe(10, 7);
    const b = makeDownswingShoe(10, 7);
    expect(b.map((c) => c.rank)).toEqual(a.map((c) => c.rank));
    expect(a).toHaveLength(10 * DOWNSWING_CARDS_PER_ROUND + 8);
  });

  it('never contains an Ace up-card pattern (no insurance/peek detours)', () => {
    // Every 2nd card in a round (index 1 mod 4) is the dealer up-card.
    const cards = makeDownswingShoe(40, 3);
    for (let i = 1; i < 40 * DOWNSWING_CARDS_PER_ROUND; i += DOWNSWING_CARDS_PER_ROUND) {
      expect(cards[i].rank).not.toBe('A');
    }
  });

  it('a competent (stand-on-pat) solo player LOSES every round through the real engine; bankroll only falls', () => {
    const rounds = 25;
    const game = Game.withRiggedShoe(soloCfg(), makeDownswingShoe(rounds, 42));
    let prev = game.bankroll;
    for (let r = 0; r < rounds; r++) {
      game.startRound(1);
      expect(game.phase, `round ${r} must not detour to insurance`).not.toBe('insurance');
      while (game.phase === 'player') game.act('stand');
      expect(game.phase).toBe('settled');
      expect(game.hands[0].result, `round ${r} should be a loss`).toBe('lose');
      expect(game.bankroll).toBeLessThan(prev);
      prev = game.bankroll;
    }
    // 25 one-unit losses from a 1000 bankroll.
    expect(game.bankroll).toBe(1000 - 25);
  });

  it('the drawdown scales with the bet (the ramp) — bigger bets lose bigger', () => {
    const game = Game.withRiggedShoe(soloCfg(), makeDownswingShoe(5, 9));
    const start = game.bankroll;
    for (let r = 0; r < 5; r++) {
      game.startRound(4); // bet 4 units each
      while (game.phase === 'player') game.act('stand');
    }
    expect(game.bankroll).toBe(start - 5 * 4);
  });
});
