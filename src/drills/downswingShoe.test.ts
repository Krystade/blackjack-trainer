import { describe, it, expect } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import type { GameConfig, SeatConfig } from '../engine/game';
import { DEFAULT_RULES } from '../engine/ruleset';
import { handValue } from '../engine/hand';
import { makeDownswingShoe, buildDownswingScript, DECISION_LOSSES, SLACK_ROUNDS } from './downswingShoe';

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

/**
 * V3-7: THE INVARIANT THAT MAKES A REAL DECISION SAFE TO RIG.
 *
 * A rigged shoe is a script, and a script only survives while every round costs
 * the number of cards it was written to cost. The old rig got that for free by
 * dealing nothing but made 17-19s: the player always stood, the dealer never
 * drew, four cards, done — which is exactly why the drill had no play in it.
 *
 * `DECISION_LOSSES` buys the decision back without giving up the guarantee, and
 * these are the tests that hold it to that. For every scripted decision hand,
 * down every line a player can take: the hand LOSES, and it costs the same five
 * cards whether the player stood into a dealer draw-out or busted themselves.
 */
describe('DECISION_LOSSES (V3-7)', () => {
  /** Deal one decision round from a shoe holding exactly that round. */
  function riggedRound(ranks: readonly string[]): Game {
    const cards = ranks.map((rank) => ({ rank: rank as never, suit: 's' as const }));
    // A tail of tens so an unexpected extra draw is a wrong CARD COUNT rather
    // than a thrown "shoe exhausted", which would hide the real failure.
    const tail = Array.from({ length: 12 }, () => ({ rank: '10' as never, suit: 's' as const }));
    const game = Game.withRiggedShoe(soloCfg(), [...cards, ...tail]);
    game.startRound(1);
    return game;
  }

  it('deals a stiff hand with a real choice on it, never a pat hand', () => {
    for (const ranks of DECISION_LOSSES) {
      const game = riggedRound(ranks);
      expect(game.phase).toBe('player');
      const actions = game.legalActions();
      expect(actions).toContain('hit');
      expect(actions).toContain('stand');

      // THE STIFFNESS IS THE POINT, and legality is not evidence of it: hit,
      // stand, double and surrender are all legal on any two-card hand, so a
      // made 18 would pass a "more than one button" check while being exactly
      // the pat wall this family exists to replace.
      const total = handValue(game.hands[0]!.cards).total;
      expect(total, ranks.join(',')).toBeGreaterThanOrEqual(12);
      expect(total, ranks.join(',')).toBeLessThanOrEqual(16);
    }
  });

  /**
   * The structural reason standing always loses: the dealer's two cards total
   * 7-11, so the single card they draw takes them to 17-21 and NEVER busts.
   * A dealer total outside that window is how a "guaranteed" losing hand turns
   * into one the player wins by standing.
   */
  it('gives the dealer a two-card total of 7-11, so their draw cannot bust', () => {
    for (const ranks of DECISION_LOSSES) {
      const game = riggedRound(ranks);
      // Up-card plus hole, before the draw-out.
      const dealerTwo = handValue(game.dealerCards.slice(0, 2)).total;
      expect(dealerTwo, ranks.join(',')).toBeGreaterThanOrEqual(7);
      expect(dealerTwo, ranks.join(',')).toBeLessThanOrEqual(11);
    }
  });

  it('never deals an Ace, so there is no insurance or peek detour', () => {
    for (const ranks of DECISION_LOSSES) {
      expect(ranks).not.toContain('A');
    }
  });

  it('never deals a pair, so there is no split branch to script for', () => {
    for (const ranks of DECISION_LOSSES) {
      expect(ranks[0]).not.toBe(ranks[2]);
      const game = riggedRound(ranks);
      expect(game.legalActions()).not.toContain('split');
    }
  });

  /** The premise of the whole drill: you cannot win these. */
  it('loses down every line the player can take', () => {
    for (const ranks of DECISION_LOSSES) {
      for (const action of ['stand', 'hit', 'double'] as const) {
        const game = riggedRound(ranks);
        expect(game.legalActions()).toContain(action);
        game.act(action);
        while (game.phase === 'player') game.act('stand');
        const hand = game.hands[0]!;
        expect(hand.result, ranks.join(',') + ' via ' + action).toBe('lose');
        expect(hand.net!).toBeLessThan(0);
      }
    }
  });

  /**
   * The alignment guarantee. Stand costs four dealt cards plus the dealer's one
   * draw-out; hit and double cost the player's one card and then the dealer
   * takes none, because a busted solo table leaves no live hand to draw against
   * (game.ts's playDealerAndSettle). Five either way.
   */
  it('costs exactly five cards whether the player stands, hits, or doubles', () => {
    for (const ranks of DECISION_LOSSES) {
      for (const action of ['stand', 'hit', 'double'] as const) {
        const game = riggedRound(ranks);
        game.act(action);
        while (game.phase === 'player') game.act('stand');
        expect(game.shoe.cardsDealt, ranks.join(',') + ' via ' + action).toBe(5);
      }
    }
    // ...and the scripts really are five cards long, so the boundary table and
    // the assertions above are talking about the same thing.
    for (const ranks of DECISION_LOSSES) expect(ranks).toHaveLength(5);
  });

  /**
   * Surrender is the one line that costs four, and it is never correct against
   * a 2-8 up-card. It is graded as the mistake it is; the alignment it breaks
   * is repaired by the view's realignment, tested below.
   */
  it('is four cards on a surrender, which is why realignment exists', () => {
    const game = riggedRound(DECISION_LOSSES[0]!);
    expect(game.legalActions()).toContain('surrender');
    game.act('surrender');
    while (game.phase === 'player') game.act('stand');
    expect(game.shoe.cardsDealt).toBe(4);
    expect(game.hands[0]!.net!).toBeLessThan(0);
  });
});

