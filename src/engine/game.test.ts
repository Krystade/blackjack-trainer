import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { hiLoTag } from './count';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig } from './game';

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
    seed: 1,
    ...overrides,
  };
}

describe('happy path', () => {
  it('P(10,6) D(9,8): hit to 21, stand, dealer plays, settles win, bankroll matches', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    game.startRound();
    expect(game.phase).toBe('player');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6']);
    expect(game.dealerCards[0].rank).toBe('9');

    game.act('hit');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6', '5']); // 21

    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['9', '8']); // hard 17, no extra draw
    expect(game.hands[0].result).toBe('win');
    expect(game.hands[0].net).toBe(1);
    expect(game.bankroll).toBe(cfg().bankrollStart + 1);
  });
});

describe('bust', () => {
  it('P(10,6) hit into a King -> lose, net -1, phase settled', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '5', '6', '5', 'K'));
    game.startRound();
    game.act('hit');
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);
    expect(game.phase).toBe('settled');
  });
});

describe('blackjack', () => {
  it('P(A,K) vs D(9,8) -> immediate settle, net +1.5, result blackjack', () => {
    const game = Game.withRiggedShoe(cfg(), rig('A', '9', 'K', '8'));
    game.startRound();
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.hands[0].net).toBe(1.5);
    expect(game.bankroll).toBe(cfg().bankrollStart + 1.5);
  });
});

describe('dealer BJ peek', () => {
  it('D(A up, K hole) vs P(10,6) -> insurance -> settled lose, each card counted exactly once', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', 'K'));
    game.startRound();
    expect(game.phase).toBe('insurance');

    game.insuranceDecision(false);
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);
    expect(game.holeRevealed).toBe(true);
    expect(game.runningCount).toBe(hiLoTag('A') + hiLoTag('K') + hiLoTag('10') + hiLoTag('6'));
  });
});

describe('player BJ vs dealer BJ', () => {
  it('both blackjack -> push, net 0', () => {
    const game = Game.withRiggedShoe(cfg(), rig('A', 'A', 'K', 'K'));
    game.startRound();
    expect(game.phase).toBe('insurance');
    game.insuranceDecision(false);
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('push');
    expect(game.hands[0].net).toBe(0);
  });
});

describe('insurance grading', () => {
  it('tc >= 3 at offer -> take:true is correct', () => {
    // Filler round builds a strongly positive count: P(3,2) v D(2 up, 2 hole),
    // dealer hits low cards up to 18 (7 more 2's). All +1 tags.
    const filler: Rank[] = ['3', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2'];
    const round2: Rank[] = ['2', 'A', '3', '2'];
    // Padding keeps the rigged cut card (rig length * penetration) beyond the
    // 11 cards round 1 consumes, so round 2 does NOT reshuffle the count away.
    const padding: Rank[] = ['2', '2', '2', '2', '2'];
    const game = Game.withRiggedShoe(cfg(), rig(...filler, ...round2, ...padding));

    game.startRound();
    game.act('stand'); // dealer plays out and settles the filler round

    game.startRound();
    expect(game.phase).toBe('insurance');
    expect(game.trueCountNow).toBeGreaterThanOrEqual(3);

    game.insuranceDecision(true);
    const ev = game.events[game.events.length - 1];
    expect(ev.kind).toBe('insurance');
    expect(ev.category).toBe('insurance');
    expect(ev.correct).toBe(true);
    expect(ev.taken).toBe('take');
    expect(ev.expected).toBe('take');
  });

  it('tc < 3 at offer -> take:true is wrong (decline is correct)', () => {
    const game = Game.withRiggedShoe(cfg(), rig('2', 'A', '2', '2'));
    game.startRound();
    expect(game.phase).toBe('insurance');
    expect(game.trueCountNow).toBeLessThan(3);

    game.insuranceDecision(true);
    const ev = game.events[game.events.length - 1];
    expect(ev.correct).toBe(false);
    expect(ev.taken).toBe('take');
    expect(ev.expected).toBe('decline');
  });
});

describe('split', () => {
  it('P(8,8) v 6 -> split deals a second card to each of 2 hands', () => {
    const game = Game.withRiggedShoe(cfg(), rig('8', '6', '8', '2', '2', '3'));
    game.startRound();
    expect(game.legalActions()).toContain('split');

    game.act('split');
    expect(game.hands.length).toBe(2);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '2']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '3']);
    expect(game.hands[0].fromSplit).toBe(true);
    expect(game.hands[1].fromSplit).toBe(true);
  });

  it('resplit chain (8,8,8,8,...) reaches 4 hands, then split is no longer legal', () => {
    const game = Game.withRiggedShoe(cfg(), rig('8', '6', '8', '2', '8', '8', '8', '8', '2', '3'));
    game.startRound();

    game.act('split'); // 1 -> 2 hands, both re-form pairs of 8
    expect(game.hands.length).toBe(2);
    expect(game.legalActions()).toContain('split');

    game.act('split'); // 2 -> 3 hands
    expect(game.hands.length).toBe(3);
    expect(game.legalActions()).toContain('split');

    game.act('split'); // 3 -> 4 hands (cap)
    expect(game.hands.length).toBe(4);
    expect(game.legalActions()).not.toContain('split');
  });
});

