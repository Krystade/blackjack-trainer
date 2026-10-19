import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { Game, DEFAULT_SPREAD, botRngSeed } from './game';
import type { GameConfig } from './game';
import { correctPlay } from './strategy';
import { cutRngSeed } from './cut';
import { dealerErrorSeed, errorKindsFor, rollDealerError, DEALER_ERROR_RATE } from './dealerErrors';

/**
 * G2 (L-8): dealer mistakes and the Foul call. The engine rolls at most one
 * error per settled round, on its own seeded stream, and only with the
 * setting on; Foul corrects an error, a false call is graded wrong, and an
 * error nobody called is graded missed when the next round is dealt.
 */

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

function cfg(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    penetration: 0.75,
    betSpreadOn: false,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 7,
    ...overrides,
  };
}

/** An rng that returns `vals` in order, then `rest` forever, and counts its calls. */
function scripted(vals: number[], rest = 0.99): (() => number) & { calls: number } {
  let i = 0;
  const f = (() => {
    f.calls += 1;
    return i < vals.length ? vals[i++]! : rest;
  }) as (() => number) & { calls: number };
  f.calls = 0;
  return f;
}

/** Play the round out by the strategy the table grades against; decline insurance. */
function playOut(game: Game): void {
  for (let guard = 0; guard < 40 && game.phase !== 'settled'; guard++) {
    if (game.phase === 'insurance') {
      game.insuranceDecision(false);
      continue;
    }
    const hand = game.hands[game.active]!;
    const legal = game.legalActions();
    const advice = correctPlay(hand.cards, game.dealerCards[0]!.rank, game.trueCountNow, {
      canDouble: legal.includes('double'),
      canSplit: legal.includes('split'),
      canSurrender: legal.includes('surrender'),
    });
    game.act(legal.includes(advice.action) ? advice.action : 'stand');
  }
}

/** Every card dealt in a round, in table order: dealer, then each player hand. */
function roundCards(game: Game): string {
  const cards = [game.dealerCards, ...game.seats.flatMap((s) => s.hands.map((h) => h.cards))];
  return cards.map((cs) => cs.map((c) => `${c.rank}${c.suit}`).join(',')).join('|');
}

describe('G2: the dealer-error stream', () => {
  it('setting off: the error stream is never drawn from, over hundreds of rounds', () => {
    const rng = scripted([], 0);
    const game = new Game(cfg({ dealerErrorRng: rng }));
    for (let r = 0; r < 300; r++) {
      game.startRound();
      playOut(game);
    }
    expect(rng.calls).toBe(0);
    expect(game.dealerErrorTally.made).toBe(0);
    // Vacuity: the same stream, with the setting on, IS drawn from.
    const onRng = scripted([], 0.99);
    const on = new Game(cfg({ dealerErrorRng: onRng, dealerMistakes: true }));
    for (let r = 0; r < 20; r++) {
      on.startRound();
      playOut(on);
    }
    expect(onRng.calls).toBeGreaterThan(0);
  });

  it('a seed deals the same cards with the setting off, on, or absent', () => {
    const off = new Game(cfg({ seed: 4242 }));
    const absent = new Game({ ...cfg({ seed: 4242 }), dealerMistakes: false });
    const on = new Game(cfg({ seed: 4242, dealerMistakes: true }));
    let errors = 0;
    for (let r = 0; r < 400; r++) {
      for (const g of [off, absent, on]) {
        g.startRound();
        playOut(g);
      }
      expect(roundCards(on)).toBe(roundCards(off));
      expect(roundCards(absent)).toBe(roundCards(off));
      if (on.dealerError) errors += 1;
    }
    // Vacuity: errors really were made on the "on" table while it dealt the same cards.
    expect(errors).toBeGreaterThan(0);
    expect(off.dealerErrorTally.made).toBe(0);
  });

  it('runs on its own salt, apart from the bot and cut-card streams', () => {
    for (const seed of [0, 1, 7, 123456]) {
      expect(dealerErrorSeed(seed)).not.toBe(botRngSeed(seed));
      expect(dealerErrorSeed(seed)).not.toBe(cutRngSeed(seed));
      expect(dealerErrorSeed(seed)).not.toBe(seed >>> 0);
    }
  });

  it('lands near one round in thirty over simulated play', () => {
    const game = new Game(cfg({ seed: 99, dealerMistakes: true }));
    const rounds = 9000;
    for (let r = 0; r < rounds; r++) {
      game.startRound();
      playOut(game);
    }
    const rate = game.dealerErrorTally.made / rounds;
    expect(rate).toBeGreaterThan(1 / 45);
    expect(rate).toBeLessThan(1 / 20);
  });
});

