import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { hiLoTag, tcBand, trueCount } from './count';
import { Game, DEFAULT_SPREAD, botRngSeed, handPlayNumber } from './game';
import type { GameConfig, SeatConfig } from './game';
import { basicPlay } from './strategy';
import { DEFAULT_RULES } from './ruleset';
import type { PlayContext } from './strategy';
import type { Action } from './deviations';
import type { RuleSet } from './ruleset';

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

describe('bot naturals settle correctly vs a non-natural dealer total (code review M4)', () => {
  it('bot dealt A,K beats a non-natural dealer 21 and pays 1.5x, display-only (bankroll untouched)', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    // Seat order: [bot0, player]. bot0 = A,K (natural). player = 10,10 (stands
    // at hard 20). Dealer up=2, hole=4 (6), draws 9 then 6 to land on a
    // NON-natural 21 (4 cards) -- the exact shape the M4 bug mishandled.
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('A', '10', '2', 'K', '10', '4', '9', '6'),
    );
    const initialBankroll = game.bankroll;
    game.startRound();
    expect(game.seats[0].hands[0].cards.map((c) => c.rank)).toEqual(['A', 'K']);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '10']);
    expect(game.phase).toBe('player');

    game.act('stand'); // player 20 vs dealer, dealer plays out to 21
    expect(game.phase).toBe('settled');
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['2', '4', '9', '6']); // non-natural 21

    // The bug: bot natural fell through to a plain total comparison (21 vs
    // 21) and settled as 'push'. Correct: a 2-card natural beats ANY
    // non-natural dealer total, paying 1.5x.
    expect(game.seats[0].hands[0].result).toBe('blackjack');
    expect(game.seats[0].hands[0].net).toBe(1.5);

    // Player 20 loses to dealer 21.
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);

    // Bot's net is display-only: bankroll reflects ONLY the player's -1 loss,
    // never the bot's +1.5.
    expect(game.bankroll).toBe(initialBankroll - 1);
  });

  it('bj65:true: bot natural pays 1.2x instead of 1.5x', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    const rules: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: true };
    const game = Game.withRiggedShoe(
      cfg({ seats, rules }),
      rig('A', '10', '2', 'K', '10', '4', '9', '6'),
    );
    game.startRound();
    game.act('stand');
    expect(game.phase).toBe('settled');
    expect(game.seats[0].hands[0].result).toBe('blackjack');
    expect(game.seats[0].hands[0].net).toBe(1.2);
  });

  it('MONEY SAFETY: player natural (settled pre-dealer) is never re-settled by settleHandVsDealer -- pays 1.5x exactly ONCE even with a live bot forcing the dealer to play', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 0 };
    // Seat order: [player, bot0]. player = A,K (natural, settles immediately
    // in resolveAfterPeek). bot0 = 10,9 (hard 19, always stands) -- a live
    // hand that forces the dealer to actually play, routing the round
    // through playDealerAndSettle (the shared method this fix touches).
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('A', '10', '9', 'K', '9', '5', '3'),
    );
    const initialBankroll = game.bankroll;

    game.startRound();
    // Player natural settles immediately, before the dealer or bot ever act.
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.hands[0].net).toBe(1.5);
    expect(game.bankroll).toBe(initialBankroll + 1.5);
    expect(game.phase).toBe('settled'); // bot-after + dealer play happen synchronously inside startRound

    // The bot (live hand) forced the dealer to draw: 9,5=14 -> hits 3 -> 17.
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['9', '5', '3']);
    expect(game.seats[1].hands[0].result).toBe('win'); // bot 19 beats dealer 17
    expect(game.seats[1].hands[0].net).toBe(1); // display-only

    // Player's hand must be untouched by the later playDealerAndSettle pass:
    // net is still exactly 1.5 (not overwritten, not doubled), and the
    // bankroll reflects that ONE credit only -- the bot's win never touches it.
    expect(game.hands[0].net).toBe(1.5);
    expect(game.bankroll).toBe(initialBankroll + 1.5);
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
    // A SINGLE-DECK table, stated in the rules rather than implied by the
    // length of the script. `decksRemaining` reports the ruleset's shoe
    // (riggedShoe.ts), so eleven +1 tags over a 6-deck game is a true count
    // of 2 -- and this test is about a true count of 3, which is what a
    // single-deck table with that running count actually gives you.
    const game = Game.withRiggedShoe(
      cfg({ rules: { ...DEFAULT_RULES, decks: 1 } }),
      rig(...filler, ...round2, ...padding),
    );

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
    // A SINGLE-DECK table, stated in the rules rather than implied by the
    // length of the script. `decksRemaining` reports the ruleset's shoe
    // (riggedShoe.ts), so eleven +1 tags over a 6-deck game is a true count
    // of 2 -- and this test is about a true count of 3, which is what a
    // single-deck table with that running count actually gives you.
    const game = Game.withRiggedShoe(
      cfg({ rules: { ...DEFAULT_RULES, decks: 1 } }),
      rig(...filler, ...round2, ...padding),
    );

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
    // #1: the right-hand half (index 1) is played first, so it is dealt
    // first too, and play starts there.
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '2']);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '3']);
    expect(game.hands[0].fromSplit).toBe(true);
    expect(game.hands[1].fromSplit).toBe(true);
    expect(game.active).toBe(1);
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
    // The right-hand ace (index 1) is dealt first (#1).
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'K']);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', '2']);
    expect(game.hands[0].done).toBe(true);
    expect(game.hands[1].done).toBe(true);
    expect(game.hands[1].splitAces).toBe(true);
    expect(game.legalActions()).toEqual([]); // no hit legal for a split-ace hand

    // Round auto-completes (both hands done): dealer (6,2) hits H17 to 18.
    expect(game.phase).toBe('settled');
    expect(game.hands[1].result).toBe('win'); // 21 beats 18
    expect(game.hands[1].net).toBe(1); // 1x, NOT blackjack 1.5x
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
      // The right hand (index 1) is dealt first and got A (A,A); hand0 got K.
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'A']);
      expect(game.hands[1].done).toBe(false); // NOT done; can resplit
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', 'K']);
      expect(game.hands[0].done).toBe(true);
      expect(game.active).toBe(1);

      // hand1 is A,A and rsa:true, so split is legal
      expect(game.legalActions()).toContain('split');

      game.act('split'); // Resplit hand1: new hand2 draws 2, hand1 draws 3
      expect(game.hands.length).toBe(3);
      // The resplit lands next to the hand split, not at the end.
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', 'K']);
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', '3']);
      expect(game.hands[2].cards.map((c) => c.rank)).toEqual(['A', '2']);
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
      // hand1 (right, dealt first) got 8 (8,8), hand0 got 3 (8,3)
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '8']);
      expect(game.hands[1].splitAces).toBe(false);
      expect(game.active).toBe(1);
      expect(game.legalActions()).toContain('split'); // Can resplit the 8,8 pair

      game.act('split'); // Resplit hand1 (8,8)
      // After resplit: hand0 [8,3], hand1 [8,3], hand2 [8,2] (new, played next)
      expect(game.hands.length).toBe(3);
      expect(game.active).toBe(2);
      expect(game.hands[2].splitAces).toBe(false); // Still not a split-aces hand
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
      expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'A']);
      expect(game.hands[1].done).toBe(false); // Can resplit
      expect(game.hands[1].splitAces).toBe(true);
      expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['A', 'K']);
      expect(game.hands[0].done).toBe(true);
      expect(game.active).toBe(1);

      // hand1 is active and open (A,A pair with rsa:true)
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

  describe('rules.ls gates surrender legality (code review M7)', () => {
    const noLsRules: RuleSet = { decks: 6, s17: false, das: true, ls: false, rsa: false, bj65: false };

    it('ls:false -> surrender is not in legalActions even as the first action', () => {
      const game = Game.withRiggedShoe(cfg({ rules: noLsRules }), rig('10', '9', '6', '2'));
      game.startRound();
      expect(game.legalActions()).not.toContain('surrender');
    });

    it('ls:false -> act(surrender) is rejected exactly like any other illegal action', () => {
      const game = Game.withRiggedShoe(cfg({ rules: noLsRules }), rig('10', '9', '6', '2'));
      game.startRound();
      expect(() => game.act('surrender')).toThrow(/Illegal action: surrender/);
    });

    it('ls:true (default) -> surrender remains legal as the first action, unaffected', () => {
      const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '2'));
      game.startRound();
      expect(game.legalActions()).toContain('surrender');
    });

    it('ls:false -> a bot 2-card hand never has surrender among its legal actions (closes the mistake-substitution hole too)', () => {
      // basicPlay itself is already ls-aware -- getChart() bakes rules.ls in
      // via stripLs, converting every Rh/Rs/Rp cell to its fallback when
      // ls:false -- so a bot's CORRECT action was never literally
      // 'surrender' here; that was never the bug. The bug is that
      // legalActionsForHand (via handOptions.canSurrender) still listed
      // 'surrender' as a legal ALTERNATIVE, which botMistakePct's random
      // substitution could pick. Assert directly on `legal`, not on the
      // action taken, so this fails pre-fix and passes post-fix regardless
      // of mistake substitution.
      const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
      // bot0 = 10,7 v dealer 9 -- hard 17, stands immediately (no extra
      // draws needed), so the rig only needs the initial 6 cards.
      const game = Game.withRiggedShoe(
        cfg({ seats, rules: noLsRules }),
        rig('10', '5', '9', '7', '5', '2'),
      );
      const seenLegal: Action[][] = [];
      game.onBotDecision = (info) => seenLegal.push(info.legal);

      game.startRound();

      expect(game.seats[0].hands[0].cards.map((c) => c.rank)).toEqual(['10', '7']);
      expect(seenLegal.length).toBeGreaterThan(0);
      for (const legal of seenLegal) {
        expect(legal).not.toContain('surrender');
      }
    });
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
  // C-R6: bet size is graded only on a round the ramp says to play, so these
  // run at TC +1 (ramp: 2 units) rather than TC 0 (ramp: sit out).
  function atTc1(overrides: Partial<GameConfig> = {}): Game {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true, ...overrides }), rig('2', '5', '3', '4'));
    game.runningCount = 6;
    expect(game.trueCountNow).toBe(1);
    return game;
  }

  it('betSpreadOn, pre-deal tc 1, startRound(8) -> bet event wrong (expected 2)', () => {
    const game = atTc1();
    game.startRound(8);
    const ev = game.events[0];
    expect(ev.kind).toBe('bet');
    expect(ev.correct).toBe(false);
    expect(ev.expected).toBe('2');
    expect(ev.taken).toBe('8');
  });

  it('betSpreadOn, pre-deal tc 1, startRound(2) -> correct', () => {
    const game = atTc1();
    game.startRound(2);
    const ev = game.events[0];
    expect(ev.kind).toBe('bet');
    expect(ev.correct).toBe(true);
    expect(ev.expected).toBe('2');
    expect(ev.taken).toBe('2');
  });

  // RT#11: exact-conformity grading rewards the one behaviour surveillance
  // looks for. Cover mode accepts a bet one RUNG of the ramp either side.
  it('RT#11: cover off -- a bet one rung above the ramp is still wrong', () => {
    const game = atTc1();
    game.startRound(4); // expected 2, next rung up
    expect(game.events[0].kind).toBe('bet');
    expect(game.events[0].correct).toBe(false);
  });

  it('RT#11: cover on -- that same bet is correct, and the reason says why', () => {
    const game = atTc1({ coverBets: true });
    game.startRound(4);
    expect(game.events[0].kind).toBe('bet');
    expect(game.events[0].correct).toBe(true);
    expect(game.events[0].reason).toContain('cover');
  });

  it('RT#11: cover is one rung, not a blank cheque', () => {
    const game = atTc1({ coverBets: true });
    game.startRound(8); // expected 2; 8 is two rungs up
    expect(game.events[0].kind).toBe('bet');
    expect(game.events[0].correct).toBe(false);
  });

  it('RT#11: cover never turns an exact bet wrong', () => {
    const game = atTc1({ coverBets: true });
    game.startRound(2);
    expect(game.events[0].kind).toBe('bet');
    expect(game.events[0].correct).toBe(true);
  });
});