describe('split aces', () => {
  it('each ace hand gets exactly one card, is done, and pays 1x (not 1.5x) on 21', () => {
    const game = Game.withRiggedShoe(cfg(), rig('A', '6', 'A', '2', 'K', '2', '10'));
    game.startRound();
    expect(game.legalActions()).toContain('split');

    game.act('split');
    expect(game.hands.length).toBe(2);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', 'K']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', '2']);
    expect(game.hands[0].done).toBe(true);
    expect(game.hands[1].done).toBe(true);
    expect(game.hands[0].splitAces).toBe(true);
    expect(game.legalActions()).toEqual([]); // no hit legal for a split-ace hand

    // Round auto-completes (both hands done): dealer (6,2) hits H17 to 18.
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('win'); // 21 beats 18
    expect(game.hands[0].net).toBe(1); // 1x, NOT blackjack 1.5x
  });
});

describe('double', () => {
  it('legal only on the first two cards; doubled hand gets exactly 1 card then done; win pays +2', () => {
    const game = Game.withRiggedShoe(cfg(), rig('5', '6', '6', '2', '10', '9'));
    game.startRound();
    expect(game.legalActions()).toContain('double');

    game.act('double');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['5', '6', '10']);
    expect(game.hands[0].doubled).toBe(true);
    expect(game.hands[0].done).toBe(true);
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('win');
    expect(game.hands[0].net).toBe(2);
  });

  it('double is no longer legal after a hit', () => {
    const game = Game.withRiggedShoe(cfg(), rig('5', '6', '6', '2', '3'));
    game.startRound();
    game.act('hit'); // 5,6,3 = 14, not bust
    expect(game.legalActions()).not.toContain('double');
  });
});

describe('surrender', () => {
  it('legal as first action, gone after a hit', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '2', '3'));
    game.startRound();
    expect(game.legalActions()).toContain('surrender');
    game.act('hit'); // 10,6,3 = 19
    expect(game.legalActions()).not.toContain('surrender');
  });

  it('not legal on a split hand', () => {
    const game = Game.withRiggedShoe(cfg(), rig('8', '9', '8', '2', '3', '4'));
    game.startRound();
    game.act('split');
    expect(game.legalActions()).not.toContain('surrender');
  });

  it('nets -0.5', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '2'));
    game.startRound();
    game.act('surrender');
    expect(game.hands[0].result).toBe('surrender');
    expect(game.hands[0].net).toBe(-0.5);
    expect(game.phase).toBe('settled');
    expect(game.bankroll).toBe(cfg().bankrollStart - 0.5);
  });
});

describe('dealer H17', () => {
  it('D(A,6) must draw (soft 17)', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '9', '6', '4'));
    game.startRound();
    expect(game.phase).toBe('insurance');
    game.insuranceDecision(false);
    expect(game.phase).toBe('player');
    game.act('stand');
    expect(game.dealerCards.length).toBe(3); // drew on soft 17
  });

  it('D(10,7) stands (hard 17, no draw)', () => {
    const game = Game.withRiggedShoe(cfg(), rig('9', '10', '9', '7'));
    game.startRound();
    expect(game.phase).toBe('player');
    game.act('stand');
    expect(game.dealerCards.length).toBe(2);
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['10', '7']);
  });

  it('D(A,7) stands (soft 18, no draw)', () => {
    const game = Game.withRiggedShoe(cfg(), rig('9', 'A', '9', '7'));
    game.startRound();
    expect(game.phase).toBe('insurance');
    game.insuranceDecision(false);
    expect(game.phase).toBe('player');
    game.act('stand');
    expect(game.dealerCards.length).toBe(2);
  });
});

