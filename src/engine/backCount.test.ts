import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig, SeatConfig } from './game';
import { BACK_COUNT_BOTS, DEFAULT_WONG_IN_TC, sitInIsCorrect, wongInTcOf } from './wong';

/**
 * Wave J, Part 1: back-counting ("Wonging in"). Every shoe starts with the
 * player watching; each round asks Watch or Sit in, graded at the entry point;
 * once seated, sitting out is leaving for a new table.
 */

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

/** Three bots on 20 and a dealer 10/7: a watched round that draws nothing more. */
const WATCHED_ROUND: Rank[] = ['10', '10', '10', '10', '10', '10', '10', '7'];
/** The player (first base) on 10/9, three bots on 20, dealer 10/7. */
const SEATED_ROUND: Rank[] = ['10', '10', '10', '10', '10', '9', '10', '10', '10', '7'];

function cfg(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    // The cut sits at the end of the script, so no test shuffles by accident.
    penetration: 1,
    betSpreadOn: true,
    backCount: true,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 1,
    ...overrides,
  };
}

/** A back-count game over `rounds` scripted rounds, rc pinned so tc = rc / 6 before the first deal. */
function game(rounds: Rank[][], overrides: Partial<GameConfig> = {}): Game {
  return Game.withRiggedShoe(cfg(overrides), rig(...rounds.flat()));
}

const kinds = (g: Game) => g.events.map((e) => e.kind);
const entries = (g: Game) => g.events.filter((e) => e.kind === 'wongIn');

describe('wong.ts: the entry point', () => {
  it('defaults to +1 and clamps to 0..+5', () => {
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
    [2, 1, true],
    [-1, 0, false],
    [0, 0, true],
    [4, 5, false],
    [5, 5, true],
  ])('tc %i, entry %i: sitting in is right = %s', (tc, entry, ok) => {
    expect(sitInIsCorrect(tc, entry)).toBe(ok);
  });
});

describe('back-count: watching', () => {
  it('a shoe starts with the player watching; off without the setting or without a spread', () => {
    expect(game([WATCHED_ROUND]).watching).toBe(true);
    expect(game([WATCHED_ROUND], { backCount: false }).watching).toBe(false);
    // The entry decision is graded against the ramp, like the wong decision.
    expect(game([WATCHED_ROUND], { betSpreadOn: false }).watching).toBe(false);
  });

  it('a watched round deals to the bots and the dealer only, and the count moves', () => {
    const g = game([WATCHED_ROUND]);
    const bankroll = g.bankroll;
    g.watch();
    expect(g.hands).toHaveLength(0);
    expect(g.phase).toBe('settled');
    expect(g.roundNo).toBe(1);
    expect(g.bankroll).toBe(bankroll);
    // Seven tens and a seven, all seen (the dealer plays out against live bots).
    expect(g.runningCount).toBe(-7);
    expect(g.shoe.cardsDealt).toBe(8);
    expect(g.watching).toBe(true);
  });

  it(`with no bots in the profile, a back-counter watches ${BACK_COUNT_BOTS} bots`, () => {
    const g = game([WATCHED_ROUND]);
    g.watch();
    expect(g.seats.filter((s) => s.kind === 'bot')).toHaveLength(BACK_COUNT_BOTS);
  });

  it('a profile with bots keeps its own number', () => {
    const seats: SeatConfig = { bots: 1, playerHands: 1, playerPosition: 0, botMistakePct: 0 };
    const g = game([['10', '10', '10', '7']], { seats });
    g.watch();
    expect(g.seats.filter((s) => s.kind === 'bot')).toHaveLength(1);
  });

  it('back-count off: no bots are added and the seat is dealt as always', () => {
    const g = Game.withRiggedShoe(cfg({ backCount: false }), rig('10', '9', '10', '7'));
    g.startRound(1);
    expect(g.seats.filter((s) => s.kind === 'bot')).toHaveLength(0);
    expect(g.hands).toHaveLength(1);
  });

  it('sitOut() while watching is a watch', () => {
    const g = game([WATCHED_ROUND]);
    g.sitOut();
    expect(kinds(g)).toEqual(['wongIn']);
    expect(entries(g)[0]!.taken).toBe('watch');
    expect(g.hands).toHaveLength(0);
  });

  it('watch() while seated throws', () => {
    const g = game([SEATED_ROUND, WATCHED_ROUND]);
    g.runningCount = 6;
    g.startRound(2);
    g.act('stand');
    expect(() => g.watch()).toThrow();
  });
});