describe('wong-out / sit-out (R5)', () => {
  const seats2Bots: SeatConfig = { bots: 2, playerHands: 1, playerPosition: 1, botMistakePct: 0 };
  // Wave J toggle rework: Out at a solo table, the player watches three bots
  // (there must be someone to watch). Bots on 20, dealer 5/K draws a 5.
  const OUT_SOLO = ['10', '10', '10', '5', '10', '10', '10', 'K', '5'] as const;

  it('a round out at a solo table: three bots to watch, no player hand, bankroll untouched, phase settled', () => {
    const game = Game.withRiggedShoe(cfg(), rig(...OUT_SOLO));
    const startBankroll = game.bankroll;
    game.sitOut();

    expect(game.hands).toHaveLength(0); // player was dealt nothing
    expect(game.bankroll).toBe(startBankroll); // wong-out never stakes
    expect(game.phase).toBe('settled');
    expect(game.roundNo).toBe(1);
    expect(game.seats.filter((s) => s.kind === 'bot')).toHaveLength(3);
    expect(game.dealerCards.map((c) => c.rank)).toEqual(['5', 'K', '5']);
    // Every card is face up: six tens, the 5 and K, and the dealer's 5.
    expect(game.runningCount).toBe(-6 + hiLoTag('5') + hiLoTag('K') + hiLoTag('5'));
    expect(game.holeRevealed).toBe(true);
  });

  it('sit-out still burns the shoe + advances the count with bots at the table', () => {
    // 2 bots + dealer up are all face-up: their Hi-Lo tags move the count even
    // though the player staked nothing.
    const game = Game.withRiggedShoe(
      cfg({ seats: seats2Bots }),
      // seat order: bot, player(empty), bot, dealer. Pass1: bot1, bot2, up.
      // Pass2: bot1, bot2, hole. Then dealer plays out vs the live bots.
      rig('10', '10', '6', '2', '3', '9', '7', '4', '8'),
    );
    const startBankroll = game.bankroll;
    const startDealt = game.shoe.cardsDealt;
    game.sitOut();

    expect(game.hands).toHaveLength(0);
    expect(game.bankroll).toBe(startBankroll); // bots settle for display only
    expect(game.phase).toBe('settled');
    expect(game.shoe.cardsDealt).toBeGreaterThan(startDealt); // penetration burned
  });

  it('a later staked round continues the SAME shoe (no reshuffle) after a sit-out', () => {
    const game = Game.withRiggedShoe(cfg(), rig(...OUT_SOLO, '10', '9', '6', '8', '5'));
    game.sitOut();
    expect(game.hands).toHaveLength(0);
    const dealtAfterSit = game.shoe.cardsDealt;

    game.startRound(); // now actually play
    expect(game.hands).toHaveLength(1);
    expect(game.roundNo).toBe(2);
    // The shoe was NOT reshuffled between the sit-out and the played round --
    // the count carried into the bet is real, which is the whole point of a
    // wong-out: cards keep coming off the same shoe.
    expect(game.shuffledLastRound).toBe(false);
    expect(game.shoe.cardsDealt).toBeGreaterThan(dealtAfterSit);
  });

  it('dealer Ace on a sit-out never prompts insurance (no stake to insure)', () => {
    // Ace up, no dealer BJ (A/5 draws a 4 to soft 20).
    const game = Game.withRiggedShoe(cfg(), rig('10', '10', '10', 'A', '10', '10', '10', '5', '4'));
    game.sitOut();
    expect(game.phase).toBe('settled');
    expect(game.phase).not.toBe('insurance');
    expect(game.bankroll).toBe(cfg().bankrollStart);
  });

  it('dealer blackjack on a sit-out settles bots only; player bankroll untouched', () => {
    const game = Game.withRiggedShoe(
      cfg({ seats: seats2Bots }),
      // up=A (pos 5), hole=K (pos 8) -> dealer natural, peeked before anyone acts.
      rig('9', '9', 'A', '2', '3', 'K'),
    );
    const startBankroll = game.bankroll;
    game.sitOut();
    expect(game.phase).toBe('settled');
    expect(game.holeRevealed).toBe(true); // dealer natural reveals the hole
    expect(game.bankroll).toBe(startBankroll);
  });

  it('betSpreadOn: sitting out at the exit point (tc -2) grades the wong decision CORRECT', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig(...OUT_SOLO));
    game.runningCount = -12;
    expect(game.trueCountNow).toBe(-2);
    game.sitOut();
    const wong = game.events.filter((e) => e.kind === 'wong');
    expect(wong).toHaveLength(1);
    expect(wong[0].correct).toBe(true);
    expect(wong[0].taken).toBe('sit-out');
    expect(wong[0].expected).toBe('sit-out');
    // A sit-out never emits a bet event -- nothing was staked.
    expect(game.events.some((e) => e.kind === 'bet')).toBe(false);
  });

  it('betSpreadOn: sitting out at a high +tc grades WRONG (the count wanted a real bet)', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig(...OUT_SOLO));
    game.runningCount = 6; // decksRemaining≈0.5 => tc≈12, well into "bet up" territory
    game.sitOut();
    const wong = game.events.filter((e) => e.kind === 'wong');
    expect(wong).toHaveLength(1);
    expect(wong[0].correct).toBe(false);
    expect(wong[0].expected).toBe('play');
  });

  it('betSpreadOn OFF: a sit-out grades nothing (no spread to judge the wong against)', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: false }), rig(...OUT_SOLO));
    game.sitOut();
    expect(game.events.filter((e) => e.kind === 'wong')).toHaveLength(0);
  });

  // RV7: the other half of the same decision. Before this, playing a count the
  // spread said to leave was scored as a CORRECT bet and nothing else.
  it('RV7: dealing in at a should-wong count grades the wong decision WRONG', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('2', '5', '3', '4'));
    game.runningCount = -12; // tc -2: at the exit point
    game.startRound(1); // the table minimum
    const wong = game.events.filter((e) => e.kind === 'wong');
    expect(wong).toHaveLength(1);
    expect(wong[0].correct).toBe(false);
    expect(wong[0].taken).toBe('play');
    expect(wong[0].expected).toBe('sit-out');
  });

  it('RV7 + C-R6: a min bet at a should-wong count grades no bet size -- only "wrong to be in the hand"', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('2', '5', '3', '4'));
    game.runningCount = -12;
    game.startRound(1);
    expect(game.events.filter((e) => e.kind === 'bet')).toHaveLength(0);
    expect(game.events.filter((e) => e.kind === 'wong')[0]!.correct).toBe(false);
  });

  it('C-R6: dealing in at a count the spread wants a real bet at grades the bet size, not the wong', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('5', 'K', '3', '4'));
    game.runningCount = 6;
    game.startRound(2);
    expect(game.events.filter((e) => e.kind === 'wong')).toHaveLength(0);
    const bet = game.events.filter((e) => e.kind === 'bet');
    expect(bet).toHaveLength(1);
    expect(bet[0].correct).toBe(true);
  });

  it('RV7: betSpreadOn OFF grades no wong on a dealt round either', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: false }), rig('2', '5', '3', '4'));
    game.startRound(1);
    expect(game.events.filter((e) => e.kind === 'wong')).toHaveLength(0);
  });

  it('C-R6: multi-hand at a play count: one bet event per hand, no wong', () => {
    // Positional: events[0] is the first hand's bet, which existing callers read directly.
    const seats: SeatConfig = { bots: 0, playerHands: 2, playerPosition: 0, botMistakePct: 0 };
    const game = Game.withRiggedShoe(
      cfg({ betSpreadOn: true, seats }),
      rig('2', '5', '3', '4', '6', '7'),
    );
    game.runningCount = 6;
    game.startRound([2, 2]);
    expect(game.events.map((e) => e.kind)).toEqual(['bet', 'bet']);
  });

  it('C-R6: multi-hand at a sit-out count: one wong event for the round, no bet sizes', () => {
    const seats: SeatConfig = { bots: 0, playerHands: 2, playerPosition: 0, botMistakePct: 0 };
    const game = Game.withRiggedShoe(
      cfg({ betSpreadOn: true, seats }),
      rig('2', '5', '3', '4', '6', '7'),
    );
    game.runningCount = -12;
    game.startRound([1, 1]);
    expect(game.events.map((e) => e.kind)).toEqual(['wong']);
  });
});