describe('G2: each error kind', () => {
  // Rigged deal order: player, dealer up, player, dealer hole, then draws.
  const WIN = rig('10', '10', '9', '8'); // P 10,9 = 19 v D 10,8 = 18: win +1
  const BJ = rig('A', '10', 'K', '8'); // P A,K natural v D 10,8: blackjack +1.5
  const PUSH = rig('10', '10', '8', '8'); // P 18 v D 18: push
  const DOUBLE_WIN = rig('6', '6', '5', '10', 'K', '9'); // P 6,5 doubles to 21 v D 6,10 -> draws 9: bust, win +2

  function settle(cards: Card[], rng: () => number, act?: 'double'): Game {
    const game = Game.withRiggedShoe(cfg({ dealerMistakes: true, dealerErrorRng: rng }), cards);
    game.startRound();
    if (game.phase === 'player') game.act(act ?? 'stand');
    expect(game.phase).toBe('settled');
    return game;
  }

  it('overpay: a 1-unit win is paid +2, and the bankroll moves by it', () => {
    const g = settle(WIN, scripted([0, 0, 0]));
    expect(g.dealerError?.kind).toBe('overpay');
    expect(g.hands[0]!.result).toBe('win');
    expect(g.hands[0]!.net).toBe(2);
    expect(g.bankroll).toBe(102);
    expect(g.dealerError).toMatchObject({ correctNet: 1, paidNet: 2 });
  });

  it('take-win: the winning hand is swept as a loss', () => {
    const g = settle(WIN, scripted([0, 0, 0.99]));
    expect(g.dealerError?.kind).toBe('take-win');
    expect(g.hands[0]!.result).toBe('lose');
    expect(g.hands[0]!.net).toBe(-1);
    expect(g.bankroll).toBe(99);
  });

  it('underpay: a blackjack is paid +0.5; never offered on a 1-unit win', () => {
    const g = settle(BJ, scripted([0, 0, 0.5]));
    expect(g.dealerError?.kind).toBe('underpay');
    expect(g.hands[0]!.result).toBe('blackjack');
    expect(g.hands[0]!.net).toBe(0.5);
    expect(g.bankroll).toBe(100.5);
    expect(errorKindsFor({ result: 'win', net: 1, bet: 1, doubled: false })).not.toContain('underpay');
    expect(errorKindsFor({ result: 'win', net: 2, bet: 1, doubled: true })).toContain('underpay');
  });

  it('pay-push: a push is paid as a win', () => {
    const g = settle(PUSH, scripted([0, 0, 0]));
    expect(g.dealerError?.kind).toBe('pay-push');
    expect(g.hands[0]!.result).toBe('win');
    expect(g.hands[0]!.net).toBe(1);
    expect(g.bankroll).toBe(101);
  });

  it('a doubled win taken is a 2-unit loss', () => {
    const g = settle(DOUBLE_WIN, scripted([0, 0, 0.99]), 'double');
    expect(g.dealerError?.kind).toBe('take-win');
    expect(g.dealerError).toMatchObject({ correctNet: 2, paidNet: -2, paidResult: 'lose' });
    expect(g.bankroll).toBe(98);
  });

  it('no error on a losing or surrendered hand, and no draw for one', () => {
    expect(errorKindsFor({ result: 'lose', net: -1, bet: 1, doubled: false })).toEqual([]);
    expect(errorKindsFor({ result: 'surrender', net: -0.5, bet: 1, doubled: false })).toEqual([]);
    const rng = scripted([0, 0, 0]);
    const lose = settle(rig('10', '10', '7', '9'), rng); // P 17 v D 19
    expect(lose.dealerError).toBeNull();
    expect(lose.hands[0]!.net).toBe(-1);
    expect(rng.calls).toBe(0);
  });

  it('a roll above the rate makes no error', () => {
    const rng = scripted([DEALER_ERROR_RATE]);
    const g = settle(WIN, rng);
    expect(g.dealerError).toBeNull();
    expect(g.hands[0]!.net).toBe(1);
    expect(rng.calls).toBe(1);
  });

  it('picks among eligible hands only', () => {
    const hands = [
      { cards: [], bet: 1, doubled: false, surrendered: false, fromSplit: false, splitAces: false, done: true, originIndex: 0, result: 'lose' as const, net: -1 },
      { cards: [], bet: 1, doubled: false, surrendered: false, fromSplit: false, splitAces: false, done: true, originIndex: 1, result: 'push' as const, net: 0 },
    ];
    const err = rollDealerError(hands, scripted([0, 0, 0]));
    expect(err).toMatchObject({ handIndex: 1, kind: 'pay-push' });
  });
});

