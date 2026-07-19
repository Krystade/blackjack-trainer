import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { hiLoTag } from './count';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig, SeatConfig } from './game';
import { basicPlay } from './strategy';
import type { PlayContext } from './strategy';
import type { Action } from './deviations';

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

  it('bj65:false (default): natural BJ pays 1.5x', () => {
    const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false } }), rig('A', '9', 'K', '8'));
    game.startRound();
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.hands[0].net).toBe(1.5);
    expect(game.bankroll).toBe(cfg().bankrollStart + 1.5);
  });

  it('bj65:true: natural BJ pays 1.2x', () => {
    const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: true } }), rig('A', '9', 'K', '8'));
    game.startRound();
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.hands[0].net).toBe(1.2);
    expect(game.bankroll).toBe(cfg().bankrollStart + 1.2);
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

  describe('insurance settlement', () => {
    it('take insurance + dealer BJ + player no-BJ: net 0 (even-money wash), insuranceNet = +bet', () => {
      // P(10,6), D(A,K) -> player loses main hand but insurance pays 2:1
      const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', 'K'));
      game.startRound();
      const initialBankroll = game.bankroll;
      const bet = game.hands[0].bet;

      game.insuranceDecision(true);
      expect(game.phase).toBe('settled');
      expect(game.hands[0].result).toBe('lose');
      expect(game.hands[0].net).toBe(-bet);
      expect(game.insuranceNet).toBe(bet);
      expect(game.bankroll).toBe(initialBankroll); // -bet + bet = 0
    });

    it('take insurance + dealer BJ + player BJ: player push, insurance +bet, net +bet', () => {
      // P(A,K), D(A,Q) -> player blackjack pushes, insurance pays 2:1
      const game = Game.withRiggedShoe(cfg(), rig('A', 'A', 'K', 'Q'));
      game.startRound();
      const initialBankroll = game.bankroll;
      const bet = game.hands[0].bet;

      game.insuranceDecision(true);
      expect(game.phase).toBe('settled');
      expect(game.hands[0].result).toBe('push');
      expect(game.hands[0].net).toBe(0);
      expect(game.insuranceNet).toBe(bet);
      expect(game.bankroll).toBe(initialBankroll + bet);
    });

    it('take insurance + no dealer BJ: lose bet/2 immediately, insuranceNet = -bet/2, round continues', () => {
      // P(10,6), D(A,5) -> insurance taken, dealer no BJ, round continues
      const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', '5', '8'));
      game.startRound();
      const initialBankroll = game.bankroll;
      const bet = game.hands[0].bet;

      game.insuranceDecision(true);
      expect(game.phase).toBe('player');
      expect(game.insuranceNet).toBe(-bet / 2);
      expect(game.bankroll).toBe(initialBankroll - bet / 2); // immediate loss
    });

    it('decline insurance + dealer BJ: lose full bet, insuranceNet = null, no settlement change', () => {
      // P(10,6), D(A,K) -> insurance declined, hand loses normally
      const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', 'K'));
      game.startRound();
      const initialBankroll = game.bankroll;
      const bet = game.hands[0].bet;

      game.insuranceDecision(false);
      expect(game.phase).toBe('settled');
      expect(game.hands[0].result).toBe('lose');
      expect(game.hands[0].net).toBe(-bet);
      expect(game.insuranceNet).toBeNull();
      expect(game.bankroll).toBe(initialBankroll - bet);
    });

    it('decline insurance + no dealer BJ: round continues normally, insuranceNet = null', () => {
      // P(10,6), D(A,5) -> insurance declined, round continues
      const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', '5', '8'));
      game.startRound();
      const initialBankroll = game.bankroll;

      game.insuranceDecision(false);
      expect(game.phase).toBe('player');
      expect(game.insuranceNet).toBeNull();
      expect(game.bankroll).toBe(initialBankroll); // no change until round settles
    });
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
    expect(ev.classification).toBe('correct');
    expect(ev.taken).toBe('take');
    expect(ev.expected).toBe('take');
    expect(ev.deviationId).toBe('ins');
  });

  it('tc < 3 at offer -> take:true is wrong (decline is correct) -> phantom-deviation', () => {
    const game = Game.withRiggedShoe(cfg(), rig('2', 'A', '2', '2'));
    game.startRound();
    expect(game.phase).toBe('insurance');
    expect(game.trueCountNow).toBeLessThan(3);

    game.insuranceDecision(true);
    const ev = game.events[game.events.length - 1];
    expect(ev.correct).toBe(false);
    expect(ev.classification).toBe('phantom-deviation');
    expect(ev.taken).toBe('take');
    expect(ev.expected).toBe('decline');
    expect(ev.deviationId).toBe('ins');
  });

  it('tc >= 3 at offer -> take:false is wrong (take is correct) -> missed-deviation', () => {
    const filler: Rank[] = ['3', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2'];
    const round2: Rank[] = ['2', 'A', '3', '2'];
    const padding: Rank[] = ['2', '2', '2', '2', '2'];
    const game = Game.withRiggedShoe(cfg(), rig(...filler, ...round2, ...padding));

    game.startRound();
    game.act('stand'); // dealer plays out and settles the filler round

    game.startRound();
    expect(game.phase).toBe('insurance');
    expect(game.trueCountNow).toBeGreaterThanOrEqual(3);

    game.insuranceDecision(false);
    const ev = game.events[game.events.length - 1];
    expect(ev.correct).toBe(false);
    expect(ev.classification).toBe('missed-deviation');
    expect(ev.taken).toBe('decline');
    expect(ev.expected).toBe('take');
    expect(ev.deviationId).toBe('ins');
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

  describe('resplit aces (RSA)', () => {
    it('rsa:false: after splitting A,A, split action is not legal on A,A pair', () => {
      // Test that with rsa:false, legalActions does not include 'split' for a split-ace hand
      const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false } }), rig('A', '2', 'A', 'A', 'K', '3', '2', '3', '2', '3'));
      game.startRound();
      expect(game.legalActions()).toContain('split');

      // First split
      game.act('split');
      expect(game.hands.length).toBe(2);
      expect(game.hands[0].done).toBe(true);
      expect(game.hands[1].done).toBe(true);
      // Both hands done immediately when rsa:false
      expect(game.phase).toBe('settled');
    });

    it('rsa:true: A,A pair in a split hand can be resplit', () => {
      // Rig: P(A,A) v D(2,9) -> split draws A to hand0 and K to hand1
      // Deal order: A, 2, A, 9, A, K, 2, 3, ...
      const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: true, bj65: false } }), rig('A', '2', 'A', '9', 'A', 'K', '2', '3', '4', '5'));
      game.startRound();
      expect(game.legalActions()).toContain('split');

      game.act('split'); // Split initial A,A
      expect(game.hands.length).toBe(2);
      // hand0 got A (A,A), hand1 got K
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', 'A']);
      expect(game.hands[0].done).toBe(false); // NOT done; can resplit
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'K']);
      expect(game.hands[1].done).toBe(true);

      // hand0 is A,A and rsa:true, so split is legal
      expect(game.legalActions()).toContain('split');

      game.act('split'); // Resplit hand0: draws 2 to hand0, 3 to new hand1
      expect(game.hands.length).toBe(3);
      // After resplit: hand0 [A, 2], hand1 [A, 3] (new), hand2 [A, K] (original hand1)
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', '2']);
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', '3']);
      expect(game.hands[2].cards.map((c) => c.rank)).toEqual(['A', 'K']);
      // All done after resplit
      expect(game.hands[0].done).toBe(true);
      expect(game.hands[1].done).toBe(true);
      expect(game.hands[2].done).toBe(true);
    });

    it('rsa:true: non-ace pair still resplits normally', () => {
      // Verify rsa:true doesn't break regular pair resplits
      // Just verify that split is legal for a non-ace pair, even with rsa:true
      const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: true, bj65: false } }), rig('8', '5', '8', '9', '8', '3', '2', '3', '4', '5', '6', '7'));
      game.startRound();
      expect(game.legalActions()).toContain('split');

      game.act('split'); // Split 8,8
      expect(game.hands.length).toBe(2);
      // hand0 got 8 (8,8), hand1 got 3 (8,3)
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '8']);
      expect(game.hands[0].splitAces).toBe(false);
      expect(game.legalActions()).toContain('split'); // Can resplit the 8,8 pair

      game.act('split'); // Resplit hand0 (8,8)
      // After resplit: hand0 [8,2], hand1 [8,3] (new from resplit), hand2 [8,3] (original)
      expect(game.hands.length).toBe(3);
      expect(game.hands[0].splitAces).toBe(false); // Still not a split-aces hand
    });

    it('rsa:true: resplit-ace hand that draws an ace stays open but no hit/double legal', () => {
      // CRITICAL TEST: with rsa:true, split A,A -> hand0 draws A (forming A,A pair),
      // hand0 must remain open for potential resplit, but hit and double MUST NOT be legal
      // Rig: P(A,A) v D(2,9) -> split draws A to hand0 (A,A pair) and K to hand1 (A,K done)
      // Deal order: A, 2, A, 9, A, K, ...
      const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: true, bj65: false } }), rig('A', '2', 'A', '9', 'A', 'K', '2', '3', '4', '5'));
      game.startRound();
      expect(game.phase).toBe('player');

      game.act('split'); // Split initial A,A
      expect(game.hands.length).toBe(2);
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', 'A']);
      expect(game.hands[0].done).toBe(false); // Can resplit
      expect(game.hands[0].splitAces).toBe(true);
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'K']);
      expect(game.hands[1].done).toBe(true);

      // hand0 is active and open (A,A pair with rsa:true)
      // Legal actions must be exactly ['stand', 'split'] — NO hit, NO double
      const actions = game.legalActions();
      expect(actions).toContain('stand');
      expect(actions).toContain('split');
      expect(actions).not.toContain('hit');
      expect(actions).not.toContain('double');
      expect(actions).toEqual(['stand', 'split']);
    });

    it('rsa:true: 4-hand cap prevents further action and legalActions is empty', () => {
      // When hands.length reaches 4, no further splits are possible.
      // Even if resplit-aces could continue, the cap ensures they're marked done.
      const game = Game.withRiggedShoe(cfg({ rules: { decks: 6, s17: false, das: true, ls: true, rsa: true, bj65: false } }), rig('8', '2', '8', '9', '8', '8', '8', '8', '8', '8', '8', '2'));
      game.startRound();

      game.act('split'); // 1 -> 2 hands
      expect(game.hands.length).toBe(2);
      expect(game.legalActions()).toContain('split');

      game.act('split'); // 2 -> 3 hands
      expect(game.hands.length).toBe(3);
      expect(game.legalActions()).toContain('split');

      game.act('split'); // 3 -> 4 hands
      expect(game.hands.length).toBe(4);
      // Once we reach 4 hands, no further actions: split is no longer legal
      expect(game.legalActions()).not.toContain('split');
    });
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

