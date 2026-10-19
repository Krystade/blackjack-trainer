import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig, SeatConfig } from './game';
import { BACK_COUNT_BOTS, DEFAULT_WONG_IN_TC, sitInIsCorrect, startShoeOutOf, wongInTcOf } from './wong';

/**
 * Wave J, toggle rework: the table's In/Out toggle. Deal deals the next round
 * with the player in or out as the toggle says, at the same table; the
 * choice is graded from the LAST round's state, with hysteresis -- in last
 * round, staying in is right unless TC <= the exit point; out last round,
 * staying out is right unless TC >= the entry point. "Start each shoe out"
 * turns the toggle Out as every fresh shoe starts.
 */

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

/** Three bots on 20 and a dealer 10/7: a round out that draws nothing more. */
const OUT_ROUND: Rank[] = ['10', '10', '10', '10', '10', '10', '10', '7'];
/** The player (first base) on 10/9, three bots on 20, dealer 10/7. */
const IN_ROUND: Rank[] = ['10', '10', '10', '10', '10', '9', '10', '10', '10', '7'];
const THREE_BOTS: SeatConfig = { bots: 3, playerHands: 1, playerPosition: 0, botMistakePct: 0 };

function cfg(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    // The cut sits at the end of the script, so no test shuffles by accident.
    penetration: 1,
    betSpreadOn: true,
    seats: THREE_BOTS,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 1,
    ...overrides,
  };
}

/** A game over scripted rounds; rc is pinned per test so tc = rc / 6 before each deal. */
function game(rounds: Rank[][], overrides: Partial<GameConfig> = {}): Game {
  return Game.withRiggedShoe(cfg(overrides), rig(...rounds.flat()));
}

const kinds = (g: Game) => g.events.map((e) => e.kind);
const last = (g: Game) => g.events.at(-1)!;

/** A game that played its first round IN (a right bet at tc +1), so the next decision is an exit. */
function wasIn(rounds: Rank[][], overrides: Partial<GameConfig> = {}): Game {
  const g = game([IN_ROUND, ...rounds], overrides);
  g.runningCount = 6;
  g.startRound(2);
  g.act('stand');
  expect(g.isIn).toBe(true);
  return g;
}

/** A game that sat its first round OUT (a right stay-out at tc 0), so the next decision is an entry. */
function wasOut(rounds: Rank[][], overrides: Partial<GameConfig> = {}): Game {
  const g = game([OUT_ROUND, ...rounds], { startShoeOut: true, ...overrides });
  g.runningCount = 0;
  g.sitOut();
  expect(g.isIn).toBe(false);
  return g;
}

describe('wong.ts: the entry point and "start each shoe out"', () => {
  it('the entry defaults to +1 and clamps to 0..+5', () => {
    expect(DEFAULT_WONG_IN_TC).toBe(1);
    expect(wongInTcOf(undefined)).toBe(1);
    expect(wongInTcOf(-3)).toBe(0);
    expect(wongInTcOf(9)).toBe(5);
    expect(wongInTcOf(2.4)).toBe(2);
    expect(wongInTcOf(Number.NaN)).toBe(1);
  });

  it.each([
    [0, 1, false],
    [1, 1, true],
    [-1, 0, false],
    [0, 0, true],
    [5, 5, true],
  ])('tc %i, entry %i: getting in is right = %s', (tc, entry, ok) => {
    expect(sitInIsCorrect(tc, entry)).toBe(ok);
  });

  it('old data: a stored backCount: true reads as "start each shoe out"; the new field wins', () => {
    expect(startShoeOutOf({})).toBe(false);
    expect(startShoeOutOf({ backCount: true })).toBe(true);
    expect(startShoeOutOf({ backCount: false })).toBe(false);
    expect(startShoeOutOf({ startShoeOut: true })).toBe(true);
    expect(startShoeOutOf({ backCount: true, startShoeOut: false })).toBe(false);
  });
});

