import { Shoe, rankValue } from './cards';
import type { Card, Rank } from './cards';
import { handValue, isBust, isBlackjack, isPair } from './hand';
import { hiLoTag, trueCount } from './count';
import { correctPlay, basicPlay, insuranceCorrect } from './strategy';
import type { PlayContext, Advice } from './strategy';
import { classifyAction, actionCategory } from './grade';
import type { GradedEvent } from './grade';
import type { Action } from './deviations';

export interface SpreadRow {
  minTc: number;
  units: number;
}

// sorted asc; bet = last row with minTc <= tc
export const DEFAULT_SPREAD: SpreadRow[] = [
  { minTc: -99, units: 1 },
  { minTc: 1, units: 2 },
  { minTc: 2, units: 4 },
  { minTc: 3, units: 8 },
  { minTc: 4, units: 10 },
  { minTc: 5, units: 12 },
];

export interface GameConfig {
  penetration: number; // 0.5..0.9
  betSpreadOn: boolean;
  spread: SpreadRow[];
  bankrollStart: number; // units
  countCheckEvery: number; // rounds; 0 = off
  seed?: number;
}

export type Phase = 'idle' | 'insurance' | 'player' | 'settled';

export interface PlayerHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  surrendered: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  result?: 'win' | 'lose' | 'push' | 'blackjack' | 'surrender';
  net?: number; // units
}

/** Find the last spread row (sorted asc by minTc) whose minTc <= tc. */
function spreadUnitsFor(tc: number, spread: SpreadRow[]): number {
  let units = spread.length > 0 ? spread[0].units : 1;
  for (const row of spread) {
    if (row.minTc <= tc) units = row.units;
  }
  return units;
}

function isTenValueUp(up: Rank): boolean {
  return up !== 'A' && rankValue(up) === 10;
}

function describeHand(cards: Card[], up: Rank): string {
  return `${cards.map((c) => c.rank).join(',')} v ${up}`;
}

/**
 * A minimal Shoe-surface object that deals a pre-stacked list of cards in
 * order, for deterministic tests. Cast to Shoe at the boundary (test-only;
 * see Game.withRiggedShoe).
 */
function makeRiggedShoe(cards: Card[], penetration: number): Shoe {
  const queue = [...cards];
  const cutCardPosition = Math.floor(cards.length * penetration);
  let dealt = 0;
  const rigged = {
    draw(): Card {
      if (queue.length === 0) throw new Error('Rigged shoe exhausted');
      dealt++;
      return queue.shift()!;
    },
    get cardsRemaining(): number {
      return queue.length;
    },
    get cardsDealt(): number {
      return dealt;
    },
    get decksRemaining(): number {
      const rounded = Math.round(queue.length / 26);
      return Math.max(0.5, rounded / 2);
    },
    get cutCardReached(): boolean {
      return dealt >= cutCardPosition;
    },
    shuffle(): void {
      dealt = 0;
    },
  };
  return rigged as unknown as Shoe;
}

export class Game {
  readonly cfg: GameConfig;
  phase: Phase = 'idle';
  shoe: Shoe;
  runningCount = 0;
  dealerCards: Card[] = [];
  holeRevealed = false;
  hands: PlayerHand[] = [];
  active = 0;
  bankroll: number;
  roundNo = 0;
  events: GradedEvent[] = [];
  countCheckDue = false;
  askTcToo = false;
  shuffledLastRound = false;

  private countCheckPromptCount = 0;

  constructor(cfg: GameConfig) {
    this.cfg = cfg;
    this.shoe = new Shoe({ penetration: cfg.penetration, seed: cfg.seed });
    this.bankroll = cfg.bankrollStart;
  }

  static withRiggedShoe(cfg: GameConfig, cards: Card[]): Game {
    const game = new Game(cfg);
    game.shoe = makeRiggedShoe(cards, cfg.penetration);
    return game;
  }

  get trueCountNow(): number {
    return trueCount(this.runningCount, this.shoe.decksRemaining);
  }

  legalActions(): Action[] {
    if (this.phase !== 'player') return [];
    const hand = this.hands[this.active];
    if (!hand || hand.done) return [];
    const actions: Action[] = ['hit', 'stand'];
    if (hand.cards.length === 2 && !hand.doubled) actions.push('double');
    if (isPair(hand.cards) && this.hands.length < 4 && !hand.splitAces) actions.push('split');
    if (hand.cards.length === 2 && !hand.fromSplit) actions.push('surrender');
    return actions;
  }