describe('G2: grading Foul', () => {
  const TWO_WINS = rig('10', '10', '9', '8', '10', '10', '9', '8');

  function erred(): Game {
    const game = Game.withRiggedShoe(cfg({ dealerMistakes: true, dealerErrorRng: scripted([0, 0, 0]) }), TWO_WINS);
    game.startRound();
    game.act('stand');
    return game;
  }

  it('calling Foul on an error is right, and puts the payout right', () => {
    const g = erred();
    expect(g.bankroll).toBe(102);
    const v = g.callFoul();
    expect(v).toMatchObject({ correct: true, error: { kind: 'overpay' } });
    expect(g.hands[0]!.net).toBe(1);
    expect(g.hands[0]!.result).toBe('win');
    expect(g.bankroll).toBe(101);
    expect(g.dealerError).toBeNull();
    expect(g.dealerErrorTally).toEqual({ made: 1, caught: 1, missed: 0, falseCalls: 0 });
    // One call per round.
    expect(g.foulOpen).toBe(false);
    expect(g.callFoul()).toBeNull();
    // Caught, so the next deal grades nothing missed.
    g.startRound();
    expect(g.missedDealerError).toBeNull();
    expect(g.dealerErrorTally.missed).toBe(0);
  });

  it('calling Foul on a correct payout is wrong, and changes nothing', () => {
    const game = Game.withRiggedShoe(cfg({ dealerMistakes: true, dealerErrorRng: scripted([0.99]) }), TWO_WINS);
    game.startRound();
    game.act('stand');
    expect(game.dealerError).toBeNull();
    const v = game.callFoul();
    expect(v).toEqual({ correct: false, error: null });
    expect(game.bankroll).toBe(101);
    expect(game.hands[0]!.net).toBe(1);
    expect(game.dealerErrorTally).toEqual({ made: 0, caught: 0, missed: 0, falseCalls: 1 });
  });

  it('an error left uncalled is graded missed when the next round is dealt', () => {
    const g = erred();
    expect(g.dealerErrorTally.missed).toBe(0);
    g.startRound();
    expect(g.missedDealerError?.kind).toBe('overpay');
    expect(g.dealerErrorTally).toEqual({ made: 1, caught: 0, missed: 1, falseCalls: 0 });
    // The overpaid unit stays paid: nobody called it.
    expect(g.bankroll).toBe(102);
    // And the miss is only graded once.
    g.act('stand');
    g.startRound();
    expect(g.dealerErrorTally.missed).toBe(1);
  });

  it('a sit-out is a next deal too', () => {
    // The round out deals to the three bots a solo player Out watches.
    const g = Game.withRiggedShoe(
      cfg({ dealerMistakes: true, dealerErrorRng: scripted([0, 0, 0]) }),
      rig('10', '10', '9', '8', '10', '10', '10', '10', '10', '10', '10', '7'),
    );
    g.startRound();
    g.act('stand');
    expect(g.dealerError?.kind).toBe('overpay');
    g.sitOut();
    expect(g.missedDealerError?.kind).toBe('overpay');
    expect(g.dealerErrorTally.missed).toBe(1);
  });

  it('End closes an uncalled error as missed', () => {
    const g = erred();
    expect(g.closeDealerError()?.kind).toBe('overpay');
    expect(g.dealerErrorTally.missed).toBe(1);
    expect(g.closeDealerError()).toBeNull();
    expect(g.dealerErrorTally.missed).toBe(1);
  });

  it('Foul is closed mid-round and after a sit-out', () => {
    const game = Game.withRiggedShoe(cfg({ dealerMistakes: true }), TWO_WINS);
    game.startRound();
    expect(game.phase).toBe('player');
    expect(game.foulOpen).toBe(false);
    expect(game.callFoul()).toBeNull();
    const sat = new Game(cfg({ dealerMistakes: true }));
    sat.sitOut();
    expect(sat.foulOpen).toBe(false);
  });

  it('no Foul result ever lands in the graded events', () => {
    const g = erred();
    const before = g.events.length;
    g.callFoul();
    g.startRound();
    expect(g.events.length).toBe(before);
  });
});