describe('RC visibility', () => {
  it('runningCount equals the sum of hiLoTags of all visible cards after a full round', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    game.startRound();
    game.act('hit');
    game.act('stand');
    const allCards = [...game.hands[0].cards, ...game.dealerCards];
    const expectedRc = allCards.reduce((sum, c) => sum + hiLoTag(c.rank), 0);
    expect(game.runningCount).toBe(expectedRc);
  });
});

describe('bet grading', () => {
  it('betSpreadOn, pre-deal tc 0, startRound(4) -> bet event wrong (expected 1)', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('2', '5', '3', '4'));
    game.startRound(4);
    const ev = game.events[0];
    expect(ev.kind).toBe('bet');
    expect(ev.correct).toBe(false);
    expect(ev.expected).toBe('1');
    expect(ev.taken).toBe('4');
  });

  it('betSpreadOn, pre-deal tc 0, startRound(1) -> correct', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('2', '5', '3', '4'));
    game.startRound(1);
    const ev = game.events[0];
    expect(ev.correct).toBe(true);
    expect(ev.expected).toBe('1');
    expect(ev.taken).toBe('1');
  });
});

describe('count check', () => {
  it('countCheckEvery:2 triggers after the 2nd round settles; 2nd trigger also asks TC', () => {
    const game = new Game(cfg({ countCheckEvery: 2, seed: 42 }));

    function playRoundStandOnly(): void {
      game.startRound();
      if (game.phase === 'insurance') game.insuranceDecision(false);
      while (game.phase === 'player') game.act('stand');
    }

    playRoundStandOnly();
    expect(game.countCheckDue).toBe(false);

    playRoundStandOnly();
    expect(game.countCheckDue).toBe(true);
    expect(game.askTcToo).toBe(false);

    const rc1 = game.runningCount;
    const result1 = game.submitCountCheck(rc1);
    expect(result1.rcCorrect).toBe(true);
    expect(result1.actualRc).toBe(rc1);
    expect(game.countCheckDue).toBe(false);
    expect(game.events.some((e) => e.kind === 'countCheck')).toBe(true);

    playRoundStandOnly();
    playRoundStandOnly();
    expect(game.countCheckDue).toBe(true);
    expect(game.askTcToo).toBe(true);

    const rc2 = game.runningCount;
    const tc2 = game.trueCountNow;
    const result2 = game.submitCountCheck(rc2, tc2);
    expect(result2.rcCorrect).toBe(true);
    expect(result2.tcCorrect).toBe(true);
    expect(result2.actualTc).toBe(tc2);
  });
});

describe('reshuffle', () => {
  it('penetration 0.5: reaching cutCardReached triggers a reshuffle on the next startRound', () => {
    // 8-card rig at penetration 0.5 -> cut card at 4 cards dealt, i.e. exactly
    // after round 1's P(10,6) D(10,10). Round 2 deals only neutral tags
    // (7,9,8 visible) so runningCount is 0 after the reset iff it was reset.
    const game = Game.withRiggedShoe(
      cfg({ penetration: 0.5 }),
      rig('10', '10', '6', '10', '7', '9', '8', '7'),
    );

    game.startRound();
    game.act('stand'); // dealer 20 stands, round settles
    expect(game.runningCount).toBe(-2); // 10,10,6,10 = -1-1+1-1: nonzero pre-shuffle
    expect(game.shoe.cutCardReached).toBe(true);

    game.startRound();
    expect(game.shuffledLastRound).toBe(true);
    expect(game.runningCount).toBe(0);
  });

  it('shuffledLastRound is false when the cut card was not reached', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    game.startRound();
    expect(game.shuffledLastRound).toBe(false);
  });
});

describe('grading wiring', () => {
  it('rigged split hand (9,7) v 10 at tc 0: hit vs correct-stand -> missed-deviation 16v10', () => {
    // (9,9) v 10, split -> hand0 draws 7 -> hard 16 v 10, fromSplit (surrender
    // unavailable) so the 16v10 stand-at-tc>=0 deviation is reachable.
    const game = Game.withRiggedShoe(cfg(), rig('9', '10', '9', '7', '7', '2', '5'));
    game.startRound();
    expect(game.phase).toBe('player');

    game.act('split');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['9', '7']);
    expect(game.hands[0].fromSplit).toBe(true);
    expect(game.trueCountNow).toBe(0);

    game.act('hit');
    const ev = game.events[game.events.length - 1];
    expect(ev.classification).toBe('missed-deviation');
    expect(ev.deviationId).toBe('16v10');
  });
});
