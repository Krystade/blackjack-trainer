import { describe, it, expect } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import type { GameConfig, SeatConfig } from '../engine/game';
import { DEFAULT_RULES } from '../engine/ruleset';
import { makeDownswingShoe } from './downswingShoe';

/** The DEFAULT_SPREAD ramp bet for a true count (last row with minTc <= tc). */
function rampBet(tc: number): number {
  let units = DEFAULT_SPREAD[0].units;
  for (const row of DEFAULT_SPREAD) if (row.minTc <= tc) units = row.units;
  return units;
}

const SOLO_SEATS: SeatConfig = { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 };

function soloCfg(): GameConfig {
  return {
    // Matches DownswingView: high penetration so the rigged shoe is played to
    // the end without a mid-session reshuffle (which would reset the count).
    penetration: 0.99,
    betSpreadOn: false,
    spread: [],
    bankrollStart: 1000,
    countCheckEvery: 0,
    rules: DEFAULT_RULES,
    seats: SOLO_SEATS,
  };
}

/** Play one rigged round out as a competent player (stand on the pat hand). */
function playRound(game: Game, bet: number) {
  game.startRound(bet);
  while (game.phase === 'player') game.act('stand');
}

describe('makeDownswingShoe (ET1)', () => {
  it('is deterministic for a seed', () => {
    const a = makeDownswingShoe(10, 7).map((c) => c.rank);
    const b = makeDownswingShoe(10, 7).map((c) => c.rank);
    expect(b).toEqual(a);
  });

  it('never contains an Ace anywhere (no insurance / peek detours)', () => {
    for (const c of makeDownswingShoe(60, 3)) expect(c.rank).not.toBe('A');
  });

  it('a competent (stand-on-pat) solo player LOSES every round through the real engine; bankroll only falls', () => {
    const rounds = 30;
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
    expect(game.bankroll).toBe(1000 - rounds); // 1-unit losses
  });

  it('the running count SWINGS through both regimes every session (negative early, positive later) — robust across seeds', () => {
    // The enrichment's arc: 1st-half pat (high-card) losses push the count
    // NEGATIVE (bet minimum), 2nd-half draw-out (low-card) losses push it
    // POSITIVE (bet big, lose anyway). Every seed should visit both.
    const rounds = 40;
    for (let seed = 0; seed < 8; seed++) {
      const game = Game.withRiggedShoe(soloCfg(), makeDownswingShoe(rounds, seed));
      let sawPositive = false;
      let sawNegative = false;
      for (let r = 0; r < rounds; r++) {
        const tc = game.trueCountNow; // TC entering this bet, from prior rounds
        if (tc > 0) sawPositive = true;
        if (tc < 0) sawNegative = true;
        playRound(game, 1);
      }
      expect(sawNegative, `seed ${seed}: should hit a negative count (bet-minimum moment)`).toBe(true);
      expect(sawPositive, `seed ${seed}: should hit a positive count (bet-big moment)`).toBe(true);
    }
  });

  it('betting the ramp for the shown TC scores 100% in-engine conformity (display TC == graded TC)', () => {
    const cfg: GameConfig = { ...soloCfg(), betSpreadOn: true, spread: DEFAULT_SPREAD };
    const game = Game.withRiggedShoe(cfg, makeDownswingShoe(40, 11));
    for (let r = 0; r < 40; r++) {
      const tc = game.trueCountNow; // exactly what the DownswingView HUD shows
      const before = game.events.length;
      game.startRound(rampBet(tc));
      const betEvent = game.events.slice(before).find((e) => e.kind === 'bet');
      expect(
        betEvent?.correct,
        `round ${r}: tc ${tc}, bet ${rampBet(tc)}, engine expected ${betEvent?.expected}`,
      ).toBe(true);
      while (game.phase === 'player') game.act('stand');
    }
  });

  it('the drawdown scales with the bet (the ramp) — bigger bets lose bigger', () => {
    const game = Game.withRiggedShoe(soloCfg(), makeDownswingShoe(5, 9));
    const start = game.bankroll;
    for (let r = 0; r < 5; r++) playRound(game, 4);
    expect(game.bankroll).toBe(start - 5 * 4);
  });
});