describe('the toggle', () => {
  it('starts In; "start each shoe out" (or the legacy backCount) starts it Out', () => {
    expect(game([OUT_ROUND]).isIn).toBe(true);
    expect(game([OUT_ROUND], { startShoeOut: true }).isIn).toBe(false);
    expect(game([OUT_ROUND], { backCount: true }).isIn).toBe(false);
    expect(game([OUT_ROUND], { backCount: true }).watching).toBe(true);
  });

  it('flipping it grades nothing and deals nothing', () => {
    const g = game([OUT_ROUND]);
    g.setIn(false);
    expect(g.isIn).toBe(false);
    g.setIn(true);
    expect(g.events).toHaveLength(0);
    expect(g.roundNo).toBe(0);
  });

  it('a round out deals to the bots and the dealer only, and the count moves', () => {
    const g = game([OUT_ROUND]);
    const bankroll = g.bankroll;
    g.sitOut();
    expect(g.hands).toHaveLength(0);
    expect(g.phase).toBe('settled');
    expect(g.roundNo).toBe(1);
    expect(g.bankroll).toBe(bankroll);
    expect(g.runningCount).toBe(-7);
    expect(g.shoe.cardsDealt).toBe(8);
    expect(g.isIn).toBe(false);
  });

  it('getting out keeps the same table: no shuffle, the count carries on', () => {
    const g = wasIn([OUT_ROUND, IN_ROUND]);
    g.runningCount = -12;
    g.sitOut();
    expect(g.shuffledLastRound).toBe(false);
    expect(g.shuffleDue).toBe(false);
    expect(g.runningCount).toBe(-12 - 7);
    // ...and back in, still no shuffle.
    g.startRound(1);
    expect(g.shuffledLastRound).toBe(false);
  });

  it('it stays where it was put across rounds and shoes without "start each shoe out"', () => {
    const g = Game.withRiggedShoe(cfg({ penetration: 0.5 }), rig(...OUT_ROUND, ...OUT_ROUND));
    g.sitOut();
    expect(g.shuffleDue).toBe(true);
    expect(g.isIn).toBe(false);
    g.setIn(true);
    // A fresh shoe does not move it.
    expect(g.isIn).toBe(true);
  });

  it(`with no bots set, a player Out (or starting shoes out) watches ${BACK_COUNT_BOTS} bots; In, none`, () => {
    const solo: SeatConfig = { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 };
    const out = Game.withRiggedShoe(cfg({ seats: solo }), rig(...OUT_ROUND));
    out.sitOut();
    expect(out.seats.filter((s) => s.kind === 'bot')).toHaveLength(BACK_COUNT_BOTS);

    const startOut = Game.withRiggedShoe(cfg({ seats: solo, startShoeOut: true }), rig(...IN_ROUND));
    startOut.startRound(1);
    expect(startOut.seats.filter((s) => s.kind === 'bot')).toHaveLength(BACK_COUNT_BOTS);

    const inSolo = Game.withRiggedShoe(cfg({ seats: solo }), rig('10', '9', '10', '7'));
    inSolo.startRound(1);
    expect(inSolo.seats.filter((s) => s.kind === 'bot')).toHaveLength(0);
  });

  it('a profile with bots keeps its own number, In or Out', () => {
    const seats: SeatConfig = { bots: 1, playerHands: 1, playerPosition: 0, botMistakePct: 0 };
    const g = game([['10', '10', '10', '7']], { seats, startShoeOut: true });
    g.sitOut();
    expect(g.seats.filter((s) => s.kind === 'bot')).toHaveLength(1);
  });

  it('getting out is refused under a live hand (review N4)', () => {
    const g = game([['10', '10', '10', '10', '6', '10', '10', '10', '10', '7']]);
    g.runningCount = 6;
    g.startRound(2);
    expect(g.phase).toBe('player');
    expect(() => g.sitOut()).toThrow();
    expect(g.events.filter((e) => e.kind === 'wong')).toHaveLength(0);
  });
});