describe('D-R1: the Wong exit point (sit only at tc <= exit, default -2)', () => {
  // rc = 6 * tc (see atTc1). The script deals a solo round in, or a round out
  // to the three bots a solo player Out watches.
  function at(tc: number, overrides: Partial<GameConfig> = {}): Game {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true, ...overrides }), rig('10', '10', '10', '5', '10', '10', '10', 'K', '5'));
    game.runningCount = 6 * tc;
    expect(game.trueCountNow).toBe(tc);
    return game;
  }
  const wongOf = (g: Game) => g.events.filter((e) => e.kind === 'wong');

  it.each([
    [0, false],
    [-1, false],
    [-2, true],
    [-3, true],
  ])('tc %i: sitting out is graded correct=%s', (tc, ok) => {
    const game = at(tc);
    game.sitOut();
    expect(wongOf(game)).toHaveLength(1);
    expect(wongOf(game)[0].correct).toBe(ok);
    expect(wongOf(game)[0].expected).toBe(ok ? 'sit-out' : 'play');
  });

  it.each([
    [0, true],
    [-1, true],
    [-2, false],
    [-3, false],
  ])('tc %i: playing the minimum is graded correct=%s', (tc, ok) => {
    const game = at(tc);
    game.startRound(1);
    if (ok) {
      // A play: only the bet size is graded, and the minimum is the ramp's bet here.
      expect(wongOf(game)).toHaveLength(0);
      const bet = game.events.filter((e) => e.kind === 'bet');
      expect(bet).toHaveLength(1);
      expect(bet[0].correct).toBe(true);
      expect(bet[0].expected).toBe('1');
    } else {
      expect(wongOf(game)).toHaveLength(1);
      expect(wongOf(game)[0].correct).toBe(false);
      expect(game.events.some((e) => e.kind === 'bet')).toBe(false);
    }
  });

  it('a custom exit point moves the line: exit 0 sits at tc 0, exit -4 plays at tc -3', () => {
    const sit0 = at(0, { wongExitTc: 0 });
    sit0.sitOut();
    expect(wongOf(sit0)[0].correct).toBe(true);
    const play3 = at(-3, { wongExitTc: -4 });
    play3.sitOut();
    expect(wongOf(play3)[0].correct).toBe(false);
  });
});

describe('C-R6: one graded bet decision per round', () => {
  const kindsOf = (g: Game) => g.events.filter((e) => e.kind === 'bet' || e.kind === 'wong').map((e) => e.kind);

  it('ramp says sit out, you played: only the play-or-sit decision is graded (no bet size)', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('2', '5', '3', '4'));
    game.runningCount = -12;
    game.startRound(1);
    expect(kindsOf(game)).toEqual(['wong']);
    expect(game.events[0].correct).toBe(false);
  });

  it('ramp says play, you sat out: only the sit decision is graded', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('10', '10', '10', '5', '10', '10', '10', 'K', '5'));
    game.runningCount = 6;
    game.sitOut();
    expect(kindsOf(game)).toEqual(['wong']);
    expect(game.events[0].correct).toBe(false);
  });

  it('both played: only the bet size is graded', () => {
    const game = Game.withRiggedShoe(cfg({ betSpreadOn: true }), rig('5', 'K', '3', '4'));
    game.runningCount = 6;
    game.startRound(1);
    expect(kindsOf(game)).toEqual(['bet']);
    expect(game.events[0].correct).toBe(false);
  });
});

describe('count check', () => {
  it('#36: an owed check is posed by asking to deal, not by the settle, and the answer closes it', () => {
    const game = new Game(cfg({ countCheckEvery: 1, seed: 42 }));
    // Nothing owed before any round: asking to deal deals.
    expect(game.poseCountCheck()).toBe(false);
    expect(game.countCheckOpen).toBe(false);

    game.startRound();
    if (game.phase === 'insurance') game.insuranceDecision(false);
    while (game.phase === 'player') game.act('stand');

    // Settled: owed but NOT asked -- the round's result is still the screen.
    expect(game.phase).toBe('settled');
    expect(game.countCheckDue).toBe(true);
    expect(game.countCheckOpen).toBe(false);

    const rcAtSettle = game.runningCount;
    const cardsAtSettle = game.shoe.cardsDealt;
    expect(game.poseCountCheck()).toBe(true);
    expect(game.poseCountCheck()).toBe(true); // idempotent while open
    expect(game.countCheckOpen).toBe(true);
    // Posing moves nothing: the hand on the felt is the one being counted.
    expect(game.phase).toBe('settled');
    expect(game.shoe.cardsDealt).toBe(cardsAtSettle);

    game.submitCountCheck(rcAtSettle);
    expect(game.countCheckDue).toBe(false);
    expect(game.countCheckOpen).toBe(false);
    expect(game.poseCountCheck()).toBe(false);
  });

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

  describe('#3 countCheckAsk', () => {
    /** Play four checks (countCheckEvery 1), answering each correctly, and
     * record what each one asked and which countCheck events it graded. */
    function fourChecks(ask: GameConfig['countCheckAsk']) {
      const game = new Game(cfg({ countCheckEvery: 1, seed: 42, ...(ask ? { countCheckAsk: ask } : {}) }));
      const asked: { rc: boolean; tc: boolean; reasons: string[]; rcCorrect?: boolean }[] = [];
      for (let i = 0; i < 4; i++) {
        game.startRound();
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
        expect(game.countCheckDue).toBe(true);
        const before = game.events.length;
        const rc = game.askRc ? game.runningCount : null;
        const res = game.submitCountCheck(rc, game.askTcToo ? game.trueCountNow : undefined);
        asked.push({
          rc: game.askRc,
          tc: game.askTcToo,
          reasons: game.events.slice(before).map((e) => e.reason),
          rcCorrect: res.rcCorrect,
        });
      }
      return asked;
    }

    it('absent = alternate: RC every check, TC as well on every second', () => {
      const a = fourChecks(undefined);
      expect(a.map((x) => [x.rc, x.tc])).toEqual([[true, false], [true, true], [true, false], [true, true]]);
      expect(a[1].reasons).toEqual(['Running count check', 'True count check']);
      expect(fourChecks('alternate')).toEqual(a);
    });

    it("'running' asks the running count only, every time", () => {
      const a = fourChecks('running');
      expect(a.every((x) => x.rc && !x.tc)).toBe(true);
      expect(a.flatMap((x) => x.reasons)).toEqual(new Array(4).fill('Running count check'));
    });

    it("'true' asks the true count only: no running-count event, rcCorrect undefined", () => {
      const a = fourChecks('true');
      expect(a.every((x) => !x.rc && x.tc)).toBe(true);
      expect(a.flatMap((x) => x.reasons)).toEqual(new Array(4).fill('True count check'));
      expect(a.every((x) => x.rcCorrect === undefined)).toBe(true);
    });

    it("'both' asks RC then TC on every check", () => {
      const a = fourChecks('both');
      expect(a.every((x) => x.rc && x.tc)).toBe(true);
      expect(a[0].reasons).toEqual(['Running count check', 'True count check']);
    });

    it('countCheckEvery 0 still means off, whatever it asks', () => {
      const game = new Game(cfg({ countCheckEvery: 0, countCheckAsk: 'both', seed: 42 }));
      for (let i = 0; i < 3; i++) {
        game.startRound();
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
        expect(game.countCheckDue).toBe(false);
        expect(game.poseCountCheck()).toBe(false);
      }
    });
  });

  /**
   * THE TRUE COUNT IS GRADED BY EYE, THE RUNNING COUNT IS NOT.
   *
   * The running count is a fact: the player either kept it or did not, and a
   * miss by one is a miss. The depth is a read off a discard tray, so the true
   * count that follows from it carries real slack, and marking a perfect count
   * wrong because the tray read as two decks instead of two and a half grades
   * eyesight rather than counting. The two halves of the same prompt therefore
   * hold deliberately different standards.
   */
  it('grades the true count by eye and the running count exactly', () => {
    const fresh = () => atTcPrompt(cfg({ countCheckEvery: 1, seed: 42 }));

    const probe = fresh();
    const band = tcBand(probe.runningCount, probe.shoe.decksRemaining);
    // A degenerate band would make every assertion below trivially true --
    // early in a six-deck shoe a half-deck misread moves nothing, which is
    // exactly why `atTcPrompt` deals on until it does. If this ever fails, the
    // fixture stopped producing slack and the rest of the test means nothing.
    expect(band.max).toBeGreaterThan(band.min);

    // Every count an honest tray read could give is accepted...
    for (let guess = band.min; guess <= band.max; guess++) {
      const g = fresh();
      expect(g.submitCountCheck(g.runningCount, guess).tcCorrect).toBe(true);
    }
    // ...and one step outside it is not, so this is a band and not a shrug.
    const outside = fresh();
    expect(outside.submitCountCheck(outside.runningCount, band.max + 1).tcCorrect).toBe(false);
    const below = fresh();
    expect(below.submitCountCheck(below.runningCount, band.min - 1).tcCorrect).toBe(false);

    // The running count keeps its exact standard on the very same prompt.
    const offByOne = fresh();
    const submitted = offByOne.submitCountCheck(offByOne.runningCount + 1, band.min);
    expect(submitted.rcCorrect).toBe(false);
    expect(submitted.tcCorrect).toBe(true);

    // And the correction still reports the EXACT figure. The band decides the
    // verdict; it must never become the thing the app claims the answer was.
    const exact = fresh();
    expect(exact.submitCountCheck(exact.runningCount, band.min).actualTc).toBe(
      trueCount(probe.runningCount, probe.shoe.decksRemaining),
    );
  });
});

