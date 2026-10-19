import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { Game } from './game';
import type { GameConfig, SeatConfig, SpreadRow } from './game';
import { spreadHandsFor, spreadHasTwoHands } from './wong';

/**
 * Wave J, Part 2: spreading to two hands at high counts. A ramp row can call
 * for two hands of its units; with the seat set to one hand, each round opens
 * with one hand or two, and the bet decision is graded on the hand count and
 * the stake together.
 */

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

/** 1u at any count, 2u at +1, 4u at +2, 8u at +3, two hands of 8u at +4, two of 12u at +5. */
const RAMP: SpreadRow[] = [
  { minTc: -99, units: 1 },
  { minTc: 1, units: 2 },
  { minTc: 2, units: 4 },
  { minTc: 3, units: 8 },
  { minTc: 4, units: 8, hands: 2 },
  { minTc: 5, units: 12, hands: 2 },
];

const SOLO: SeatConfig = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };

function cfg(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    penetration: 1,
    betSpreadOn: true,
    spread: RAMP,
    seats: SOLO,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 1,
    ...overrides,
  };
}

/**
 * Two player hands, no bots: pass 1 deals hand 1 (the right one) then hand 0,
 * the dealer's up-card, pass 2 the same, then the hole.
 */
const TWO_HANDS_STAND: Rank[] = ['10', '10', '10', '9', '9', '7']; // both 19 v dealer 10/7
const ONE_HAND_STAND: Rank[] = ['10', '10', '9', '7']; // 19 v dealer 10/7

const bets = (g: Game) => g.events.filter((e) => e.kind === 'bet');