describe('grading, from In: the exit point (-2)', () => {
  it.each([
    [-3, true],
    [-2, true],
    [-1, false],
    [0, false],
  ])('getting out at tc %i is right = %s', (tc, ok) => {
    const g = wasIn([OUT_ROUND]);
    g.runningCount = 6 * tc;
    g.sitOut();
    const e = last(g);
    expect(e.kind).toBe('wong');
    expect(e.correct).toBe(ok);
    expect(e.taken).toBe('sit-out');
    expect(e.expected).toBe(ok ? 'sit-out' : 'play');
    expect(e.wongExitTc).toBe(-2);
  });

  it.each([
    [-3, false],
    [-2, false],
    [-1, true],
    [0, true],
  ])('staying in at tc %i is right = %s', (tc, ok) => {
    const g = wasIn([IN_ROUND]);
    g.runningCount = 6 * tc;
    g.startRound(1);
    const e = last(g);
    // Right: the stake is graded (1u is the ramp's bet below +1). Wrong: the exit alone.
    expect(e.kind).toBe(ok ? 'bet' : 'wong');
    expect(e.correct).toBe(ok);
    if (!ok) expect(e.wongExitTc).toBe(-2);
  });
});

describe('grading, from Out: the entry point (+1)', () => {
  it.each([
    [-1, true],
    [0, true],
    [1, false],
    [2, false],
  ])('staying out at tc %i is right = %s', (tc, ok) => {
    const g = wasOut([OUT_ROUND]);
    g.runningCount = 6 * tc;
    g.sitOut();
    const e = last(g);
    expect(e.kind).toBe('wongIn');
    expect(e.correct).toBe(ok);
    expect(e.taken).toBe('watch');
    expect(e.expected).toBe(ok ? 'watch' : 'sit-in');
    expect(e.wongInTc).toBe(1);
  });

  it.each([
    [0, false],
    [1, true],
    [3, true],
  ])('getting in at tc %i is right = %s', (tc, ok) => {
    const g = wasOut([IN_ROUND]);
    g.runningCount = 6 * tc;
    g.startRound(1);
    const entry = g.events.filter((e) => e.kind === 'wongIn').at(-1)!;
    expect(entry.correct).toBe(ok);
    expect(entry.taken).toBe('sit-in');
    expect(g.hands).toHaveLength(1);
    expect(g.isIn).toBe(true);
  });

  it('a right entry also grades the stake; a wrong one is graded alone', () => {
    const right = wasOut([IN_ROUND]);
    right.runningCount = 12; // tc +2: the ramp bets 4
    const before = right.events.length;
    right.startRound(1);
    expect(kinds(right).slice(before)).toEqual(['wongIn', 'bet']);
    expect(last(right).correct).toBe(false);
    expect(last(right).expected).toBe('4');

    const early = wasOut([IN_ROUND]);
    early.runningCount = 0;
    const at = early.events.length;
    early.startRound(8);
    expect(kinds(early).slice(at)).toEqual(['wongIn']);
  });

  it('a custom entry point moves the line', () => {
    const g = wasOut([OUT_ROUND], { wongInTc: 3 });
    g.runningCount = 12; // tc +2, below +3
    g.sitOut();
    expect(last(g).correct).toBe(true);
    expect(last(g).wongInTc).toBe(3);
  });
});