describe('back-count: the entry decision (one graded decision a round)', () => {
  // rc = 6 * tc with 6 decks unseen (see game.test.ts's D-R1 block).
  it.each([
    [0, true],
    [1, false],
    [2, false],
  ])('watching at tc %i (enter at +1) is graded correct = %s', (tc, ok) => {
    const g = game([WATCHED_ROUND]);
    g.runningCount = 6 * tc;
    expect(g.trueCountNow).toBe(tc);
    g.watch();
    expect(kinds(g)).toEqual(['wongIn']);
    const e = entries(g)[0]!;
    expect(e.correct).toBe(ok);
    expect(e.taken).toBe('watch');
    expect(e.expected).toBe(ok ? 'watch' : 'sit-in');
    expect(e.tc).toBe(tc);
    expect(e.wongInTc).toBe(1);
    expect(e.category).toBe('wongIn');
  });

  it.each([
    [0, false],
    [1, true],
    [3, true],
  ])('sitting in at tc %i (enter at +1) is graded correct = %s', (tc, ok) => {
    const g = game([SEATED_ROUND]);
    g.runningCount = 6 * tc;
    g.startRound(1);
    const e = entries(g)[0]!;
    expect(e.correct).toBe(ok);
    expect(e.taken).toBe('sit-in');
    expect(e.expected).toBe(ok ? 'sit-in' : 'watch');
    expect(g.hands).toHaveLength(1);
    expect(g.watching).toBe(false);
  });

  it('a correct entry also grades the stake; the exit check is not asked', () => {
    const g = game([SEATED_ROUND]);
    g.runningCount = 12; // tc +2: the ramp bets 4
    g.startRound(1);
    expect(kinds(g)).toEqual(['wongIn', 'bet']);
    expect(g.events[0]!.correct).toBe(true);
    expect(g.events[1]!.correct).toBe(false);
    expect(g.events[1]!.expected).toBe('4');
  });

  it('an early entry is graded as the entry alone: the stake is moot', () => {
    const g = game([SEATED_ROUND]);
    g.runningCount = 0;
    g.startRound(8);
    expect(kinds(g)).toEqual(['wongIn']);
    expect(g.events[0]!.correct).toBe(false);
  });

  it('a custom entry point moves the line', () => {
    const g = game([WATCHED_ROUND], { wongInTc: 3 });
    g.runningCount = 12; // tc +2, below +3
    g.watch();
    expect(entries(g)[0]!.correct).toBe(true);
    expect(entries(g)[0]!.wongInTc).toBe(3);
  });

  it('no entry decision with back-count off: the round is graded as before', () => {
    const g = Game.withRiggedShoe(cfg({ backCount: false }), rig('10', '9', '10', '7'));
    g.runningCount = 12;
    g.startRound(4);
    expect(kinds(g)).toEqual(['bet']);
  });
});

describe('back-count: entry == exit == 0 (the documented overlap)', () => {
  it('while watching the entry wins: sitting in at tc 0 is right, and no exit miss is filed', () => {
    const g = game([SEATED_ROUND], { wongInTc: 0, wongExitTc: 0 });
    g.runningCount = 0;
    g.startRound(1);
    expect(kinds(g)).toEqual(['wongIn', 'bet']);
    expect(g.events.every((e) => e.correct)).toBe(true);
  });

  it('while seated the exit wins: playing on at tc 0 is the miss, leaving is right', () => {
    const play = game([SEATED_ROUND, SEATED_ROUND], { wongInTc: 0, wongExitTc: 0 });
    play.runningCount = 0;
    play.startRound(1);
    play.act('stand');
    play.runningCount = 0;
    play.startRound(1);
    expect(play.events.at(-1)!.kind).toBe('wong');
    expect(play.events.at(-1)!.correct).toBe(false);

    const leave = game([SEATED_ROUND, WATCHED_ROUND], { wongInTc: 0, wongExitTc: 0 });
    leave.runningCount = 0;
    leave.startRound(1);
    leave.act('stand');
    leave.runningCount = 0;
    leave.sitOut();
    expect(leave.events.at(-1)!.kind).toBe('wong');
    expect(leave.events.at(-1)!.correct).toBe(true);
  });
});