/**
 * Deal until a true-count prompt is due AND the shoe is deep enough for a
 * half-deck misread to actually change the answer.
 *
 * Deterministic for a given config: the same seed plays the same rounds and
 * resolves the same intervening prompts, so every call returns a game in an
 * identical state. Early prompts are answered CORRECTLY on the way past, so
 * the events they leave behind cannot be mistaken for the one under test.
 */
function atTcPrompt(config: GameConfig): Game {
  const game = new Game(config);
  for (let round = 0; round < 60; round++) {
    game.startRound();
    if (game.phase === 'insurance') game.insuranceDecision(false);
    while (game.phase === 'player') game.act('stand');
    if (!game.countCheckDue) continue;
    const band = tcBand(game.runningCount, game.shoe.decksRemaining);
    if (game.askTcToo && band.max > band.min) return game;
    game.submitCountCheck(game.runningCount, game.trueCountNow);
  }
  throw new Error('no true-count prompt with a non-degenerate band in 60 rounds');
}

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

describe('exactDecksRemaining (#41)', () => {
  it('is the real shoe to the card, not the half-deck estimate', () => {
    const game = new Game(cfg({ countCheckEvery: 0 }));
    expect(game.exactDecksRemaining).toBe(6);
    game.startRound();
    if (game.phase === 'insurance') game.insuranceDecision(false);
    while ((game.phase as string) === 'player') game.act('stand');
    const dealt = game.shoe.cardsDealt;
    expect(dealt).toBeGreaterThanOrEqual(4);
    expect(game.exactDecksRemaining).toBeCloseTo((312 - dealt) / 52, 10);
    expect(game.exactDecksRemaining).toBeCloseTo(game.shoe.cardsRemaining / 52, 10);
  });

  it("reads a rigged shoe as the ruleset's shoe, not the script length", () => {
    // An 8-card script in a 6-deck game: 2 cards dealt leaves 310 of 312.
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '7', '8', '2', '3', '4', '5'));
    game.shoe.draw();
    game.shoe.draw();
    expect(game.exactDecksRemaining).toBeCloseTo(310 / 52, 10);
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
    // A rigged shoe RESTOCKS on a shuffle (riggedShoe.ts: resetting `dealt`
    // over an empty queue left a shoe that reported itself fresh and threw
    // on the next draw), so round 2 deals the script from the top again:
    // 10, 10, 6 visible = -1. The count was reset iff it reads -1 rather
    // than -3.
    expect(game.runningCount).toBe(-1);
  });

  it('shuffleDue says so between rounds, before the bet that the shuffle will grade at TC 0', () => {
    const game = Game.withRiggedShoe(
      cfg({ penetration: 0.5, betSpreadOn: true }),
      rig('10', '10', '6', '10', '7', '9', '8', '7'),
    );
    expect(game.shuffleDue).toBe(false);
    game.startRound(1);
    game.act('stand');
    // Settled past the cut card: the table can warn before the next bet.
    expect(game.shuffleDue).toBe(true);
    game.startRound(1);
    expect(game.shuffledLastRound).toBe(true);
    // The bet is graded at the fresh shoe's count -- the count the warning named.
    // (C-R6: at TC 0 the ramp sits out, so the round's one grade is the wong.)
    const bets = game.events.filter((e) => e.kind === 'bet' || e.kind === 'wong');
    expect(bets[bets.length - 1].tc).toBe(0);
  });

  it('shuffledLastRound is false when the cut card was not reached', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    game.startRound();
    expect(game.shuffledLastRound).toBe(false);
  });
});