describe('dealer s17 rule wiring (Cycle-1 Task 13)', () => {
  it('h17 (default rules): D(A,6) hits soft 17', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '9', '6', '4'));
    game.startRound();
    expect(game.phase).toBe('insurance');
    game.insuranceDecision(false);
    expect(game.phase).toBe('player');
    game.act('stand');
    expect(game.dealerCards.length).toBe(3); // drew on soft 17
  });

  it('s17:true: D(A,6) stands on soft 17 (no draw)', () => {
    const game = Game.withRiggedShoe(
      cfg({ rules: { decks: 6, s17: true, das: true, ls: true, rsa: false, bj65: false } }),
      rig('10', 'A', '9', '6'),
    );
    game.startRound();
    expect(game.phase).toBe('insurance');
    game.insuranceDecision(false);
    expect(game.phase).toBe('player');
    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.length).toBe(2); // does NOT draw on soft 17 under s17
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['A', '6']);
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

describe('rules.decks wired into the shoe (Cycle-1 closing fix)', () => {
  it('1D rules: shoe starts with 52 cards, not the 6-deck default', () => {
    const game = new Game(cfg({ rules: { decks: 1, s17: false, das: true, ls: true, rsa: false, bj65: false } }));
    expect(game.shoe.cardsRemaining).toBe(52);
  });

  it('2D rules: shoe starts with 104 cards', () => {
    const game = new Game(cfg({ rules: { decks: 2, s17: false, das: true, ls: true, rsa: false, bj65: false } }));
    expect(game.shoe.cardsRemaining).toBe(104);
  });

  it('no rules override: shoe falls back to DEFAULT_RULES (6 decks = 312 cards)', () => {
    const game = new Game(cfg());
    expect(game.shoe.cardsRemaining).toBe(312);
  });

  it('1D game: trueCountNow uses a 1-deck divisor, not the 6-deck default', () => {
    const game = new Game(cfg({ rules: { decks: 1, s17: false, das: true, ls: true, rsa: false, bj65: false } }));
    game.runningCount = 2; // ~1 deck left (fresh 1D shoe) -> floor(2/1) = 2; a 6-deck divisor would floor(2/6) = 0
    expect(game.trueCountNow).toBe(2);
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

describe('multi-seat dealing (Cycle-2 Task 2)', () => {
  it('default cfg (no seats) -> single player seat with one hand; solo round settles byte-identically to v1', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    expect(game.seats).toHaveLength(1);
    expect(game.seats[0].kind).toBe('player');

    game.startRound();
    expect(game.phase).toBe('player');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6']);
    expect(game.dealerCards[0].rank).toBe('9');
    expect(game.seats[0].hands).toBe(game.hands); // getter is a live view over the seat

    game.act('hit');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6', '5']); // 21

    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['9', '8']); // hard 17, no extra draw
    expect(game.hands[0].result).toBe('win');
    expect(game.hands[0].net).toBe(1);
    expect(game.bankroll).toBe(cfg().bankrollStart + 1);
  });

  it('2 bots + player at position 1, playerHands 1 -> exact card-to-seat mapping across both passes; RC = sum of visible tags (hole excluded)', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 2, botMistakePct: 0, playerPosition: 1 };
    // Seat order (bots first, player spliced in at index 1): [bot0, player, bot1].
    // Pass 1: bot0 c1, player c1, bot1 c1, dealer up.
    // Pass 2: bot0 c2, player c2, bot1 c2, dealer hole.
    // bot0 is dealt hard 19 (10,9) -- Cycle-2 Task 3 autoplays it immediately
    // to completion, and basic strategy always stands on hard 19 regardless
    // of dealer up, so it needs no extra cards (the test never advances the
    // player's turn, so bot1 -- seated after the player -- never autoplays
    // here and its dealt cards are untouched).
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', '3', '4', '9', '9', '6', '7', '8'));
    game.startRound();

    expect(game.seats).toHaveLength(3);
    expect(game.seats.map((s) => s.kind)).toEqual(['bot', 'player', 'bot']);

    expect(game.seats[0].hands[0].cards.map((c) => c.rank)).toEqual(['10', '9']); // bot before player, autoplayed to hard 19 -> stand
    expect(game.seats[1].hands[0].cards.map((c) => c.rank)).toEqual(['3', '6']); // player seat
    expect(game.seats[2].hands[0].cards.map((c) => c.rank)).toEqual(['4', '7']); // bot after player
    expect(game.dealerCards[0].rank).toBe('9'); // upcard, dealt right after pass 1
    expect(game.dealerCards[1].rank).toBe('8'); // hole, dealt right after pass 2, not counted

    // v1-compatible view: game.hands/active are the player seat's hands.
    expect(game.hands).toBe(game.seats[1].hands);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['3', '6']);

    const visibleCards = [
      ...game.seats[0].hands[0].cards,
      ...game.seats[1].hands[0].cards,
      ...game.seats[2].hands[0].cards,
      game.dealerCards[0],
    ];
    const expectedRc = visibleCards.reduce((sum, c) => sum + hiLoTag(c.rank), 0);
    expect(game.runningCount).toBe(expectedRc);
  });

  it('playerHands 2, solo (bots:0) -> both player hands dealt in hand order across both passes', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Pass 1: hand0 c1, hand1 c1, dealer up. Pass 2: hand0 c2, hand1 c2, dealer hole.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '3', '9', '4', '5', '6'));
    game.startRound();

    expect(game.seats).toHaveLength(1);
    expect(game.hands).toHaveLength(2);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['2', '4']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['3', '5']);
    expect(game.dealerCards[0].rank).toBe('9');
    expect(game.dealerCards[1].rank).toBe('6');
    expect(game.active).toBe(0);
  });

  it('bots autoplay to completion and settle for display, without touching bankroll (Cycle-2 Task 3)', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 2, botMistakePct: 0, playerPosition: 0 };
    // Seat order: [player, bot0, bot1]. Player 16 v dealer hard 17 -> lose.
    // Bot hands are dealt as hard 19/18 -- always-stand under basic
    // strategy regardless of dealer up, so no extra cards are needed.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', 'K', 'Q', '9', '6', '9', '8', '8'));
    game.startRound();
    expect(game.phase).toBe('player');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6']);
    expect(game.seats[1].hands[0].cards.map((c) => c.rank)).toEqual(['K', '9']); // bot0: hard 19
    expect(game.seats[2].hands[0].cards.map((c) => c.rank)).toEqual(['Q', '8']); // bot1: hard 18

    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['9', '8']); // hard 17, no extra draw
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);
    expect(game.bankroll).toBe(cfg().bankrollStart - 1); // only the player's net affects bankroll

    // Bots autoplayed to completion (basic strategy stands on both hard 19
    // and hard 18) and settle vs the dealer's 17 for display -- but their
    // wins never touch the bankroll.
    expect(game.seats[1].hands[0].result).toBe('win');
    expect(game.seats[1].hands[0].net).toBe(1);
    expect(game.seats[2].hands[0].result).toBe('win');
    expect(game.seats[2].hands[0].net).toBe(1);
    expect(game.botActionLog).toEqual([
      { seat: 1, handIndex: 0, action: 'stand', card: undefined },
      { seat: 2, handIndex: 0, action: 'stand', card: undefined },
    ]);
  });
});