describe('buildDownswingScript (V3-7)', () => {
  it('reports a boundary per scripted round, matching the cards it emitted', () => {
    const { cards, boundaries } = buildDownswingScript(10, 99);
    expect(boundaries).toHaveLength(10 + SLACK_ROUNDS);
    // Strictly increasing, and every boundary lands inside the card list.
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]!).toBeGreaterThan(boundaries[i - 1]!);
    }
    expect(boundaries.at(-1)!).toBeLessThanOrEqual(cards.length);

    // They are round ENDS, not round starts. Off by one round, every
    // realignment would land the shoe on the card before a hand rather than on
    // its first -- and "strictly increasing" is just as true of starts, so it
    // is the endpoints that have to be pinned.
    expect(boundaries[0]!).toBeGreaterThanOrEqual(4);
    // The last boundary is the end of the last scripted round: everything after
    // it is the 8-card safety buffer, which belongs to no round.
    expect(cards.length - boundaries.at(-1)!).toBe(8);
  });

  it('scripts more rounds than will be played, so realignment cannot run it dry', () => {
    const { boundaries } = buildDownswingScript(25, 5);
    expect(boundaries.length).toBeGreaterThan(25);
  });

  it('is deterministic for a seed, boundaries included', () => {
    const a = buildDownswingScript(12, 31);
    const b = buildDownswingScript(12, 31);
    expect(b.boundaries).toEqual(a.boundaries);
    expect(b.cards.map((c) => c.rank)).toEqual(a.cards.map((c) => c.rank));
  });

  it('actually mixes decision hands into a session, rather than promising them', () => {
    // Across several seeds, at least one round must be a five-card stiff. A
    // family that never got drawn would leave the drill exactly as it was.
    const seen = [1, 2, 3, 4, 5].some((seed) => {
      const { boundaries } = buildDownswingScript(25, seed);
      const lengths = boundaries.map((b, i) => b - (i === 0 ? 0 : boundaries[i - 1]!));
      return lengths.includes(5);
    });
    expect(seen).toBe(true);
  });
});

describe('discardRiggedCards realignment (V3-7)', () => {
  it('skips the shoe forward without dealing or counting the skipped cards', () => {
    const game = Game.withRiggedShoe(soloCfg(), makeDownswingShoe(5, 3));
    const countBefore = game.runningCount;
    const dealtBefore = game.shoe.cardsDealt;
    game.discardRiggedCards(3);
    expect(game.runningCount).toBe(countBefore);
    expect(game.shoe.cardsDealt).toBe(dealtBefore + 3);
  });

  it('lands exactly on a round boundary after an off-script surrender', () => {
    const { cards, boundaries } = buildDownswingScript(6, 17);
    const game = Game.withRiggedShoe(soloCfg(), cards);
    game.startRound(1);
    // Take the cheapest line available, off-script or not.
    const action = game.legalActions().includes('surrender') ? 'surrender' : 'stand';
    game.act(action);
    while (game.phase === 'player') game.act('stand');

    const dealt = game.shoe.cardsDealt;
    const boundary = boundaries.find((b) => b >= dealt)!;
    game.discardRiggedCards(boundary - dealt);
    expect(game.shoe.cardsDealt).toBe(boundary);
    // Which is to say: the next card dealt is the first card of a round.
    expect(boundaries).toContain(game.shoe.cardsDealt);
  });

  it('refuses on a real shoe rather than silently burning cards out of a live game', () => {
    const game = new Game(soloCfg());
    expect(() => game.discardRiggedCards(3)).toThrow(/rigged/);
  });
});