describe('grading wiring', () => {
  it('rigged split hand (9,7) v 10 at tc 0: hit vs correct-stand -> missed-deviation 16v10', () => {
    // (9,9) v 10, split -> the right hand, played first, draws 7 -> hard 16 v 10, fromSplit (surrender
    // unavailable) so the 16v10 stand-at-tc>=0 deviation is reachable.
    const game = Game.withRiggedShoe(cfg(), rig('9', '10', '9', '7', '7', '2', '5'));
    game.startRound();
    expect(game.phase).toBe('player');

    game.act('split');
    expect(game.active).toBe(1);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['9', '7']);
    expect(game.hands[1].fromSplit).toBe(true);
    expect(game.trueCountNow).toBe(0);

    game.act('hit');
    const ev = game.events[game.events.length - 1];
    expect(ev.classification).toBe('missed-deviation');
    expect(ev.deviationId).toBe('16v10');
  });

  describe('#34 gradeDeviations', () => {
    /** The same split 16 v 10 at tc 0 as above, where the 16v10 index says
     * stand and basic strategy says hit. */
    function at16v10(gradeDeviations?: boolean): Game {
      const game = Game.withRiggedShoe(
        cfg(gradeDeviations === undefined ? {} : { gradeDeviations }),
        rig('9', '10', '9', '7', '7', '2', '5'),
      );
      game.startRound();
      game.act('split');
      expect(game.hands[game.active].cards.map((c) => c.rank)).toEqual(['9', '7']);
      expect(game.trueCountNow).toBe(0);
      return game;
    }

    it('true behaves exactly like absent: the index play is the right one', () => {
      const game = at16v10(true);
      game.act('hit');
      const ev = game.events[game.events.length - 1];
      expect(ev.classification).toBe('missed-deviation');
      expect(ev.expected).toBe('stand');
    });

    it('off: basic strategy is right at every count, with no index attached', () => {
      const hit = at16v10(false);
      hit.act('hit');
      const ok = hit.events[hit.events.length - 1];
      expect(ok.correct).toBe(true);
      expect(ok.expected).toBe('hit');
      expect(ok.deviationId).toBeUndefined();

      const stand = at16v10(false);
      stand.act('stand');
      const wrong = stand.events[stand.events.length - 1];
      expect(wrong.correct).toBe(false);
      expect(wrong.expected).toBe('hit');
    });

    /** Single deck, tc >= 3 at a dealer-ace offer: the insurance index says take. */
    function atHighCountInsurance(gradeDeviations: boolean): Game {
      const filler: Rank[] = ['3', '2', '2', '2', '2', '2', '2', '2', '2', '2', '2'];
      const round2: Rank[] = ['2', 'A', '3', '2'];
      const padding: Rank[] = ['2', '2', '2', '2', '2'];
      const game = Game.withRiggedShoe(
        cfg({ rules: { ...DEFAULT_RULES, decks: 1 }, gradeDeviations }),
        rig(...filler, ...round2, ...padding),
      );
      game.startRound();
      game.act('stand');
      game.startRound();
      expect(game.phase).toBe('insurance');
      expect(game.trueCountNow).toBeGreaterThanOrEqual(3);
      return game;
    }

    it('off: insurance is never right, even where the index would take it', () => {
      const declined = atHighCountInsurance(false);
      declined.insuranceDecision(false);
      const ok = declined.events[declined.events.length - 1];
      expect(ok.correct).toBe(true);
      expect(ok.expected).toBe('decline');
      expect(ok.deviationId).toBeUndefined();

      const taken = atHighCountInsurance(false);
      taken.insuranceDecision(true);
      const wrong = taken.events[taken.events.length - 1];
      expect(wrong.correct).toBe(false);
      expect(wrong.classification).toBe('basic-error');
      expect(wrong.expected).toBe('decline');
    });

    it('on: the same offer still grades the insurance index', () => {
      const game = atHighCountInsurance(true);
      game.insuranceDecision(false);
      expect(game.events[game.events.length - 1].classification).toBe('missed-deviation');
    });
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

  it('playerHands 2, solo (bots:0) -> both player hands dealt right to left across both passes', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Pass 1: hand1 c1, hand0 c1, dealer up. Pass 2: hand1 c2, hand0 c2, dealer hole.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '3', '9', '4', '5', '6'));
    game.startRound();

    expect(game.seats).toHaveLength(1);
    expect(game.hands).toHaveLength(2);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['2', '4']);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['3', '5']);
    expect(game.dealerCards[0].rank).toBe('9');
    expect(game.dealerCards[1].rank).toBe('6');
    // Casinos deal from the dealer's left -- the player's right -- so the
    // rightmost hand is dealt first, as it is played first (#1).
    expect(game.active).toBe(1);
    expect(game.dealOrder).toEqual([
      { kind: 'player', handIndex: 1, cardIndex: 0 },
      { kind: 'player', handIndex: 0, cardIndex: 0 },
      { kind: 'dealer', cardIndex: 0 },
      { kind: 'player', handIndex: 1, cardIndex: 1 },
      { kind: 'player', handIndex: 0, cardIndex: 1 },
      { kind: 'dealer', cardIndex: 1 },
    ]);
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
    // Dealt right to left: Pass1: hand1c1(10) hand0c1(10) dealerUp(5); Pass2:
    // hand1c2(6) hand0c2(9) dealerHole(6). hand0 stands at 19 (win), hand1
    // hits into a bust (lose). Dealer 5,6=11 must hit; give it a 6 -> 17 stand.
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('10', '10', '5', '6', '9', '6', 'K', '6'),
    );
    game.startRound([1, 5]);
    expect(game.hands).toHaveLength(2);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '9']); // 19
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['10', '6']); // 16
    expect(game.hands[0].bet).toBe(1);
    expect(game.hands[1].bet).toBe(5);

    const initialBankroll = game.bankroll;
    expect(game.active).toBe(1); // #1: the right hand plays first
    game.act('hit'); // hand1 draws K -> bust (26)
    expect(game.active).toBe(0);
    game.act('stand'); // hand0 stands at 19
    expect(game.phase).toBe('settled');

    expect(game.hands[0].result).toBe('win');
    expect(game.hands[0].net).toBe(1);
    expect(game.hands[1].result).toBe('lose');
    expect(game.hands[1].net).toBe(-5);
    expect(game.bankroll).toBe(initialBankroll + 1 - 5);
  });

  it('betSpreadOn, tc forced +1, startRound([2,2]) -> two bet GradedEvents, both graded', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = Game.withRiggedShoe(
      cfg({ betSpreadOn: true, seats }),
      rig('2', '3', '4', '5', '6', '7'),
    );
    game.runningCount = 6; // C-R6: bet size is graded only at a play count
    expect(game.trueCountNow).toBe(1);
    game.startRound([2, 2]);

    const betEvents = game.events.filter((e) => e.kind === 'bet');
    expect(betEvents).toHaveLength(2);
    expect(betEvents[0].correct).toBe(true);
    expect(betEvents[0].expected).toBe('2');
    expect(betEvents[0].taken).toBe('2');
    expect(betEvents[1].correct).toBe(true);
    expect(betEvents[1].expected).toBe('2');
    expect(betEvents[1].taken).toBe('2');
  });

  it('scalar startRound(2) with playerHands 2 -> both hands bet 2 (back-compat)', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '3', '4', '5', '6', '7'));
    game.startRound(2);
    expect(game.hands[0].bet).toBe(2);
    expect(game.hands[1].bet).toBe(2);
  });

  it('split inside hand 1 does not consume hand 0s split budget (per-origin 4-hand cap)', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Deal: hand0=[8,8], hand1=[8,8], dealer 5/6 (irrelevant, never reached).
    // Play starts on the RIGHT (#1), so chain-split hand1's lineage up to 3
    // hands (still < 4, its own cap), while hand0 (a completely separate
    // original hand / origin) has split 0 times. Total array length reaches 4
    // at that point -- a GLOBAL hands.length<4 cap would (wrongly) block hand0
    // from ever splitting; a PER-ORIGIN cap must not.
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('8', '8', '5', '8', '8', '6', '8', '2', '8', '3', '8', '3'),
    );
    game.startRound();
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.active).toBe(1);

    game.act('split'); // hand1 -> hand1[8,2] + new hand1b[8,8] to its right; hands=[hand0,hand1,hand1b]
    expect(game.hands).toHaveLength(3);
    expect(game.hands[2].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '2']);
    expect(game.active).toBe(2); // the new right-hand half (re-formed pair)

    game.act('split'); // hand1b -> hand1b[8,3] + new hand1c[8,8]; hands=[hand0,hand1,hand1b,hand1c]
    expect(game.hands).toHaveLength(4);
    expect(game.hands[3].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.hands[2].cards.map((c) => c.rank)).toEqual(['8', '3']);
    expect(game.active).toBe(3);

    // Total hands.length is now 4 -- exactly the GLOBAL cap. hand1's own
    // lineage (origin) has only 3 hands, so ONE more split must still be
    // legal for it under a correct per-origin cap.
    expect(game.legalActions()).toContain('split');

    game.act('stand'); // hand1c done -> advance left to hand1b
    expect(game.active).toBe(2);
    game.act('stand'); // hand1b done -> hand1
    expect(game.active).toBe(1);
    game.act('stand'); // hand1 done -> hand0
    expect(game.active).toBe(0);

    // hand0 has never split -- its own origin group has exactly 1 hand, so
    // split must be legal for it regardless of hand1's lineage already
    // sitting at the global total of 4.
    expect(game.legalActions()).toContain('split');
    game.act('split');
    expect(game.hands).toHaveLength(5);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['8', '8']);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['8', '3']);
    expect(game.active).toBe(1);
  });

  it('bets array length !== playerHands -> throws Error', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = Game.withRiggedShoe(cfg({ seats }), rig('2', '3', '4', '5', '6', '7'));

    // bets array has length 3 but playerHands is 2
    expect(() => game.startRound([1, 2, 3])).toThrow(
      /startRound: bets array length 3 does not match playerHands 2/,
    );
  });

  it('hand0 live (10,6=16), hand1 natural (A,K=BJ): BJ settled immediately, player completes hand0, outcomes summed', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Deal order (right to left): hand1c1, hand0c1, dealerUp, hand1c2, hand0c2, dealerHole, dealerDraws...
    // To get hand0=(10,6)=16, hand1=(A,K)=BJ, dealer=(9,7)=16 then hits K->bust:
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('A', '10', '9', 'K', '6', '7', 'K'),
    );
    const initialBankroll = game.bankroll;

    game.startRound();

    // After startRound, hand1 is a natural blackjack (done, result set, bankroll credited)
    // hand0 is still awaiting play (active=0, phase='player')
    expect(game.hands).toHaveLength(2);
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6']); // 16
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'K']); // blackjack

    expect(game.hands[1].result).toBe('blackjack');
    expect(game.hands[1].done).toBe(true);
    expect(game.hands[1].net).toBe(1.5);

    expect(game.hands[0].result).toBeUndefined();
    expect(game.hands[0].done).toBe(false);
    expect(game.phase).toBe('player');
    expect(game.active).toBe(0); // first live hand

    // Player completes hand0 (stands at 16)
    game.act('stand');
    expect(game.phase).toBe('settled');

    // Dealer 9,7 (hard 16) hits and draws K -> bust (26)
    // Player 16 wins vs bust
    expect(game.hands[0].result).toBe('win');
    expect(game.hands[0].net).toBe(1);

    // Bankroll reflects both: hand1's BJ (+1.5) + hand0's win (+1) = +2.5
    expect(game.bankroll).toBe(initialBankroll + 2.5);
  });
});