describe('multi-hand player (Cycle-2 Task 4)', () => {
  it('2 hands, betSpreadOn off, distinct rigged outcomes -> independent nets, bankroll delta = sum', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Pass1: hand0c1(8) hand1c1(8) dealerUp(5); Pass2: hand0c2(9) hand1c2(6) dealerHole(6).
    // hand0 = 8,9=17->hit to... wait, keep it simple: hand0 stands at 19 (win),
    // hand1 hits into a bust (lose). Dealer 5,6=11 must hit; give it a 6 -> 17 stand.
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('10', '10', '5', '9', '6', '6', 'K', '6'),
    );
    game.startRound([1, 5]);
    expect(game.hands).toHaveLength(2);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '9']); // 19
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['10', '6']); // 16
    expect(game.hands[0].bet).toBe(1);
    expect(game.hands[1].bet).toBe(5);

    const initialBankroll = game.bankroll;
    game.act('stand'); // hand0 stands at 19
    expect(game.active).toBe(1);
    game.act('hit'); // hand1 draws K -> bust (26)
    expect(game.phase).toBe('settled');

    expect(game.hands[0].result).toBe('win');
    expect(game.hands[0].net).toBe(1);
    expect(game.hands[1].result).toBe('lose');
    expect(game.hands[1].net).toBe(-5);
    expect(game.bankroll).toBe(initialBankroll + 1 - 5);
  });

  it('betSpreadOn, tc forced 0, startRound([1,1]) -> two bet GradedEvents, both graded', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = Game.withRiggedShoe(
      cfg({ betSpreadOn: true, seats }),
      rig('2', '3', '4', '5', '6', '7'),
    );
    expect(game.trueCountNow).toBe(0);
    game.startRound([1, 1]);

    const betEvents = game.events.filter((e) => e.kind === 'bet');
    expect(betEvents).toHaveLength(2);
    expect(betEvents[0].correct).toBe(true);
    expect(betEvents[0].expected).toBe('1');
    expect(betEvents[0].taken).toBe('1');
    expect(betEvents[1].correct).toBe(true);
    expect(betEvents[1].expected).toBe('1');
    expect(betEvents[1].taken).toBe('1');
  });

  it('scalar startRound(2) with playerHands 2 -> both hands bet 2 (back-compat)', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '3', '4', '5', '6', '7'));
    game.startRound(2);
    expect(game.hands[0].bet).toBe(2);
    expect(game.hands[1].bet).toBe(2);
  });

  it('split inside hand 0 does not consume hand 1s split budget (per-origin 4-hand cap)', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Deal: hand0=[8,8], hand1=[8,8], dealer 5/6 (irrelevant, never reached).
    // Chain-split hand0's lineage up to 3 hands (still < 4, its own cap), while
    // hand1 (a completely separate original hand / origin) has split 0 times.
    // Total array length reaches 4 at that point -- a GLOBAL hands.length<4 cap
    // would (wrongly) block hand1 from ever splitting; a PER-ORIGIN cap must not.
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('8', '8', '5', '8', '8', '6', '8', '2', '8', '3', '8', '3'),
    );
    game.startRound();
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '8']);

    game.act('split'); // hand0 -> hand0a[8,8] hand0b[8,2]; hands=[hand0a,hand0b,hand1]
    expect(game.hands).toHaveLength(3);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.active).toBe(0); // still on hand0a (re-formed pair)

    game.act('split'); // hand0a -> hand0a2[8,8] hand0a-split[8,3]; hands=[hand0a2,hand0a-split,hand0b,hand1]
    expect(game.hands).toHaveLength(4);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '8']);

    // Total hands.length is now 4 -- exactly the GLOBAL cap. hand0's own
    // lineage (origin) has only 3 hands, so ONE more split must still be
    // legal for it under a correct per-origin cap.
    expect(game.legalActions()).toContain('split');

    game.act('stand'); // hand0a2 done -> advance to hand0a-split
    expect(game.active).toBe(1);
    game.act('stand'); // hand0a-split done -> advance to hand0b
    expect(game.active).toBe(2);
    game.act('stand'); // hand0b done -> advance to hand1
    expect(game.active).toBe(3);

    // hand1 has never split -- its own origin group has exactly 1 hand, so
    // split must be legal for it regardless of hand0's lineage already
    // sitting at the global total of 4.
    expect(game.legalActions()).toContain('split');
    game.act('split');
    expect(game.hands).toHaveLength(5);
    expect(game.hands[3].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.hands[4].cards.map((c) => c.rank)).toEqual(['8', '3']);
  });
});