describe('back-count: leaving the table', () => {
  function seated(): Game {
    const g = game([SEATED_ROUND, WATCHED_ROUND]);
    g.runningCount = 6; // tc +1: a right entry at the ramp's 2
    g.startRound(2);
    g.act('stand');
    expect(g.watching).toBe(false);
    return g;
  }

  it.each([
    [-2, true],
    [-1, false],
  ])('leaving at tc %i (exit -2) is graded as the sit-out is: correct = %s', (tc, ok) => {
    const g = seated();
    g.runningCount = 6 * tc;
    g.sitOut();
    const wong = g.events.at(-1)!;
    expect(wong.kind).toBe('wong');
    expect(wong.correct).toBe(ok);
    expect(wong.taken).toBe('leave');
    expect(wong.expected).toBe(ok ? 'leave' : 'play');
    expect(wong.tc).toBe(tc);
  });

  it('leaving deals nothing, and the next round is a new table: fresh shoe, watched', () => {
    const g = seated();
    const round = g.roundNo;
    g.runningCount = -12;
    g.sitOut();
    expect(g.roundNo).toBe(round);
    expect(g.phase).toBe('settled');
    expect(g.watching).toBe(true);
    expect(g.newTableNext).toBe(true);
    expect(g.shuffleDue).toBe(true);

    g.watch();
    expect(g.shuffledLastRound).toBe(true);
    expect(g.newTableLastRound).toBe(true);
    expect(g.newTableNext).toBe(false);
    // The fresh shoe's count, not the -2 the player walked away from.
    expect(entries(g).at(-1)!.tc).toBe(0);
    expect(entries(g).at(-1)!.correct).toBe(true);
    // Rigged shoes restock from the top: the first round of the script again.
    expect(g.hands).toHaveLength(0);
    expect(g.watching).toBe(true);
  });

  it('a cut-card shuffle is not a new table', () => {
    const g = Game.withRiggedShoe(cfg({ penetration: 0.5 }), rig(...WATCHED_ROUND, ...WATCHED_ROUND));
    g.watch();
    expect(g.shuffleDue).toBe(true);
    g.watch();
    expect(g.shuffledLastRound).toBe(true);
    expect(g.newTableLastRound).toBe(false);
  });
});

describe('back-count: the shoe ends under a seated player', () => {
  it('the round that brings out the cut card leaves the player watching for the next shoe', () => {
    // 10 cards a seated round; the cut at 10 comes out on the first round.
    const g = Game.withRiggedShoe(cfg({ penetration: 10 / 20 }), rig(...SEATED_ROUND, ...SEATED_ROUND));
    g.runningCount = 6;
    g.startRound(2);
    expect(g.watching).toBe(false);
    g.act('stand');
    expect(g.phase).toBe('settled');
    expect(g.shuffleDue).toBe(true);
    expect(g.watching).toBe(true);
    // The next decision is an entry, graded at the fresh shoe's 0.
    g.startRound(2);
    expect(g.shuffledLastRound).toBe(true);
    expect(entries(g).at(-1)!.tc).toBe(0);
    expect(entries(g).at(-1)!.correct).toBe(false);
  });

  it('a round that does not end the shoe keeps the seat', () => {
    const g = game([SEATED_ROUND, SEATED_ROUND]);
    g.runningCount = 6;
    g.startRound(2);
    g.act('stand');
    expect(g.shuffleDue).toBe(false);
    expect(g.watching).toBe(false);
    g.runningCount = 6;
    g.startRound(2);
    expect(g.events.at(-1)!.kind).toBe('bet');
  });
});

describe('back-count: the card reserve counts the table the back-counter watches', () => {
  it('a real shoe 33 cards from empty is too shallow for 3 bots + 1 hand, not for a solo seat', () => {
    // 90% penetration on 6 decks: the cut is at floor(280.8) = 280, so at 279
    // dealt it is not out yet, and only the depth guard can call the shuffle.
    // 4 x (3 + 1) + 20 = 36 > 33 left; solo, 4 x 1 + 20 = 24 <= 33.
    const deep = (backCount: boolean) => {
      const g = new Game(cfg({ penetration: 0.9, backCount }));
      for (let i = 0; i < 279; i++) g.shoe.draw();
      expect(g.shoe.cutCardReached).toBe(false);
      return g;
    };
    expect(deep(false).shuffleDue).toBe(false);
    expect(deep(true).shuffleDue).toBe(true);
  });
});