describe('wong.ts: the hand column', () => {
  it.each([
    [-5, 1],
    [0, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [9, 2],
  ])('tc %i calls for %i hand(s)', (tc, hands) => {
    expect(spreadHandsFor(tc, RAMP)).toBe(hands);
  });

  it('absent everywhere is one hand everywhere', () => {
    const plain = RAMP.map(({ minTc, units }) => ({ minTc, units }));
    expect(spreadHasTwoHands(plain)).toBe(false);
    expect(spreadHandsFor(9, plain)).toBe(1);
    expect(spreadHasTwoHands(RAMP)).toBe(true);
  });
});

describe('Game.spreadsHands', () => {
  it('needs a one-hand seat, a spread on and a ×2 row', () => {
    expect(new Game(cfg()).spreadsHands).toBe(true);
    expect(new Game(cfg({ betSpreadOn: false })).spreadsHands).toBe(false);
    expect(new Game(cfg({ spread: RAMP.map(({ minTc, units }) => ({ minTc, units })) })).spreadsHands).toBe(false);
    // A fixed two- or three-hand seat ignores the column.
    expect(new Game(cfg({ seats: { ...SOLO, playerHands: 2 } })).spreadsHands).toBe(false);
  });
});

describe('startRound with a ramp that spreads hands', () => {
  it('opens with one hand or two, as the bets array says', () => {
    const g = Game.withRiggedShoe(cfg(), rig(...TWO_HANDS_STAND));
    g.runningCount = 24; // tc +4
    g.startRound([8, 8]);
    expect(g.hands).toHaveLength(2);
    expect(g.hands.map((h) => h.bet)).toEqual([8, 8]);
  });

  it('refuses three hands, and refuses two where the ramp does not spread', () => {
    expect(() => new Game(cfg()).startRound([1, 1, 1])).toThrow();
    const plain = new Game(cfg({ spread: RAMP.map(({ minTc, units }) => ({ minTc, units })) }));
    expect(() => plain.startRound([1, 1])).toThrow();
    // A refused call leaves the game where it was.
    expect(plain.roundNo).toBe(0);
  });

  it('a fixed two-hand seat is unchanged: two bets, one event per hand', () => {
    const g = Game.withRiggedShoe(cfg({ seats: { ...SOLO, playerHands: 2 } }), rig(...TWO_HANDS_STAND));
    g.runningCount = 24;
    g.startRound([8, 8]);
    expect(bets(g)).toHaveLength(2);
    expect(bets(g)[0]!.handsTaken).toBeUndefined();
  });
});

describe('grading the hand count and the stake together', () => {
  /** One round at `rc` (6 decks fresh, so tc = rc / 6), returning its one bet event. */
  function graded(rc: number, stake: number[], overrides: Partial<GameConfig> = {}) {
    const script = stake.length === 2 ? TWO_HANDS_STAND : ONE_HAND_STAND;
    const g = Game.withRiggedShoe(cfg(overrides), rig(...script));
    g.runningCount = rc;
    g.startRound(stake);
    const b = bets(g);
    expect(b, 'one bet decision per round').toHaveLength(1);
    return b[0]!;
  }

  it('two hands of 8 at +4 is right, and says so on the event', () => {
    const e = graded(24, [8, 8]);
    expect(e.correct).toBe(true);
    expect(e.handsTaken).toBe(2);
    expect(e.handsExpected).toBe(2);
    expect(e.taken).toBe('8');
    expect(e.expected).toBe('8');
  });

  it('one hand of 8 at +4 is the hand count missed, though the stake is right', () => {
    const e = graded(24, [8]);
    expect(e.correct).toBe(false);
    expect(e.classification).toBe('basic-error');
    expect(e.handsTaken).toBe(1);
    expect(e.handsExpected).toBe(2);
  });

  it('two hands at +3 is the hand count overdone', () => {
    const e = graded(18, [8, 8]);
    expect(e.correct).toBe(false);
    expect(e.handsTaken).toBe(2);
    expect(e.handsExpected).toBe(1);
  });

  it('two hands of the wrong stake at +4 is wrong, and names the stake that is off', () => {
    const e = graded(24, [8, 4]);
    expect(e.correct).toBe(false);
    expect(e.taken).toBe('4');
  });

  it('one hand at a one-hand count is graded as the ramp always was', () => {
    expect(graded(6, [2]).correct).toBe(true);
    expect(graded(6, [4]).correct).toBe(false);
  });

  it('cover bets: a neighbouring rung on both hands is right, the hand count still has to match', () => {
    // 12u is the rung above 8u.
    expect(graded(24, [12, 12], { coverBets: true }).correct).toBe(true);
    expect(graded(24, [12], { coverBets: true }).correct).toBe(false);
    expect(graded(24, [12, 12]).correct).toBe(false);
  });

  it('the ramp says sit out: dealing in is the wong error alone, however many hands', () => {
    const g = Game.withRiggedShoe(cfg({ wongExitTc: 0 }), rig(...TWO_HANDS_STAND));
    g.startRound([1, 1]);
    expect(g.events.map((e) => e.kind)).toEqual(['wong']);
  });
});

describe('mixed one- and two-hand rounds in one shoe', () => {
  it('settles each round on the hands it opened with', () => {
    const g = Game.withRiggedShoe(cfg(), rig(...ONE_HAND_STAND, ...TWO_HANDS_STAND, ...ONE_HAND_STAND));
    g.startRound([1]);
    g.act('stand');
    expect(g.phase).toBe('settled');
    expect(g.hands).toHaveLength(1);
    expect(g.bankroll).toBe(101);

    g.runningCount = 24;
    g.startRound([8, 8]);
    expect(g.hands).toHaveLength(2);
    g.act('stand');
    g.act('stand');
    expect(g.phase).toBe('settled');
    expect(g.hands.map((h) => h.result)).toEqual(['win', 'win']);
    expect(g.bankroll).toBe(117);
    expect(g.handsPlayed).toBe(3);

    g.runningCount = 0;
    g.startRound([1]);
    expect(g.hands).toHaveLength(1);
    g.act('stand');
    expect(g.bankroll).toBe(118);
    expect(bets(g).map((e) => e.correct)).toEqual([true, true, true]);
  });

  it('a split on the two-hand round: the pair splits, the other hand plays on', () => {
    // Hand 1 (right) 10/9, hand 0 (left) 8/8; dealer 10/7. The split draws 10 and 10.
    const g = Game.withRiggedShoe(cfg(), rig('10', '8', '10', '9', '8', '7', '10', '10'));
    g.runningCount = 24;
    g.startRound([8, 8]);
    expect(g.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([
      ['8', '8'],
      ['10', '9'],
    ]);
    // Order of play: the right hand (index 1) first.
    expect(g.active).toBe(1);
    g.act('stand');
    expect(g.active).toBe(0);
    expect(g.legalActions()).toContain('split');
    g.act('split');
    expect(g.hands).toHaveLength(3);
    while (g.phase === 'player') g.act('stand');
    expect(g.phase).toBe('settled');
    // 18, 18 and 19 against 17: three wins of 8.
    expect(g.hands.every((h) => h.result === 'win')).toBe(true);
    expect(g.bankroll).toBe(124);
  });

  it('insurance covers both hands: one decision on the summed stake', () => {
    // Both hands 10/9, dealer A up with a 10 in the hole.
    const g = Game.withRiggedShoe(cfg(), rig('10', '10', 'A', '9', '9', '10'));
    g.runningCount = 24;
    g.startRound([8, 8]);
    expect(g.phase).toBe('insurance');
    g.insuranceDecision(true);
    expect(g.phase).toBe('settled');
    // Insured 8 on a 16 stake pays 16; both hands lose 8.
    expect(g.insuranceNet).toBe(16);
    expect(g.bankroll).toBe(100);
    expect(g.events.filter((e) => e.kind === 'insurance')).toHaveLength(1);
  });

  it('a dealer error can land on the second hand, and Foul puts it right', () => {
    const scripted = [0, 0.99, 0];
    let i = 0;
    const rng = () => (i < scripted.length ? scripted[i++]! : 0.99);
    const g = Game.withRiggedShoe(cfg({ dealerMistakes: true, dealerErrorRng: rng }), rig(...TWO_HANDS_STAND));
    g.runningCount = 24;
    g.startRound([8, 8]);
    g.act('stand');
    g.act('stand');
    expect(g.dealerError).not.toBeNull();
    const wrongBankroll = g.bankroll;
    expect(wrongBankroll).not.toBe(116);
    const verdict = g.callFoul();
    expect(verdict?.correct).toBe(true);
    expect(g.bankroll).toBe(116);
  });
});

describe('the card reserve is sized for two hands', () => {
  it('a shoe deep enough for one hand but not two shuffles when the ramp can spread', () => {
    // 6 decks at 95%: the cut at floor(296.4) = 296. At 286 dealt, 26 left:
    // one hand needs 4 x 1 + 20 = 24, two need 4 x 2 + 20 = 28.
    const deep = (spread: SpreadRow[]) => {
      const g = new Game(cfg({ penetration: 0.95, spread }));
      for (let i = 0; i < 286; i++) g.shoe.draw();
      expect(g.shoe.cutCardReached).toBe(false);
      return g;
    };
    expect(deep(RAMP.map(({ minTc, units }) => ({ minTc, units }))).shuffleDue).toBe(false);
    expect(deep(RAMP).shuffleDue).toBe(true);
  });

  it('the deal that shuffles opens two hands on a full shoe', () => {
    const g = new Game(cfg({ penetration: 0.95 }));
    for (let i = 0; i < 286; i++) g.shoe.draw();
    g.startRound([1, 1]);
    expect(g.shuffledLastRound).toBe(true);
    expect(g.hands).toHaveLength(2);
  });
});

describe('review S3b: back-counting with a ramp that spreads hands', () => {
  it('a watcher sits in with two hands at a two-hand count: the entry, then one bet decision on both', () => {
    // Three bots on 20 (the 0-bot profile watches three), two player hands of 19, dealer 10/7.
    // Pass 1: hand 1, hand 0, bots x3, up; pass 2 the same; hole.
    const cards = rig('10', '10', '10', '10', '10', '10', '9', '9', '10', '10', '10', '7');
    const g = Game.withRiggedShoe(cfg({ backCount: true }), cards);
    expect(g.watching).toBe(true);
    g.runningCount = 24; // tc +4: enter (+1), two hands of 8
    g.startRound([8, 8]);
    expect(g.events.map((e) => [e.kind, e.correct])).toEqual([
      ['wongIn', true],
      ['bet', true],
    ]);
    const bet = g.events.at(-1)!;
    expect([bet.handsTaken, bet.handsExpected]).toEqual([2, 2]);
    expect(g.hands).toHaveLength(2);
    expect(g.seats.filter((s) => s.kind === 'bot')).toHaveLength(3);
  });

  it('the reserve counts three watched bots and two hands: 4 x (3 + 2) + 20 = 40', () => {
    // 95% of 6 decks: the cut at 296. At 275 dealt, 37 left: enough for
    // 3 bots + 1 hand (36), not for 3 bots + 2 hands (40).
    const deep = (spread: SpreadRow[]) => {
      const g = new Game(cfg({ penetration: 0.95, backCount: true, spread }));
      for (let i = 0; i < 275; i++) g.shoe.draw();
      expect(g.shoe.cutCardReached).toBe(false);
      return g;
    };
    expect(deep(RAMP.map(({ minTc, units }) => ({ minTc, units }))).shuffleDue).toBe(false);
    expect(deep(RAMP).shuffleDue).toBe(true);
  });
});