  startRound(betUnits?: number): void {
    this.roundNo += 1;
    this.countCheckDue = false;

    if (this.shoe.cutCardReached) {
      this.shoe.shuffle();
      this.runningCount = 0;
      this.shuffledLastRound = true;
    } else {
      this.shuffledLastRound = false;
    }

    const preDealTc = this.trueCountNow;
    const bet = betUnits ?? 1;

    if (this.cfg.betSpreadOn) {
      const expectedUnits = spreadUnitsFor(preDealTc, this.cfg.spread);
      const correct = bet === expectedUnits;
      this.events.push({
        kind: 'bet',
        category: 'bet',
        correct,
        classification: correct ? 'correct' : 'basic-error',
        taken: String(bet),
        expected: String(expectedUnits),
        reason: `Spread bet at tc ${preDealTc}`,
        tc: preDealTc,
      });
    }

    this.dealerCards = [];
    this.holeRevealed = false;
    this.active = 0;
    this.hands = [
      {
        cards: [],
        bet,
        doubled: false,
        surrendered: false,
        fromSplit: false,
        splitAces: false,
        done: false,
      },
    ];

    // Deal order: P, D(up), P, D(hole)
    this.drawToHand(this.hands[0]);
    const up = this.shoe.draw();
    this.dealerCards.push(up);
    this.runningCount += hiLoTag(up.rank);
    this.drawToHand(this.hands[0]);
    const hole = this.shoe.draw();
    this.dealerCards.push(hole); // hidden: not counted yet

    if (up.rank === 'A') {
      this.phase = 'insurance';
      return;
    }

    if (isTenValueUp(up.rank) && isBlackjack(this.dealerCards)) {
      this.settleDealerBlackjack();
      return;
    }

    this.resolveAfterPeek();
  }

  insuranceDecision(take: boolean): void {
    const tc = this.trueCountNow;
    const advice = insuranceCorrect(tc);
    const correct = take === advice;
    const up = this.dealerCards[0].rank;
    this.events.push({
      kind: 'insurance',
      category: 'insurance',
      correct,
      classification: correct ? 'correct' : 'basic-error',
      taken: take ? 'take' : 'decline',
      expected: advice ? 'take' : 'decline',
      reason: `Insurance vs dealer ${up} at tc ${tc}`,
      tc,
      hand: `dealer ${up}`,
    });

    if (isBlackjack(this.dealerCards)) {
      this.settleDealerBlackjack();
    } else {
      this.resolveAfterPeek();
    }
  }

  act(action: Action): void {
    if (this.phase !== 'player') throw new Error('act() called outside player phase');
    if (!this.legalActions().includes(action)) throw new Error(`Illegal action: ${action}`);

    const hand = this.hands[this.active];
    const up = this.dealerCards[0].rank;
    const tc = this.trueCountNow;
    const ctx: PlayContext = {
      canDouble: hand.cards.length === 2 && !hand.doubled,
      canSplit: isPair(hand.cards) && this.hands.length < 4 && !hand.splitAces,
      canSurrender: hand.cards.length === 2 && !hand.fromSplit,
    };
    const withCount: Advice = correctPlay(hand.cards, up, tc, ctx);
    const basicOnly: Advice = basicPlay(hand.cards, up, ctx);
    const { classification, correct } = classifyAction(action, withCount, basicOnly, hand.cards, up, tc);
    const category = actionCategory(hand.cards, withCount.action);

    this.events.push({
      kind: 'action',
      category,
      correct,
      classification,
      taken: action,
      expected: withCount.action,
      reason: withCount.reason,
      deviationId: withCount.deviationId,
      tc,
      hand: describeHand(hand.cards, up),
    });

    switch (action) {
      case 'hit': {
        this.drawToHand(hand);
        if (isBust(hand.cards)) hand.done = true;
        break;
      }
      case 'stand': {
        hand.done = true;
        break;
      }
      case 'double': {
        hand.doubled = true;
        this.drawToHand(hand);
        hand.done = true;
        break;
      }
      case 'surrender': {
        hand.surrendered = true;
        hand.done = true;
        break;
      }
      case 'split': {
        this.performSplit(hand);
        break;
      }
    }

    this.advance();
  }

  submitCountCheck(
    rc: number,
    tcGuess?: number,
  ): { rcCorrect: boolean; actualRc: number; tcCorrect?: boolean; actualTc?: number } {
    const actualRc = this.runningCount;
    const rcCorrect = rc === actualRc;
    const tc = this.trueCountNow;
    this.events.push({
      kind: 'countCheck',
      category: 'countCheck',
      correct: rcCorrect,
      classification: rcCorrect ? 'correct' : 'basic-error',
      taken: String(rc),
      expected: String(actualRc),
      reason: 'Running count check',
      tc,
    });

    let tcCorrect: boolean | undefined;
    let actualTc: number | undefined;
    if (this.askTcToo) {
      actualTc = tc;
      tcCorrect = tcGuess === actualTc;
      this.events.push({
        kind: 'countCheck',
        category: 'countCheck',
        correct: tcCorrect,
        classification: tcCorrect ? 'correct' : 'basic-error',
        taken: tcGuess === undefined ? '' : String(tcGuess),
        expected: String(actualTc),
        reason: 'True count check',
        tc,
      });
    }

    this.countCheckDue = false;
    return { rcCorrect, actualRc, tcCorrect, actualTc };
  }

