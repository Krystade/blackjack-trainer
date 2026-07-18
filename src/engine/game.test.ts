import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { hiLoTag } from './count';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig, SeatConfig } from './game';

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
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '3', '4', '9', '5', '6', '7', '8'));
    game.startRound();

    expect(game.seats).toHaveLength(3);
    expect(game.seats.map((s) => s.kind)).toEqual(['bot', 'player', 'bot']);

    expect(game.seats[0].hands[0].cards.map((c) => c.rank)).toEqual(['2', '5']); // bot before player
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

  it('bots sit without acting (T2 interim) -> dealer settles only the player hand; bot results stay undefined', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 2, botMistakePct: 0, playerPosition: 0 };
    // Seat order: [player, bot0, bot1]. Player 16 v dealer hard 17 -> lose.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', '2', '3', '9', '6', '4', '5', '8'));
    game.startRound();
    expect(game.phase).toBe('player');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6']);
    expect(game.seats[1].hands[0].cards.map((c) => c.rank)).toEqual(['2', '4']);
    expect(game.seats[2].hands[0].cards.map((c) => c.rank)).toEqual(['3', '5']);

    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['9', '8']); // hard 17, no extra draw
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);
    expect(game.bankroll).toBe(cfg().bankrollStart - 1);

    for (const seat of game.seats) {
      if (seat.kind === 'bot') {
        expect(seat.hands[0].result).toBeUndefined();
      }
    }
  });
});