describe('insurance across all player hands (Cycle-2 Task 5)', () => {
  it('2 hands, bets [1,3], insurance taken + dealer BJ (both non-natural) -> pays 2:1 on summed stake, classic even-money wash', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Deal order: hand0c1, hand1c1, dealerUp, hand0c2, hand1c2, dealerHole.
    // hand0=(10,6)=16, hand1=(9,7)=16 -- both non-natural. dealer=(A,K)=BJ.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', '9', 'A', '6', '7', 'K'));
    game.startRound([1, 3]);
    expect(game.phase).toBe('insurance');
    const initialBankroll = game.bankroll;

    game.insuranceDecision(true);
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);
    expect(game.hands[1].result).toBe('lose');
    expect(game.hands[1].net).toBe(-3);
    // stake = (1+3)/2 = 2, pays 2:1 -> insuranceNet = 4
    expect(game.insuranceNet).toBe(4);
    // -(1+3) + 4 = 0: classic even-money wash across both hands
    expect(game.bankroll).toBe(initialBankroll);
  });

  it('2 hands, bets [1,3], insurance taken + dealer NO BJ -> lose (bet0+bet1)/2 immediately, hands then play out', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Deal order: hand0c1, hand1c1, dealerUp, hand0c2, hand1c2, dealerHole.
    // hand0=(10,9)=19, hand1=(8,7)=15, dealer=(A,9)=20 (soft 20, stands -- no
    // dealer BJ since hole isn't ten-value).
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', '8', 'A', '9', '7', '9'));
    game.startRound([1, 3]);
    expect(game.phase).toBe('insurance');
    const initialBankroll = game.bankroll;

    game.insuranceDecision(true);
    expect(game.phase).toBe('player');
    // stake = (1+3)/2 = 2, lost immediately
    expect(game.insuranceNet).toBe(-2);
    expect(game.bankroll).toBe(initialBankroll - 2);

    expect(game.active).toBe(1); // #1: right hand first
    game.act('stand'); // hand1 15 vs dealer 20 -> lose
    expect(game.active).toBe(0);
    game.act('stand'); // hand0 19 vs dealer 20 -> lose
    expect(game.phase).toBe('settled');

    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-1);
    expect(game.hands[1].result).toBe('lose');
    expect(game.hands[1].net).toBe(-3);
    // insurance loss (-2) + both hand losses (-1, -3)
    expect(game.bankroll).toBe(initialBankroll - 2 - 1 - 3);
  });

  it('hand0 normal (10,6=16), hand1 natural (A,K), insurance taken + dealer BJ -> natural pushes, hand0 loses, insurance pays 2:1 on summed stake', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Deal order (right to left): hand1c1, hand0c1, dealerUp, hand1c2, hand0c2, dealerHole.
    // hand0=(10,6)=16 (non-natural), hand1=(A,K)=natural BJ. dealer=(A,K)=BJ.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('A', '10', 'A', 'K', '6', 'K'));
    game.startRound([2, 5]);
    expect(game.phase).toBe('insurance');
    const initialBankroll = game.bankroll;

    game.insuranceDecision(true);
    expect(game.phase).toBe('settled');
    expect(game.hands[0].cards.map((c) => c.rank)).toEqual(['10', '6']);
    expect(game.hands[1].cards.map((c) => c.rank)).toEqual(['A', 'K']);
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-2);
    expect(game.hands[1].result).toBe('push'); // player natural pushes vs dealer BJ
    expect(game.hands[1].net).toBe(0);
    // stake = (2+5)/2 = 3.5, pays 2:1 -> insuranceNet = 7
    expect(game.insuranceNet).toBe(7);
    expect(game.bankroll).toBe(initialBankroll - 2 + 0 + 7);
  });

  it('playerHands 1 array-bet parity: startRound([2]), take + dealer BJ -> insuranceNet = +2, net 0 overall (byte-identical to scalar path)', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', 'K'));
    game.startRound([2]);
    const initialBankroll = game.bankroll;

    game.insuranceDecision(true);
    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('lose');
    expect(game.hands[0].net).toBe(-2);
    expect(game.insuranceNet).toBe(2); // sum(bet)=2 -> stake 1 -> pays 2
    expect(game.bankroll).toBe(initialBankroll); // -2 + 2 = 0
  });

  it('playerHands 1 array-bet parity: startRound([2]), take + no dealer BJ -> insuranceNet = -1, round continues', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', 'A', '6', '5', '8'));
    game.startRound([2]);
    const initialBankroll = game.bankroll;

    game.insuranceDecision(true);
    expect(game.phase).toBe('player');
    expect(game.insuranceNet).toBe(-1); // sum(bet)/2 = 2/2 = 1
    expect(game.bankroll).toBe(initialBankroll - 1);
  });

  it('playerHands 2, insurance taken -> exactly ONE insurance GradedEvent (not one per hand)', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', '9', 'A', '6', '7', 'K'));
    game.startRound([1, 3]);
    game.insuranceDecision(true);

    const insuranceEvents = game.events.filter((e) => e.kind === 'insurance');
    expect(insuranceEvents).toHaveLength(1);
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

describe('v1 parity: an all-natural round must not wake the dealer (cycle-2 regression)', () => {
  // v1 short-circuited a player natural with `finishRound(); return;` -- it never
  // entered playDealerAndSettle, so the hole card was NEVER revealed and the
  // dealer NEVER drew. Cycle 2 routed every path through playDealerAndSettle,
  // whose `live hand` filter ignored already-settled hands, so a settled
  // 'blackjack' still counted as live and the dealer played on. That leaks the
  // hole card (and any draws) into the shoe position and the running count,
  // desynchronising every later round of a seeded session.
  it('solo player natural: hole stays down, dealer does not draw, RC excludes the hole', () => {
    // Deal order (solo): p1, dealerUp, p2, dealerHole => player A,K = natural;
    // dealer 9,5 (hard 14 -- would certainly draw if it were ever asked to).
    const game = Game.withRiggedShoe(cfg(), rig('A', '9', 'K', '5', '6'));
    game.startRound();

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.bankroll).toBe(101.5);

    // The dealer never acts on an all-natural round.
    expect(game.holeRevealed).toBe(false);
    expect(game.dealerCards).toHaveLength(2);

    // Only the three FACE-UP cards are counted: A(-1) + 9(0) + K(-1) = -2.
    // The hole 5 (+1) and the would-be draw 6 (+1) must not appear.
    expect(game.runningCount).toBe(-2);
    expect(game.shoe.cardsRemaining).toBe(1);
  });

  it('solo player BUST still reveals the hole (v1 did enter playDealerAndSettle here)', () => {
    // player 10,6 then hits K = bust; dealer 9,5.
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '5', 'K'));
    game.startRound();
    game.act('hit');

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('lose');
    // Busting does NOT suppress the reveal -- matching v1 exactly.
    expect(game.holeRevealed).toBe(true);
    // ...but the dealer still must not DRAW to a bust-only table.
    expect(game.dealerCards).toHaveLength(2);
  });

  it('with bots at the table, a player natural still lets the dealer play for them', () => {
    // A live bot hand genuinely needs a real dealer total to settle against.
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    // Deal order (bot seat 0, player seat 1): bot1, p1, dealerUp, bot2, p2, hole
    // bot = 10,7 = 17 (stands); player = A,K = natural; dealer = 9,5 = 14 -> draws.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', 'A', '9', '7', 'K', '5', '6'));
    game.startRound();

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.holeRevealed).toBe(true);
    expect(game.dealerCards.length).toBeGreaterThan(2);
  });
});

describe('full-table shoe exhaustion (cycle-2 review I2/M5)', () => {
  it('never throws "Cannot draw from empty shoe" at deep penetration with a full table', () => {
    // 5 bots + 3 player hands at 0.9 penetration is the worst realistic case:
    // the deal alone takes 2*(5+3)+2 = 18 cards, and splitting whenever legal
    // multiplies that. Before the pre-deal depth guard, ~15% of seeds crashed
    // here, which blanked the React tree and lost the whole session.
    const seats: SeatConfig = { playerHands: 3, bots: 5, botMistakePct: 20, playerPosition: 2 };
    for (let seed = 1; seed <= 60; seed++) {
      const game = new Game(cfg({ seats, seed, penetration: 0.9 }));
      expect(() => {
        for (let round = 0; round < 60; round++) {
          game.startRound([1, 1, 1]);
          if (game.phase === 'insurance') game.insuranceDecision(false);
          let guard = 0;
          while (game.phase === 'player' && guard++ < 60) {
            const legal = game.legalActions();
            // Split whenever it is legal -- maximum card consumption.
            game.act(legal.includes('split') ? 'split' : 'stand');
          }
        }
      }).not.toThrow();
    }
  });

  it('a rejected bets-array length leaves the Game completely unmutated', () => {
    const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
    const game = new Game(cfg({ seats }));
    const roundNoBefore = game.roundNo;
    const cardsBefore = game.shoe.cardsRemaining;

    expect(() => game.startRound([1, 2, 3])).toThrow(/does not match playerHands/);

    // Validation must happen before ANY state advance.
    expect(game.roundNo).toBe(roundNoBefore);
    expect(game.shoe.cardsRemaining).toBe(cardsBefore);
  });
});

/* ------------------------------------------------------------------------ */
/* dealerAlwaysPlaysOut: the table-with-others reveal (operator request)     */
/* ------------------------------------------------------------------------ */

/**
 * Operator: "I just got a blackjack and it instantly went to the next hand,
 * the dealer is supposed to play out the hand so I can continue counting" --
 * then, once told the omission was deliberate: "If that's on purpose that's
 * fine but should be a setting, most of the time I'm playing at a table with
 * others so I want to emulate that."
 *
 * Both behaviours are correct, for different tables. Heads-up, the dealer
 * pays a natural and sweeps without exposing, so a counter never sees the
 * hole and must not count it -- that is the default, pinned above. With other
 * players still live the dealer plays on and the hole IS seen. These specs
 * pin the opt-in, and specifically that it reveals WITHOUT inventing draws.
 */
describe('dealerAlwaysPlaysOut', () => {
  it('reveals and counts the hole on a solo natural when enabled', () => {
    // Same rigged shoe as the default-behaviour spec above: player A,K
    // (natural); dealer 9,5. Only the flag differs.
    const game = Game.withRiggedShoe(
      { ...cfg(), dealerAlwaysPlaysOut: true },
      rig('A', '9', 'K', '5', '6'),
    );
    game.startRound();

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    // The payout is untouched by a display/count concern.
    expect(game.bankroll).toBe(101.5);

    // The hole is now SEEN...
    expect(game.holeRevealed).toBe(true);
    // ...and counted: A(-1) + 9(0) + K(-1) + hole 5(+1) = -1.
    expect(game.runningCount).toBe(-1);
  });

  it('reveals the hole but does NOT draw cards nobody needs', () => {
    // Dealer holds 9,5 = hard 14, which any live hand would force a draw on.
    // Nothing is live, so the dealer must stop at two cards -- drawing here
    // would pull a card out of the shoe that a real table never exposes and
    // would bias the count in the opposite direction to the bug being fixed.
    const game = Game.withRiggedShoe(
      { ...cfg(), dealerAlwaysPlaysOut: true },
      rig('A', '9', 'K', '5', '6'),
    );
    game.startRound();

    expect(game.dealerCards).toHaveLength(2);
    // The would-be draw (the 6) is still in the shoe.
    expect(game.shoe.cardsRemaining).toBe(1);
  });

  it('leaves the default behaviour untouched when disabled', () => {
    const game = Game.withRiggedShoe({ ...cfg(), dealerAlwaysPlaysOut: false }, rig('A', '9', 'K', '5', '6'));
    game.startRound();
    expect(game.holeRevealed).toBe(false);
    expect(game.runningCount).toBe(-2);
  });

  // The flag only concerns the all-resolved case. A round with a live hand
  // already plays the dealer out, so enabling it must change nothing there --
  // otherwise it would be silently altering ordinary play too.
  it('changes nothing on a round that already plays the dealer out', () => {
    const plain = Game.withRiggedShoe(cfg(), rig('5', '9', '6', '5', '6', '7'));
    plain.startRound();
    plain.act('stand');

    const flagged = Game.withRiggedShoe(
      { ...cfg(), dealerAlwaysPlaysOut: true },
      rig('5', '9', '6', '5', '6', '7'),
    );
    flagged.startRound();
    flagged.act('stand');

    expect(flagged.runningCount).toBe(plain.runningCount);
    expect(flagged.dealerCards.length).toBe(plain.dealerCards.length);
    expect(flagged.bankroll).toBe(plain.bankroll);
  });
});