  // ---- internal helpers ----

  private drawToHand(hand: PlayerHand): void {
    const c = this.shoe.draw();
    hand.cards.push(c);
    this.runningCount += hiLoTag(c.rank);
  }

  private revealHole(): void {
    if (this.holeRevealed) return;
    this.holeRevealed = true;
    this.runningCount += hiLoTag(this.dealerCards[1].rank);
  }

  /** After the deal (and any peek that did not find dealer blackjack): settle
   * a player blackjack immediately, else move to the player's turn. */
  private resolveAfterPeek(): void {
    const hand = this.hands[0];
    if (isBlackjack(hand.cards)) {
      hand.result = 'blackjack';
      hand.net = 1.5 * hand.bet;
      this.bankroll += hand.net;
      this.finishRound();
      return;
    }
    this.phase = 'player';
  }

  private settleDealerBlackjack(): void {
    this.revealHole();
    for (const hand of this.hands) {
      if (isBlackjack(hand.cards)) {
        hand.result = 'push';
        hand.net = 0;
      } else {
        hand.result = 'lose';
        hand.net = -hand.bet;
      }
      this.bankroll += hand.net;
    }
    this.finishRound();
  }

  private performSplit(hand: PlayerHand): void {
    const isAces = hand.cards[0].rank === 'A';
    const secondCard = hand.cards[1];
    const newHand: PlayerHand = {
      cards: [secondCard],
      bet: hand.bet,
      doubled: false,
      surrendered: false,
      fromSplit: true,
      splitAces: isAces,
      done: false,
    };
    hand.cards = [hand.cards[0]];
    hand.fromSplit = true;
    hand.splitAces = isAces;

    this.hands.splice(this.active + 1, 0, newHand);

    this.drawToHand(hand);
    this.drawToHand(newHand);

    if (isAces) {
      hand.done = true;
      newHand.done = true;
    }
  }

  private advance(): void {
    const hand = this.hands[this.active];
    if (!hand.done) return;

    for (let i = this.active + 1; i < this.hands.length; i++) {
      if (!this.hands[i].done) {
        this.active = i;
        return;
      }
    }

    this.playDealerAndSettle();
  }

  private playDealerAndSettle(): void {
    this.revealHole();

    const liveHands = this.hands.filter((h) => !h.surrendered && !isBust(h.cards));
    if (liveHands.length > 0) {
      while (this.dealerShouldHit()) {
        const c = this.shoe.draw();
        this.dealerCards.push(c);
        this.runningCount += hiLoTag(c.rank);
      }
    }

    const dealerBust = isBust(this.dealerCards);
    const dealerTotal = handValue(this.dealerCards).total;

    for (const hand of this.hands) {
      if (hand.surrendered) {
        hand.result = 'surrender';
        hand.net = -0.5 * hand.bet;
      } else if (isBust(hand.cards)) {
        hand.result = 'lose';
        hand.net = -(hand.doubled ? 2 : 1) * hand.bet;
      } else if (dealerBust) {
        hand.result = 'win';
        hand.net = (hand.doubled ? 2 : 1) * hand.bet;
      } else {
        const playerTotal = handValue(hand.cards).total;
        if (playerTotal > dealerTotal) {
          hand.result = 'win';
          hand.net = (hand.doubled ? 2 : 1) * hand.bet;
        } else if (playerTotal < dealerTotal) {
          hand.result = 'lose';
          hand.net = -(hand.doubled ? 2 : 1) * hand.bet;
        } else {
          hand.result = 'push';
          hand.net = 0;
        }
      }
      this.bankroll += hand.net;
    }

    this.finishRound();
  }

  private dealerShouldHit(): boolean {
    const hv = handValue(this.dealerCards);
    if (hv.total < 17) return true;
    if (hv.total === 17 && hv.soft) return true; // hits soft 17
    return false;
  }

  private finishRound(): void {
    this.phase = 'settled';
    if (this.cfg.countCheckEvery > 0 && this.roundNo % this.cfg.countCheckEvery === 0) {
      this.countCheckDue = true;
      this.countCheckPromptCount += 1;
      this.askTcToo = this.countCheckPromptCount % 2 === 0;
    }
  }
}
