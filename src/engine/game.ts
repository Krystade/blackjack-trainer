import { Shoe, rankValue, mulberry32 } from './cards';
import type { Card, Rank } from './cards';
import { handValue, isBust, isBlackjack, isPair } from './hand';
import { hiLoTag, trueCount } from './count';
import { correctPlay, basicPlay, insuranceCorrect } from './strategy';
import type { PlayContext, Advice } from './strategy';
import { classifyAction, actionCategory, classifyInsurance } from './grade';
import type { GradedEvent } from './grade';
import type { Action } from './deviations';
import { DEFAULT_RULES } from './ruleset';
import type { RuleSet } from './ruleset';

export interface SeatConfig {
  playerHands: 1 | 2 | 3;
  bots: 0 | 1 | 2 | 3 | 4 | 5;
  botMistakePct: number;
  playerPosition: number;
}

export interface Seat {
  kind: 'player' | 'bot';
  hands: PlayerHand[];
}

/** Engine-owned default seating: solo player, no bots (v1 parity). Profile
 * storage (src/store/profiles.ts) imports this rather than owning its own
 * copy — the engine must not depend on src/store, but src/store may depend
 * on the engine. */
export const DEFAULT_SEATS: SeatConfig = {
  playerHands: 1,
  bots: 0,
  botMistakePct: 0,
  playerPosition: 0,
};

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
  rules?: RuleSet; // defaults to DEFAULT_RULES (v1's game); C1.13 wires this to the active profile
  seats?: SeatConfig; // defaults to DEFAULT_SEATS (v1 solo parity) when absent
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
  /** Index of the ORIGINAL player hand this hand descends from (Cycle-2 Task
   * 4: multi-hand player). A fresh hand's originIndex is its own position
   * among the round's initial `playerHands` hands (0, 1, 2, ...); a split
   * child inherits its parent's originIndex. The 4-hands-per-original-hand
   * casino split cap is enforced by counting hands that share an
   * originIndex, NOT by the seat's total hands.length -- so splitting one
   * original hand to its cap never blocks another original hand (dealt in
   * the same round) from splitting independently. */
  originIndex: number;
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