describe('bot autoplay + mistakes + determinism (Cycle-2 Task 3)', () => {
  type BotDecision = {
    seat: number;
    handIndex: number;
    cardsBefore: Card[];
    dealerUp: Rank;
    ctx: PlayContext;
    legal: Action[];
    correctAction: Action;
    action: Action;
  };

  function playRoundStandOnly(game: Game): void {
    game.startRound();
    if (game.phase === 'insurance') game.insuranceDecision(false);
    while (game.phase === 'player') game.act('stand');
  }

  it('botMistakePct 0: every bot decision equals basicPlay(cards, up, ctx, rules), 300-round seeded soak', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 3, botMistakePct: 0, playerPosition: 1 };
    const game = new Game(cfg({ seed: 12345, seats }));
    const decisions: BotDecision[] = [];
    game.onBotDecision = (info) => decisions.push(info);

    for (let i = 0; i < 300; i++) {
      playRoundStandOnly(game);
    }

    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(d.action).toBe(d.correctAction);
      expect(d.action).toBe(basicPlay(d.cardsBefore, d.dealerUp, d.ctx, game.rules).action);
    }
  });

  it('botMistakePct 100: bot action differs from basicPlay whenever an alternative legal action exists, over a soak', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 3, botMistakePct: 100, playerPosition: 1 };
    const game = new Game(cfg({ seed: 999, seats }));
    const decisions: BotDecision[] = [];
    game.onBotDecision = (info) => decisions.push(info);

    for (let i = 0; i < 300; i++) {
      playRoundStandOnly(game);
    }

    expect(decisions.length).toBeGreaterThan(0);
    let sawAlternative = false;
    for (const d of decisions) {
      const correct = basicPlay(d.cardsBefore, d.dealerUp, d.ctx, game.rules).action;
      expect(d.correctAction).toBe(correct);
      const alternatives = d.legal.filter((a) => a !== correct);
      if (alternatives.length > 0) {
        sawAlternative = true;
        expect(d.action).not.toBe(correct); // mistake substituted (mistakePct 100)
        expect(alternatives).toContain(d.action); // never an illegal action
      } else {
        expect(d.action).toBe(correct); // rare no-alternative case: plays correctly anyway
      }
    }
    expect(sawAlternative).toBe(true); // sanity: the soak actually exercised the substitution path
  });

  it('same seed + same SeatConfig => identical botActionLog and identical final shoe position', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 2, botMistakePct: 10, playerPosition: 1 };

    function runSoak(): { log: Game['botActionLog']; cardsDealt: number; cardsRemaining: number } {
      const game = new Game(cfg({ seed: 54321, seats }));
      const log: Game['botActionLog'] = [];
      for (let i = 0; i < 50; i++) {
        playRoundStandOnly(game);
        log.push(...game.botActionLog);
      }
      return { log, cardsDealt: game.shoe.cardsDealt, cardsRemaining: game.shoe.cardsRemaining };
    }

    const run1 = runSoak();
    const run2 = runSoak();

    expect(run1.log.length).toBeGreaterThan(0);
    expect(run1.log).toEqual(run2.log);
    expect(run1.cardsDealt).toBe(run2.cardsDealt);
    expect(run1.cardsRemaining).toBe(run2.cardsRemaining);
  });

  it('RC includes cards bot hands draw on hit, not just the initial deal', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    // Seat order: [bot0, player]. Bot0 dealt hard 6 (2,4) -- always hits per
    // basic strategy regardless of dealer up -- draws a 10 to reach hard 16
    // v 6 (stand: dealer 2-6 is bust-prone). Player dealt (9,9), untouched.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '9', '6', '4', '9', '7', '10'));
    game.startRound();

    expect(game.phase).toBe('player');
    expect(game.seats[0].hands[0].cards.map((c) => c.rank)).toEqual(['2', '4', '10']);
    expect(game.botActionLog).toEqual([
      { seat: 0, handIndex: 0, action: 'hit', card: { rank: '10', suit: 's' } },
      { seat: 0, handIndex: 0, action: 'stand', card: undefined },
    ]);

    const visibleCards = [...game.seats.flatMap((s) => s.hands.flatMap((h) => h.cards)), game.dealerCards[0]];
    const expectedRc = visibleCards.reduce((sum, c) => sum + hiLoTag(c.rank), 0);
    expect(game.runningCount).toBe(expectedRc);
  });

  it('bots never take insurance and never produce GradedEvents, even while autoplaying around a dealer ace', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 2, botMistakePct: 0, playerPosition: 1 };
    // Seat order: [bot0, player, bot1]. Dealer shows an ace (insurance is
    // offered to the player only); dealer's hole is a 9 (soft 20, not
    // blackjack), so bots-before (bot0) autoplay before the player's turn
    // and bots-after (bot1) autoplay once the player is done.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('K', '10', 'K', 'A', '9', '9', '8', '9'));
    game.startRound();
    expect(game.phase).toBe('insurance');

    game.insuranceDecision(false);
    expect(game.phase).toBe('player');
    game.act('stand');
    expect(game.phase).toBe('settled');

    // Both bots actually played (hard 19 and hard 18 -- straight to stand)...
    expect(game.botActionLog).toEqual([
      { seat: 0, handIndex: 0, action: 'stand', card: undefined },
      { seat: 2, handIndex: 0, action: 'stand', card: undefined },
    ]);
    // ...yet the only GradedEvents are the player's: one insurance decision,
    // one action. Bots never insure (no insurance decision is ever made or
    // logged for them) and never grade.
    expect(game.events).toHaveLength(2);
    expect(game.events[0].kind).toBe('insurance');
    expect(game.events[1].kind).toBe('action');
  });
});