describe('dealOrder (Table Realism, Request B groundwork: presentation-only deal-order log)', () => {
  it('solo, no bots: pass1, dealer-up, pass2, dealer-hole, in that exact order', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8'));
    game.startRound();
    expect(game.dealOrder).toEqual([
      { kind: 'player', handIndex: 0, cardIndex: 0 },
      { kind: 'dealer', cardIndex: 0 },
      { kind: 'player', handIndex: 0, cardIndex: 1 },
      { kind: 'dealer', cardIndex: 1 },
    ]);
  });

  it('a bot seated before the player is logged before the player in EACH pass', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('10', '10', '2', '5', '10', '4', '9', '6'),
    );
    game.startRound();
    expect(game.dealOrder.slice(0, 6)).toEqual([
      { kind: 'bot', seatIndex: 0, handIndex: 0, cardIndex: 0 },
      { kind: 'player', handIndex: 0, cardIndex: 0 },
      { kind: 'dealer', cardIndex: 0 },
      { kind: 'bot', seatIndex: 0, handIndex: 0, cardIndex: 1 },
      { kind: 'player', handIndex: 0, cardIndex: 1 },
      { kind: 'dealer', cardIndex: 1 },
    ]);
  });

  it('a fresh round replaces dealOrder with a NEW array (reference change), not an append', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5', '7', '4', '9'));
    game.startRound();
    const firstOrder = game.dealOrder;
    game.act('stand');
    game.startRound();
    expect(game.dealOrder).not.toBe(firstOrder);
    expect(game.dealOrder).toHaveLength(4);
  });
});

/**
 * M6: the bot-mistake stream is not the shoe's stream.
 *
 * `Game` looked like it held two independent generators. It did not: the Shoe
 * was `mulberry32(cfg.seed)` and the bot rng was `mulberry32(cfg.seed)` — the
 * same algorithm on the same number, which is one stream drawn twice. The Nth
 * bot-mistake roll was the Nth number Fisher-Yates used to arrange the deck, so
 * WHO misplays and WHEN was a deterministic function of HOW THE CARDS FELL, and
 * there was no seed that varied one while holding the other.
 */