describe('hysteresis: between the exit and the entry point either state is right', () => {
  // Exit -2, entry +1: tc -1, 0 lie between.
  it.each([-1, 0])('at tc %i, staying in and staying out are both right', (tc) => {
    const stayIn = wasIn([IN_ROUND]);
    stayIn.runningCount = 6 * tc;
    stayIn.startRound(1);
    expect(stayIn.events.every((e) => e.correct)).toBe(true);

    const stayOut = wasOut([OUT_ROUND]);
    stayOut.runningCount = 6 * tc;
    stayOut.sitOut();
    expect(stayOut.events.every((e) => e.correct)).toBe(true);
  });

  it.each([-1, 0])('at tc %i, changing state is the miss either way', (tc) => {
    const getOut = wasIn([OUT_ROUND]);
    getOut.runningCount = 6 * tc;
    getOut.sitOut();
    expect(last(getOut).correct).toBe(false);

    const getIn = wasOut([IN_ROUND]);
    getIn.runningCount = 6 * tc;
    getIn.startRound(1);
    expect(getIn.events.filter((e) => e.kind === 'wongIn').at(-1)!.correct).toBe(false);
  });

  it('entry == exit == 0: In says get out at 0, Out says get in', () => {
    const stayIn = wasIn([IN_ROUND], { wongInTc: 0, wongExitTc: 0 });
    stayIn.runningCount = 0;
    stayIn.startRound(1);
    expect(last(stayIn).kind).toBe('wong');
    expect(last(stayIn).correct).toBe(false);

    const getIn = wasOut([IN_ROUND], { wongInTc: 0, wongExitTc: 0 });
    getIn.runningCount = 0;
    getIn.startRound(1);
    expect(getIn.events.filter((e) => e.kind === 'wongIn').at(-1)!.correct).toBe(true);
  });

  it('a flat-bet table grades neither', () => {
    const g = game([OUT_ROUND, IN_ROUND], { betSpreadOn: false });
    g.runningCount = 12;
    g.sitOut();
    g.startRound();
    expect(g.events.filter((e) => e.kind === 'wong' || e.kind === 'wongIn')).toHaveLength(0);
  });
});

describe('"start each shoe out"', () => {
  it('the round that brings out the cut card turns the toggle Out for the next shoe', () => {
    // 10 cards a round in; the cut at 10 comes out on the first round.
    const g = Game.withRiggedShoe(cfg({ penetration: 10 / 20, startShoeOut: true }), rig(...IN_ROUND, ...IN_ROUND));
    g.runningCount = 6;
    g.startRound(2);
    expect(g.isIn).toBe(true);
    g.act('stand');
    expect(g.shuffleDue).toBe(true);
    expect(g.isIn).toBe(false);
    // The next decision is graded from Out, at the fresh shoe's 0: getting in is early.
    g.startRound(2);
    expect(g.shuffledLastRound).toBe(true);
    const entry = g.events.filter((e) => e.kind === 'wongIn').at(-1)!;
    expect(entry.tc).toBe(0);
    expect(entry.correct).toBe(false);
  });

  it('a round that does not end the shoe leaves the toggle alone', () => {
    const g = game([IN_ROUND, IN_ROUND], { startShoeOut: true });
    g.runningCount = 6;
    g.startRound(2);
    g.act('stand');
    expect(g.shuffleDue).toBe(false);
    expect(g.isIn).toBe(true);
  });
});

describe('the card reserve counts the table a player Out watches', () => {
  it('a real shoe 33 cards from empty is too shallow for 3 bots + 1 hand, not for a solo seat', () => {
    // 90% penetration on 6 decks: the cut is at 280, so at 279 dealt only the
    // depth guard can call the shuffle. 4 x (3 + 1) + 20 = 36 > 33; solo 24.
    const deep = (startShoeOut: boolean) => {
      const g = new Game(cfg({ penetration: 0.9, startShoeOut, seats: { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 } }));
      for (let i = 0; i < 279; i++) g.shoe.draw();
      expect(g.shoe.cutCardReached).toBe(false);
      return g;
    };
    expect(deep(false).shuffleDue).toBe(false);
    expect(deep(true).shuffleDue).toBe(true);
  });
});

describe('review N5: rounding', () => {
  it("the entry is graded at the profile's TC rounding (rc 5 on 6 decks)", () => {
    const stayOutAt = (tcRounding: 'floor' | 'truncate' | 'round') => {
      const g = game([OUT_ROUND], { tcRounding, wongInTc: 1, startShoeOut: true });
      g.runningCount = 5;
      g.sitOut();
      return last(g);
    };
    // 5 / 6 = 0.83: floor and truncate say 0 (staying out is right), round says +1.
    expect(stayOutAt('floor').correct).toBe(true);
    expect(stayOutAt('truncate').correct).toBe(true);
    expect(stayOutAt('round').correct).toBe(false);
    expect(stayOutAt('round').tc).toBe(1);
  });
});