function freshHand(bet: number, originIndex: number): PlayerHand {
  return {
    cards: [],
    bet,
    doubled: false,
    surrendered: false,
    fromSplit: false,
    splitAces: false,
    done: false,
    originIndex,
  };
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
  readonly rules: RuleSet;
  phase: Phase = 'idle';
  shoe: Shoe;
  /** True only for `Game.withRiggedShoe`. A rigged shoe is a short, exactly
   * stacked card list, so the pre-deal depth guard must not "top it up" by
   * reshuffling -- that would destroy the very sequence the test stacked. */
  private shoeIsRigged = false;
  runningCount = 0;
  dealerCards: Card[] = [];
  holeRevealed = false;
  /** Casino seat order, index 0 = first base. Rebuilt each startRound() from
   * cfg.seats. The player's own seat lives at `playerSeatIndex`; `hands` and
   * `active` below are v1-API-compatible views over it. */
  seats: Seat[] = [{ kind: 'player', hands: [] }];
  private playerSeatIndex = 0;
  private _active = 0;
  bankroll: number;
  roundNo = 0;
  events: GradedEvent[] = [];
  countCheckDue = false;
  askTcToo = false;
  shuffledLastRound = false;
  insuranceNet: number | null = null;

  /** Seeded deterministic stream for bot-mistake substitution (Cycle-2 Task
   * 3). Same mulberry32 generator the Shoe itself is seeded with (see
   * Shoe's constructor in cards.ts) -- a single instance, held for the
   * Game's whole lifetime, so replaying the same seed + SeatConfig always
   * substitutes the same mistakes at the same decisions. Never Math.random. */
  private rng: () => number;

  /** UI pacing feed (Cycle-2 Task 3/6): one entry per bot decision, in the
   * order decided. Reset at the top of every startRound() -- represents
   * only the CURRENT round's bot actions. `card` is set for hit/double
   * (the card drawn); undefined for stand/surrender/split. */
  botActionLog: { seat: number; handIndex: number; action: Action; card?: Card }[] = [];

  /** Test/diagnostic hook only -- never set by production UI code. If
   * present, called synchronously right after each bot decision is
   * finalized (post mistake-substitution) with the exact hand snapshot,
   * dealer up, context, legal actions, and both the chart-correct and
   * actual action. Lets tests verify bot fidelity/mistakes against
   * `basicPlay` directly, without reconstructing hand state from
   * `botActionLog` (which is shaped for UI narration, not verification). */
  onBotDecision?: (info: {
    seat: number;
    handIndex: number;
    cardsBefore: Card[];
    dealerUp: Rank;
    ctx: PlayContext;
    legal: Action[];
    correctAction: Action;
    action: Action;
  }) => void;

  private countCheckPromptCount = 0;

  constructor(cfg: GameConfig) {
    this.cfg = cfg;
    this.rules = cfg.rules ?? DEFAULT_RULES;
    this.shoe = new Shoe({ decks: this.rules.decks, penetration: cfg.penetration, seed: cfg.seed });
    this.bankroll = cfg.bankrollStart;
    this.rng = mulberry32(cfg.seed ?? Date.now());
  }

  /** SeatConfig for this game (falls back to DEFAULT_SEATS, v1 solo parity). */
  private get seatCfg(): SeatConfig {
    return this.cfg.seats ?? DEFAULT_SEATS;
  }

  /** v1-compatible view: the player seat's hands (getter over `seats`, not a
   * separate array — mutations to the returned array, e.g. splice on split,
   * write straight through to the seat). */
  get hands(): PlayerHand[] {
    return this.seats[this.playerSeatIndex].hands;
  }

  /** v1-compatible view: index of the active hand within the player seat. */
  get active(): number {
    return this._active;
  }

  static withRiggedShoe(cfg: GameConfig, cards: Card[]): Game {
    const game = new Game(cfg);
    game.shoe = makeRiggedShoe(cards, cfg.penetration);
    game.shoeIsRigged = true;
    return game;
  }

  get trueCountNow(): number {
    return trueCount(this.runningCount, this.shoe.decksRemaining);
  }

  /** How many hands in `hands` share `originIndex` -- i.e. how many of the
   * (up to 4) casino-standard split slots for that ORIGINAL hand are already
   * in use. Used to cap splits per-origin rather than against the seat's
   * total hands.length, so one original hand's split chain never eats into
   * another original hand's own 4-hand budget (Cycle-2 Task 4). */
  private countHandsWithOrigin(hands: PlayerHand[], originIndex: number): number {
    return hands.filter((h) => h.originIndex === originIndex).length;
  }

  private handOptions(
    hand: PlayerHand,
    hands: PlayerHand[] = this.hands,
  ): { canHit: boolean; canDouble: boolean; canSplit: boolean; canSurrender: boolean } {
    return {
      canHit: !hand.splitAces,
      canDouble: hand.cards.length === 2 && !hand.doubled && !hand.splitAces,
      canSplit:
        isPair(hand.cards) &&
        this.countHandsWithOrigin(hands, hand.originIndex) < 4 &&
        (!hand.splitAces || this.rules.rsa),
      canSurrender: hand.cards.length === 2 && !hand.fromSplit,
    };
  }

  /** Legal actions for an arbitrary hand within its seat's hands array --
   * shared by the player's legalActions() and bot decision-making, so bots
   * get exactly the same canDouble/canSplit/canSurrender rules a real
   * basic-strategy player would (Cycle-2 Task 3). */
  private legalActionsForHand(hand: PlayerHand, hands: PlayerHand[]): Action[] {
    if (hand.done) return [];
    const options = this.handOptions(hand, hands);
    const actions: Action[] = ['stand'];
    if (options.canHit) actions.push('hit');
    if (options.canDouble) actions.push('double');
    if (options.canSplit) actions.push('split');
    if (options.canSurrender) actions.push('surrender');
    return actions;
  }

  legalActions(): Action[] {
    if (this.phase !== 'player') return [];
    const hand = this.hands[this.active];
    if (!hand || hand.done) return [];
    return this.legalActionsForHand(hand, this.hands);
  }

  /**
   * `bets` is one bet per player hand: an array (length = cfg.seats.playerHands)
   * grades and stakes each hand independently, or a scalar applies the same
   * bet to every hand (back-compat with v1/solo callers; also the default of
   * 1 unit when omitted). Cycle-2 Task 4.
   */
  startRound(bets?: number | number[]): void {
    const playerHandsCount = this.seatCfg.playerHands;

    // Validate BEFORE mutating anything. This check used to sit below the
    // round-number increment and the reshuffle, so a rejected call left the
    // Game wedged in a half-advanced state.
    if (Array.isArray(bets) && bets.length !== playerHandsCount) {
      throw new Error(`startRound: bets array length ${bets.length} does not match playerHands ${playerHandsCount}`);
    }

    this.roundNo += 1;
    this.countCheckDue = false;
    this.insuranceNet = null;
    this.botActionLog = [];

    // A full table can outrun the cut card. Reaching the cut card only
    // guarantees a handful of cards remain, but the deal alone consumes
    // 2 x (bots + playerHands) + 2, before any hits, splits or dealer draws --
    // so at deep penetration with 5 bots and 3 hands the shoe could empty
    // mid-round and `Shoe.draw()` would throw, blanking the whole React tree
    // and losing the session. Solo play never came close, which is why this
    // was unreachable before the seat model.
    const totalHands = this.seatCfg.bots + playerHandsCount;
    const needed = 4 * totalHands + 20;
    const tooShallow = !this.shoeIsRigged && this.shoe.cardsRemaining < needed;
    if (this.shoe.cutCardReached || tooShallow) {
      this.shoe.shuffle();
      this.runningCount = 0;
      this.shuffledLastRound = true;
    } else {
      this.shuffledLastRound = false;
    }

    const preDealTc = this.trueCountNow;
    const betArray: number[] = Array.isArray(bets)
      ? bets
      : new Array(playerHandsCount).fill(bets ?? 1);

    if (this.cfg.betSpreadOn) {
      const expectedUnits = spreadUnitsFor(preDealTc, this.cfg.spread);
      // One bet GradedEvent PER HAND, left to right -- each hand's own bet is
      // graded against the same pre-deal true count (Cycle-2 Task 4).
      for (const bet of betArray) {
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
    }

    this.dealerCards = [];
    this.holeRevealed = false;
    this._active = 0;
    this.buildSeats(betArray);

    // Two-pass casino deal in seat order (index 0 = first base): pass 1 deals
    // one card to each hand of every seat (bots included, in seat order;
    // within the player seat, its hands in order), then the dealer's
    // upcard; pass 2 deals a second card the same way, then the dealer's
    // hole card. Every card except the hole is face-up, so runningCount
    // updates immediately for bot cards too (drawToHand does the counting).
    for (const seat of this.seats) {
      for (const hand of seat.hands) {
        this.drawToHand(hand);
      }
    }
    const up = this.shoe.draw();
    this.dealerCards.push(up);
    this.runningCount += hiLoTag(up.rank);

    for (const seat of this.seats) {
      for (const hand of seat.hands) {
        this.drawToHand(hand);
      }
    }
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
    const { classification, correct } = classifyInsurance(take, tc);
    const up = this.dealerCards[0].rank;
    // Cycle-2 Task 5: ONE insurance decision covers every player hand. Stake
    // is the summed bet across all player hands (playerHands=1 reduces to
    // hands[0].bet, so the solo path is byte-identical to pre-Task-5
    // behavior). Pays 2:1 on that summed stake against dealer blackjack;
    // otherwise the whole stake is lost immediately and play continues.
    // Per-hand settlement (push on a player natural, lose on a non-natural)
    // still happens per-hand in settleDealerBlackjack() below -- this only
    // changes how much the insurance side bet itself is worth.
    const bet = this.hands.reduce((sum, h) => sum + h.bet, 0);
    this.events.push({
      kind: 'insurance',
      category: 'insurance',
      correct,
      classification,
      taken: take ? 'take' : 'decline',
      expected: advice ? 'take' : 'decline',
      reason: `Insurance vs dealer ${up} at tc ${tc}`,
      deviationId: 'ins',
      tc,
      hand: `dealer ${up}`,
    });

    const dealerHasBlackjack = isBlackjack(this.dealerCards);

    if (take) {
      // Stake bet/2 on insurance
      if (dealerHasBlackjack) {
        // Dealer has blackjack: insurance pays 2:1
        // Receive 2 × (bet/2) = bet
        this.insuranceNet = bet;
        this.bankroll += bet;
        this.settleDealerBlackjack();
      } else {
        // No dealer blackjack: lose the insurance stake immediately
        this.insuranceNet = -bet / 2;
        this.bankroll -= bet / 2;
        this.resolveAfterPeek();
      }
    } else {
      // Insurance declined
      this.insuranceNet = null;
      if (dealerHasBlackjack) {
        this.settleDealerBlackjack();
      } else {
        this.resolveAfterPeek();
      }
    }
  }

  act(action: Action): void {
    if (this.phase !== 'player') throw new Error('act() called outside player phase');
    if (!this.legalActions().includes(action)) throw new Error(`Illegal action: ${action}`);

    const hand = this.hands[this.active];
    const up = this.dealerCards[0].rank;
    const tc = this.trueCountNow;
    const options = this.handOptions(hand);
    const ctx: PlayContext = {
      canDouble: options.canDouble,
      canSplit: options.canSplit,
      canSurrender: options.canSurrender,
    };
    const withCount: Advice = correctPlay(hand.cards, up, tc, ctx, this.rules);
    const basicOnly: Advice = basicPlay(hand.cards, up, ctx, this.rules);
    const { classification, correct } = classifyAction(action, withCount, basicOnly, hand.cards, up, tc, this.rules);
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
        this.performSplit(this.hands, this.active);
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

  /** Construct this round's seats from cfg.seats: `bots` bot seats plus the
   * player seat (holding `playerHands` fresh hands) inserted at
   * clamp(playerPosition, 0, bots). Rebuilt every startRound() so seat count
   * can change between rounds if the config does.
   *
   * Bot seats autoplay to completion via resolveBotsBefore()/
   * resolveBotsAfter() at the correct casino-order point in the flow (see
   * resolveAfterPeek() and finishAfterPlayerDone()), then settle for
   * display in playDealerAndSettle()/settleDealerBlackjack() -- bots never
   * touch the bankroll (Cycle-2 Task 3). */
  private buildSeats(bets: number[]): void {
    const seatCfg = this.cfg.seats ?? DEFAULT_SEATS;
    const clampedPos = Math.min(Math.max(seatCfg.playerPosition, 0), seatCfg.bots);

    const seats: Seat[] = [];
    for (let i = 0; i < seatCfg.bots; i++) {
      seats.push({ kind: 'bot', hands: [freshHand(1, 0)] });
    }

    const playerHands: PlayerHand[] = [];
    for (let i = 0; i < seatCfg.playerHands; i++) {
      // originIndex = i: each dealt hand starts as its own origin group: any
      // splits made off of it inherit i, so its 4-hand cap never competes
      // with another original hand's budget (Cycle-2 Task 4).
      playerHands.push(freshHand(bets[i] ?? 1, i));
    }
    seats.splice(clampedPos, 0, { kind: 'player', hands: playerHands });

    this.seats = seats;
    this.playerSeatIndex = clampedPos;
  }

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

  /** Resolve every bot seat SEATED BEFORE the player, in seat order --
   * casino reality: first base plays before later seats, so a bot ahead of
   * the player acts right after the deal/peek, before the player's turn. */
  private resolveBotsBefore(): void {
    for (let i = 0; i < this.playerSeatIndex; i++) {
      this.resolveBotSeat(i);
    }
  }

  /** Resolve every bot seat SEATED AFTER the player, in seat order -- called
   * once the player's last hand is done, before the dealer plays. */
  private resolveBotsAfter(): void {
    for (let i = this.playerSeatIndex + 1; i < this.seats.length; i++) {
      this.resolveBotSeat(i);
    }
  }

  /** Resolve one bot seat's hands to completion, left to right, including
   * any hands created by splitting along the way (the for-loop's bound
   * re-reads seat.hands.length each iteration, so newly-inserted hands get
   * their own turn -- same pattern as the player's own advance()). */
  private resolveBotSeat(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    const up = this.dealerCards[0].rank;
    for (let handIndex = 0; handIndex < seat.hands.length; handIndex++) {
      const hand = seat.hands[handIndex];
      while (!hand.done) {
        this.playOneBotDecision(seatIndex, seat.hands, handIndex, up);
      }
    }
  }

  /** Make and apply exactly one bot decision on `hands[handIndex]`.
   * Count-blind: uses basicPlay (never correctPlay), mirroring the ctx a
   * real basic-strategy player would have (canDouble/canSplit/canSurrender
   * via the same handOptions() the player's own act() uses). With
   * probability botMistakePct/100 (rolled from the Game's seeded rng),
   * substitutes a uniformly-random OTHER legal action; never samples an
   * illegal action, and if no alternative exists (rare), plays correctly
   * anyway. Bots never insure and never produce GradedEvents -- this method
   * never touches `this.events`. */
  private playOneBotDecision(seatIndex: number, hands: PlayerHand[], handIndex: number, up: Rank): void {
    const hand = hands[handIndex];
    const cardsBefore = [...hand.cards];
    const options = this.handOptions(hand, hands);
    const ctx: PlayContext = {
      canDouble: options.canDouble,
      canSplit: options.canSplit,
      canSurrender: options.canSurrender,
    };
    const legal = this.legalActionsForHand(hand, hands);
    const correctAction = basicPlay(hand.cards, up, ctx, this.rules).action;

    let action: Action = correctAction;
    const mistakePct = this.seatCfg.botMistakePct;
    const isMistake = mistakePct > 0 && this.rng() * 100 < mistakePct;
    if (isMistake) {
      const alternatives = legal.filter((a) => a !== correctAction);
      if (alternatives.length > 0) {
        const idx = Math.floor(this.rng() * alternatives.length);
        action = alternatives[idx];
      }
    }

    this.onBotDecision?.({ seat: seatIndex, handIndex, cardsBefore, dealerUp: up, ctx, legal, correctAction, action });

    let card: Card | undefined;
    switch (action) {
      case 'hit': {
        this.drawToHand(hand);
        card = hand.cards[hand.cards.length - 1];
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
        card = hand.cards[hand.cards.length - 1];
        hand.done = true;
        break;
      }
      case 'surrender': {
        hand.surrendered = true;
        hand.done = true;
        break;
      }
      case 'split': {
        this.performSplit(hands, handIndex);
        break;
      }
    }

    this.botActionLog.push({ seat: seatIndex, handIndex, action, card });
  }

  /** After the deal (and any peek that did not find dealer blackjack): seats
   * before the player (casino seat order) autoplay right away, then check
   * EVERY initial player hand for a natural blackjack. With multi-hand play,
   * one hand having a natural must not skip the others' turns: it settles
   * immediately (real casino timing) and play proceeds left-to-right to the
   * first hand that didn't (Cycle-2 Task 4). No splits exist yet at this
   * point, so `this.hands` is exactly the round's initial hands. If any hand
   * has a natural, it is marked done with result 'blackjack' and bankroll
   * credited; the phase then moves to 'player' on the first non-settled hand,
   * or directly to settlement if all hands are naturals. */
  private resolveAfterPeek(): void {
    this.resolveBotsBefore();

    for (const hand of this.hands) {
      if (isBlackjack(hand.cards)) {
        hand.result = 'blackjack';
        hand.done = true;
        // BJ payout: 1.2x if rules.bj65 is true, 1.5x otherwise
        hand.net = (this.rules.bj65 ? 1.2 : 1.5) * hand.bet;
        this.bankroll += hand.net;
      }
    }

    const firstLive = this.hands.findIndex((h) => h.result === undefined);
    if (firstLive === -1) {
      this.finishAfterPlayerDone();
      return;
    }
    this._active = firstLive;
    this.phase = 'player';
  }

  /** Dealer peeked and has blackjack: the hand ends before anyone (bots
   * included) ever gets a turn -- real casino peek timing. Settles every
   * seat's hands directly against the dealer's natural; bots' net is
   * display-only (bankroll flows only from player hands). */
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
    for (const seat of this.seats) {
      if (seat.kind !== 'bot') continue;
      for (const hand of seat.hands) {
        if (isBlackjack(hand.cards)) {
          hand.result = 'push';
          hand.net = 0;
        } else {
          hand.result = 'lose';
          hand.net = -hand.bet;
        }
      }
    }
    this.finishRound();
  }

  /** Split `hands[index]` in place, inserting the new hand right after it.
   * Generalized over an arbitrary hands array (not just `this.hands`/
   * `this.active`) so bot seats can reuse the exact same split mechanics a
   * real player uses (Cycle-2 Task 3). */
  private performSplit(hands: PlayerHand[], index: number): void {
    const hand = hands[index];
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
      originIndex: hand.originIndex,
    };
    hand.cards = [hand.cards[0]];
    hand.fromSplit = true;
    hand.splitAces = isAces;

    hands.splice(index + 1, 0, newHand);

    this.drawToHand(hand);
    this.drawToHand(newHand);

    if (isAces) {
      // If RSA (resplit aces) is enabled, hands stay open if they draw an ace (forming A,A pair)
      // Otherwise, mark both hands done immediately
      const hand0HasAce = hand.cards[1].rank === 'A';
      const hand1HasAce = newHand.cards[1].rank === 'A';
      // Cap is per-origin (this original hand's own 4-hand budget), not the
      // seat's total hands.length (Cycle-2 Task 4).
      const atOriginCap = this.countHandsWithOrigin(hands, hand.originIndex) === 4;

      hand.done = !this.rules.rsa || !hand0HasAce || atOriginCap;
      newHand.done = !this.rules.rsa || !hand1HasAce || atOriginCap;
    }
  }

  private advance(): void {
    const hand = this.hands[this.active];
    if (!hand.done) return;

    for (let i = this.active + 1; i < this.hands.length; i++) {
      if (!this.hands[i].done) {
        this._active = i;
        return;
      }
    }

    this.finishAfterPlayerDone();
  }

  /** Casino seat order: once the player's last hand is done, seats after the
   * player autoplay, then the dealer plays out and everyone settles
   * (Cycle-2 Task 3). */
  private finishAfterPlayerDone(): void {
    this.resolveBotsAfter();

    // v1 PARITY (cycle-2 regression fix): if every hand at the table is
    // already resolved -- the all-naturals case -- the dealer never acts at
    // all. v1 short-circuited a player natural with `finishRound(); return;`
    // without ever entering playDealerAndSettle, so the hole card stayed
    // face-down and uncounted. Routing that case through the dealer would
    // leak the hole (and any draws) into the shoe position and the running
    // count, desynchronising every later round of a seeded session.
    //
    // Note this deliberately checks `result === undefined`, NOT "not bust":
    // a busted hand is still unresolved here (settleHandVsDealer assigns its
    // result), and v1 DID reveal the hole on a bust. Only already-settled
    // hands (naturals) can suppress the dealer.
    const someHandUnresolved = this.seats
      .flatMap((s) => s.hands)
      .some((h) => h.result === undefined);
    if (!someHandUnresolved) {
      this.finishRound();
      return;
    }

    this.playDealerAndSettle();
  }

  /** Settle one hand against the already-played-out dealer. Pure: does not
   * touch bankroll (callers decide whether to, so bot hands can settle for
   * display without ever crediting/debiting the player's bankroll). */
  private settleHandVsDealer(hand: PlayerHand, dealerBust: boolean, dealerTotal: number): void {
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
  }

  private playDealerAndSettle(): void {
    this.revealHole();

    // Whether the dealer needs to draw further depends on EVERY seat's
    // hands, not just the player's -- a live bot hand still needs a real
    // dealer result to settle and count, even if the player already busted.
    const allHands = this.seats.flatMap((s) => s.hands);
    // `result === undefined` excludes hands already settled as naturals: a
    // player blackjack needs no dealer total, so it must not drag the dealer
    // into drawing (e.g. player natural while every bot busted).
    const liveHands = allHands.filter(
      (h) => h.result === undefined && !h.surrendered && !isBust(h.cards),
    );
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
      if (hand.result === undefined) {
        this.settleHandVsDealer(hand, dealerBust, dealerTotal);
        this.bankroll += hand.net!;
      }
    }

    for (const seat of this.seats) {
      if (seat.kind !== 'bot') continue;
      for (const hand of seat.hands) {
        if (hand.result === undefined) {
          this.settleHandVsDealer(hand, dealerBust, dealerTotal);
          // bots' net is display-only; bankroll flows only from player hands.
        }
      }
    }

    this.finishRound();
  }

  private dealerShouldHit(): boolean {
    const hv = handValue(this.dealerCards);
    if (hv.total < 17) return true;
    if (hv.total === 17 && hv.soft && !this.rules.s17) return true; // hits soft 17 unless rules say stand
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