describe('bot-mistake RNG is decorrelated from the shoe (M6)', () => {
  it('does not run the bot stream on the shoe\'s own seed', () => {
    for (const seed of [0, 1, 2, 7, 12345, 0x7fffffff]) {
      expect(botRngSeed(seed)).not.toBe(seed);
    }
  });

  it('scatters neighbouring seeds instead of shifting them', () => {
    // Adjacent game seeds must not give adjacent bot seeds, or "try seed+1"
    // would walk the bot stream one step alongside the shoe's.
    expect(Math.abs(botRngSeed(1) - botRngSeed(2))).toBeGreaterThan(1);
  });

  it('stays a uint32, so mulberry32 gets the state it expects', () => {
    for (const seed of [0, 1, 0xffffffff, 0x9e3779b9]) {
      const out = botRngSeed(seed);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('is a pure constant offset, so the same seed still replays the same session', () => {
    expect(botRngSeed(4242)).toBe(botRngSeed(4242));

    const play = (): string => {
      const game = new Game({
        penetration: 0.75,
        betSpreadOn: false,
        spread: [],
        bankrollStart: 1000,
        countCheckEvery: 0,
        rules: DEFAULT_RULES,
        seed: 4242,
        seats: { bots: 3, playerHands: 1, playerPosition: 1, botMistakePct: 50 },
      });
      const log: string[] = [];
      for (let r = 0; r < 12; r++) {
        game.startRound(1);
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
        log.push(game.botActionLog.map((e) => `${e.seat}:${e.action}`).join('|'));
      }
      return log.join(' / ');
    };

    const a = play();
    const b = play();
    expect(b).toBe(a);
    // Vacuity guard: the bots actually did something to be deterministic about.
    expect(a.length).toBeGreaterThan(20);
  });

  /**
   * The property the salt buys. Two games dealt the SAME cards (a rigged shoe
   * ignores the seed entirely) must still be able to differ in how the bots
   * play, because bot behaviour is now driven by its own stream.
   */
  it('lets bot behaviour vary while the cards stay fixed', () => {
    const cards = Array.from({ length: 400 }, (_, i) => ({
      rank: (['2', '7', '10', 'A', '5', '9', '3', '8'] as const)[i % 8],
      suit: 's' as const,
    }));
    const logFor = (seed: number): string => {
      const game = Game.withRiggedShoe(
        {
          penetration: 0.99,
          betSpreadOn: false,
          spread: [],
          bankrollStart: 1000,
          countCheckEvery: 0,
          rules: DEFAULT_RULES,
          seed,
          seats: { bots: 3, playerHands: 1, playerPosition: 1, botMistakePct: 50 },
        },
        cards,
      );
      const log: string[] = [];
      for (let r = 0; r < 8; r++) {
        game.startRound(1);
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
        log.push(game.botActionLog.map((e) => `${e.seat}:${e.action}`).join('|'));
      }
      return log.join(' / ');
    };

    const seeds = [1, 2, 3, 4, 5, 11, 99, 12345];
    const logs = new Set(seeds.map(logFor));
    // Same cards every time, so any difference here is the bot stream alone.
    expect(logs.size).toBeGreaterThan(1);
  });
});

describe('V5-4: the table grades against the profile rounding convention', () => {
  /** Deal rounds on a seeded shoe until the exact quotient is negative and fractional. */
  function seekNegativeFraction(tcRounding?: 'floor' | 'truncate' | 'round') {
    for (let seed = 1; seed <= 400; seed++) {
      const game = new Game(cfg({ seed, ...(tcRounding ? { tcRounding } : {}) }));
      for (let round = 0; round < 25; round++) {
        game.startRound();
        const exact = game.runningCount / Math.max(0.5, game.shoe.decksRemaining);
        if (exact < 0 && !Number.isInteger(exact)) {
          return { game, seed, round, exact };
        }
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
      }
    }
    return null;
  }

  it('reaches a negative fractional quotient at all -- the case the rule decides', () => {
    // Vacuity guard: if a real shoe never produced one, everything below would
    // pass under any implementation.
    const found = seekNegativeFraction();
    expect(found, 'no negative fractional true count in 400 seeds').not.toBeNull();
  });

  it('floor and truncate give different table true counts there', () => {
    const found = seekNegativeFraction();
    expect(found).not.toBeNull();
    const { seed, round } = found!;

    const run = (tcRounding: 'floor' | 'truncate') => {
      const game = new Game(cfg({ seed, tcRounding }));
      for (let r = 0; r <= round; r++) {
        game.startRound();
        if (r === round) return game.trueCountNow;
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
      }
      throw new Error('unreachable');
    };

    expect(run('truncate')).toBe(run('floor') + 1);
  });

  it('omitting the setting is byte-identical to the old hardcoded floor', () => {
    const found = seekNegativeFraction();
    const { seed, round } = found!;
    const run = (overrides: Partial<GameConfig>) => {
      const game = new Game(cfg({ seed, ...overrides }));
      for (let r = 0; r <= round; r++) {
        game.startRound();
        if (r === round) return game.trueCountNow;
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
      }
      throw new Error('unreachable');
    };
    expect(run({})).toBe(run({ tcRounding: 'floor' }));
  });
});

/**
 * #1 split order. A casino plays the hand on the dealer's left -- the
 * player's RIGHT -- first. Hands are stored and drawn left to right, so play
 * runs from the highest index down, and a split's new hand goes in right
 * next to the hand split and is played next.
 */
describe('casino play order: right to left (#1)', () => {
  it('three dealt hands are played rightmost first, then leftwards', () => {
    const seats: SeatConfig = { playerHands: 3, bots: 0, botMistakePct: 0, playerPosition: 0 };
    // Dealt right to left too: Pass 1: h2 8, h1 9, h0 10, up 7. Pass 2: h2 4,
    // h1 3, h0 2, hole 10.
    const game = Game.withRiggedShoe(cfg({ seats }), rig('8', '9', '10', '7', '4', '3', '2', '10'));
    game.startRound();
    const visited: string[] = [];
    while (game.phase === 'player') {
      visited.push(`${game.active}:${game.hands[game.active].cards.map((c) => c.rank).join(',')}`);
      game.act('stand');
    }
    expect(visited).toEqual(['2:8,4', '1:9,3', '0:10,2']);
    // The graded actions come out in the same order.
    expect(game.events.filter((e) => e.kind === 'action').map((e) => e.hand)).toEqual([
      '8,4 v 7',
      '9,3 v 7',
      '10,2 v 7',
    ]);
  });

  it('every resplit is played before the hands to its left, and descending index is play order', () => {
    // P(8,8) v 6. Split: right gets 8 (8,8), left gets 2. Resplit the right:
    // its new right half gets 3, it gets 9. Then stand everything.
    const game = Game.withRiggedShoe(cfg(), rig('8', '6', '8', '10', '8', '2', '3', '9', '10'));
    game.startRound();
    const visited: number[] = [];
    let guard = 0;
    while (game.phase === 'player' && guard++ < 20) {
      visited.push(game.active);
      game.act(game.legalActions().includes('split') ? 'split' : 'stand');
    }
    // split at 0 -> play 1 (split again) -> play 2, then 1, then 0.
    expect(visited).toEqual([0, 1, 2, 1, 0]);
    expect(game.hands.map((h) => h.cards.map((c) => c.rank).join(','))).toEqual(['8,2', '8,9', '8,3']);
    // The hand played first is "hand 1".
    expect(game.hands.map((_, i) => handPlayNumber(i, game.hands.length))).toEqual([3, 2, 1]);
  });

  it('bots play their splits right to left too, and their log still names the right hands', () => {
    // Bot at first base, player after it, so the bot plays inside startRound.
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    // Deal: bot 8, player 10, up 6, bot 8, player 7, hole 10.
    // Split #1 (bot hand 0): new right half draws 8 (8,8), hand 0 draws 8 (8,8).
    // Right half resplits (#2): its new right half draws 3 (8,3 -> double, 10),
    // it draws 9 (17, stand). Then hand 0 splits (#3): new right half draws 2
    // (8,2 -> double, 5), hand 0 draws 9 (stand). Player stands; dealer 16 hits K.
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('8', '10', '6', '8', '7', '10', '8', '8', '3', '9', '10', '2', '9', '5', 'K'),
    );
    const order: number[] = [];
    game.onBotDecision = (info) => order.push(info.handIndex);
    game.startRound();

    expect(order).toEqual([0, 1, 2, 1, 0, 1, 0]);
    const bot = game.seats[0].hands;
    expect(bot.map((h) => h.cards.map((c) => c.rank).join(','))).toEqual(['8,9', '8,2,5', '8,9', '8,3,10']);
    // The third split pushed the already-played hands one place right; their
    // logged entries moved with them.
    expect(game.botActionLog.map((e) => `${e.action}@${e.handIndex}${e.card ? `:${e.card.rank}` : ''}`)).toEqual([
      'split@0',
      'split@2',
      'double@3:10',
      'stand@2',
      'split@0',
      'double@1:5',
      'stand@0',
    ]);
    for (const e of game.botActionLog) {
      if (e.card) expect(bot[e.handIndex].cards).toContain(e.card);
    }
  });

  it('handPlayNumber counts from the right', () => {
    expect(handPlayNumber(0, 1)).toBe(1);
    expect(handPlayNumber(0, 2)).toBe(2);
    expect(handPlayNumber(1, 2)).toBe(1);
    expect(handPlayNumber(2, 4)).toBe(2);
  });
});

describe('#39 cut card from cutDecks / cutVary', () => {
  it('cutDecks puts the cut that many decks from the back', () => {
    const game = new Game(cfg({ cutDecks: 1 }));
    expect(game.shoe.cutCardPosition).toBe(312 - 52);
  });

  it('neither field set keeps the penetration cut', () => {
    expect(new Game(cfg({ penetration: 0.8 })).shoe.cutCardPosition).toBe(249);
  });

  it('cutVary moves the cut from shoe to shoe, within ±0.5 decks, reproducibly per seed', () => {
    const cuts = (seed: number) => {
      const game = new Game(cfg({ cutDecks: 1.5, cutVary: true, seed }));
      const out = [game.shoe.cutCardPosition];
      for (let i = 0; i < 9; i++) {
        game.shoe.shuffle();
        out.push(game.shoe.cutCardPosition);
      }
      return out;
    };
    const a = cuts(5);
    expect(new Set(a).size).toBeGreaterThan(5);
    for (const pos of a) {
      expect(312 - pos).toBeGreaterThanOrEqual(52);
      expect(312 - pos).toBeLessThanOrEqual(104);
    }
    expect(cuts(5)).toEqual(a);
  });

  it('the cut never moves a card: the same seed deals the same rounds with or without it', () => {
    const ranks = (game: Game) => {
      const out: string[] = [];
      for (let r = 0; r < 5; r++) {
        game.startRound();
        if (game.phase === 'insurance') game.insuranceDecision(false);
        while (game.phase === 'player') game.act('stand');
        out.push([...game.hands.flatMap((h) => h.cards), ...game.dealerCards].map((c) => c.rank).join());
      }
      return out;
    };
    expect(ranks(new Game(cfg({ seed: 77, cutDecks: 2, cutVary: true })))).toEqual(ranks(new Game(cfg({ seed: 77 }))));
  });

  it('the shoe reshuffles at the varied cut', () => {
    // A 1-deck cut with vary on: reaching the shoe's own cut position is what
    // triggers the pre-deal reshuffle.
    const game = new Game(cfg({ cutDecks: 1, cutVary: true, seed: 3 }));
    const pos = game.shoe.cutCardPosition;
    let rounds = 0;
    while (!game.shuffledLastRound && rounds < 200) {
      const dealtBefore = game.shoe.cardsDealt;
      game.startRound();
      rounds += 1;
      if (game.shuffledLastRound) {
        expect(dealtBefore).toBeGreaterThanOrEqual(pos);
        break;
      }
      expect(dealtBefore).toBeLessThan(pos);
      if (game.phase === 'insurance') game.insuranceDecision(false);
      while (game.phase === 'player') game.act('stand');
    }
    expect(game.shuffledLastRound).toBe(true);
  });
});

describe('Wave A engine fixes', () => {
  it('F7: the count check accepts trueCountNow under a truncating profile', () => {
    const game = new Game(cfg({ tcRounding: 'truncate' }));
    // RC -5 with six decks left is -0.83: truncate says 0, floor says -1.
    game.runningCount = -5;
    game.askRc = false;
    game.askTcToo = true;
    game.countCheckDue = true;
    expect(game.trueCountNow).toBe(0);
    const { tcCorrect } = game.submitCountCheck(null, game.trueCountNow);
    expect(tcCorrect).toBe(true);
  });

  // C11 (audit 2026-10-29): the BJA chart prints 12 v 4 as "0-", any
  // negative running count. Truncate rounds RC -3 over ~6 decks to TC 0, which
  // graded the stand as right and the hit as wrong.
  it('C11: under truncate, 12 v 4 at a small negative running count is a hit', () => {
    for (const [taken, right] of [['hit', true], ['stand', false]] as const) {
      const game = Game.withRiggedShoe(cfg({ tcRounding: 'truncate' }), rig('10', '4', '2', '10', '5', '5', '5', '5'));
      game.startRound();
      if (game.phase === 'insurance') game.insuranceDecision(false);
      game.runningCount = -3;
      expect(game.trueCountNow).toBe(0);
      game.act(taken);
      const ev = game.events.find((e) => e.kind === 'action')!;
      expect(ev.correct, taken).toBe(right);
      expect(ev.expected).toBe('hit');
    }
  });

  // R2 (review of C11): the miss names the rule it was graded by.
  it('R2: the 12 v 4 miss under truncate says the running count decided it', () => {
    const game = Game.withRiggedShoe(cfg({ tcRounding: 'truncate' }), rig('10', '4', '2', '10', '5', '5', '5', '5'));
    game.startRound();
    if (game.phase === 'insurance') game.insuranceDecision(false);
    game.runningCount = -3;
    game.act('stand');
    const ev = game.events.find((e) => e.kind === 'action')!;
    expect(ev.tc).toBe(0);
    expect(ev.reason).toBe('12 v 4: stand when the running count is 0 or more; hit at any negative running count');
  });

  it('C11: floor grading of the zero cells is unchanged', () => {
    const game = Game.withRiggedShoe(cfg({ tcRounding: 'floor' }), rig('10', '4', '2', '10', '5', '5', '5', '5'));
    game.startRound();
    game.runningCount = 0;
    game.act('stand');
    expect(game.events.find((e) => e.kind === 'action')!.correct).toBe(true);
  });

  // C16 (audit 2026-10-29): on 1 and 2 decks the chart doubles 9 v 2 at every
  // count, so the drills never ask that index; Play must not tag it either.
  it('C16: a 9 v 2 double is an index answer on 6 decks, a chart play on 2', () => {
    const tagged = (decks: 2 | 6) => {
      const game = Game.withRiggedShoe(cfg({ rules: { ...DEFAULT_RULES, decks } }), rig('5', '2', '4', '10', '5', '5', '5', '5'));
      game.startRound();
      game.runningCount = 20;
      expect(game.trueCountNow).toBeGreaterThanOrEqual(1);
      game.act('double');
      const ev = game.events.find((e) => e.kind === 'action')!;
      expect(ev.correct).toBe(true);
      return ev.deviationId;
    };
    expect(tagged(6)).toBe('9v2');
    expect(tagged(2)).toBeUndefined();
  });

  it('F10: no double after a split without DAS', () => {
    const deal = rig('8', '6', '8', '10', '3', '2', '10', '10', '10', '10');
    const noDas = Game.withRiggedShoe(cfg({ rules: { ...DEFAULT_RULES, das: false } }), deal);
    noDas.startRound();
    noDas.act('split');
    expect(noDas.hands[noDas.active].cards).toHaveLength(2);
    expect(noDas.legalActions()).not.toContain('double');

    const das = Game.withRiggedShoe(cfg({ rules: { ...DEFAULT_RULES, das: true } }), deal);
    das.startRound();
    das.act('split');
    expect(das.legalActions()).toContain('double');
  });

  it('F19: split aces at the 4-hand cap are done, never asked for a play they cannot make', () => {
    const game = Game.withRiggedShoe(
      cfg({ rules: { ...DEFAULT_RULES, rsa: true } }),
      rig('A', '6', 'A', '10', 'A', 'A', 'A', 'A', '5', '7', '5', '9', '9', '9', '9'),
    );
    game.startRound();
    game.act('split'); // 2 hands, both A,A
    game.act('split'); // 3 hands
    game.act('split'); // 4 hands: the cap
    // Every hand is a split ace that can neither hit nor resplit: done.
    expect(game.phase).toBe('settled');
    const asked = game.events.filter((e) => e.kind === 'action');
    expect(asked.every((e) => e.taken === 'split')).toBe(true);
  });
});

describe('handsPlayed (B6)', () => {
  it('counts each settled player hand, splits included, and nothing for a sit-out', () => {
    const one = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    one.startRound(); one.act('hit'); one.act('stand');
    expect(one.handsPlayed).toBe(1);

    const split = Game.withRiggedShoe(cfg(), rig('8', '9', '8', '7', '10', '10', '10', '10', '10'));
    split.startRound(); split.act('split');
    while (split.phase === 'player') split.act('stand');
    expect(split.handsPlayed).toBe(2);

    const sat = new Game(cfg({ seed: 5 }));
    sat.sitOut();
    expect(sat.handsPlayed).toBe(0);
  });
});
