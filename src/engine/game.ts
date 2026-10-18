import { Shoe, rankValue, mulberry32 } from './cards';
import { makeRiggedShoe, botRngSeed, type RiggedShoe } from './riggedShoe';
import { betWithinStep } from './coverBets';
import { sitOutIsCorrect, spreadUnitsFor } from './wong';
import { cutCardsFor, cutRngSeed, usesCutCards } from './cut';
import { priceMistake } from './mistakeCost';
import { hotShoeOrder } from './shoeBias';
import type { Card, Rank } from './cards';
import { handValue, isBust, isBlackjack, isPair } from './hand';
import { hiLoTag, trueCount, tcWithinEye } from './count';
import type { TcRounding } from './count';
import { correctPlay, basicPlay, insuranceCorrect } from './strategy';
import type { PlayContext, Advice } from './strategy';
import { classifyAction, actionCategory, classifyInsurance } from './grade';
import type { GradedEvent } from './grade';
import type { Action } from './deviations';
import { DEFAULT_RULES } from './ruleset';
import type { StrategyRules } from './ruleset';
import {
  dealerErrorRate,
  dealerErrorSeed,
  rollDealerError,
  toDealerMistakesMode,
  EMPTY_DEALER_ERROR_TALLY,
  type DealerError,
  type DealerMistakesMode,
  type DealerErrorTally,
} from './dealerErrors';

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
  /** #39: decks left behind the cut, and whether each shoe moves it by up to
   * ±0.5 decks (see engine/cut.ts). With neither set the cut sits at
   * `penetration`, exactly as before. A rigged shoe ignores both. */
  cutDecks?: number;
  cutVary?: boolean;
  betSpreadOn: boolean;
  /** RT#11: accept a bet one spread rung either side of the expected size. */
  coverBets?: boolean;
  /** V5-4: the counter's true-count rounding convention; defaults to floor. */
  tcRounding?: TcRounding;
  spread: SpreadRow[];
  /** D-R1: sit out only at true count <= this (engine/wong.ts). Absent = -2. */
  wongExitTc?: number;
  bankrollStart: number; // units
  countCheckEvery: number; // rounds; 0 = off
  /** #3: what each count check asks for. Absent = 'alternate' (the running
   * count every time, the true count as well on every second check). */
  countCheckAsk?: CountCheckAsk;
  /** #34: grade plays with the count's index plays (correctPlay) or with
   * basic strategy alone (basicPlay). Insurance follows it: off, basic
   * strategy never insures. Absent = true. */
  gradeDeviations?: boolean;
  seed?: number;
  rules?: StrategyRules; // defaults to DEFAULT_RULES (v1's game); C1.13 wires this to the active profile
  seats?: SeatConfig; // defaults to DEFAULT_SEATS (v1 solo parity) when absent
  /**
   * Reveal the dealer's hole card even when no hand still needs a dealer
   * total -- the all-resolved case, which in practice means a solo natural.
   *
   * Defaults FALSE, which is faithful to heads-up play: the dealer pays the
   * natural and sweeps without exposing, so a counter never sees that card
   * and correctly never counts it. At a table with other players the dealer
   * does play on and the hole IS exposed, which is what this enables.
   *
   * Note the same effect already follows from seating bots: a live bot hand
   * keeps the round unresolved, so the dealer plays out and the hole is
   * revealed without this flag at all.
   */
  dealerAlwaysPlaysOut?: boolean;
  /** B8: deal from a Hot shoe (shoeBias.ts), biased toward positive counts.
   * Absent or false = the normal shoe. */
  hotShoe?: boolean;
  /** G2: the dealer makes the occasional payout error (engine/dealerErrors.ts).
   * Absent or false = never; true = 'occasional'. Wave I: 'training' errs
   * about one round in five. Can be changed between rounds with
   * `setDealerMistakes`. */
  dealerMistakes?: boolean | DealerMistakesMode;
  /** Test hook only: the stream dealer errors are rolled on. Absent = a
   * mulberry32 stream salted from `seed` (dealerErrorSeed), created the first
   * time a roll is needed. */
  dealerErrorRng?: () => number;
}

/** G2: what calling Foul came to. */
export interface FoulVerdict {
  /** True when there was an error to call. */
  correct: boolean;
  /** The error that was called, when there was one. */
  error: DealerError | null;
}

/** #3: what a Play count check asks. 'running' = RC only, 'true' = TC only,
 * 'alternate' = RC, plus the TC on every second check, 'both' = RC then TC on
 * every check. */
export type CountCheckAsk = 'running' | 'true' | 'alternate' | 'both';

export type Phase = 'idle' | 'insurance' | 'player' | 'settled';

/** One slot in a round's opening two-pass deal order (see `Game.dealOrder`).
 * `cardIndex` is which of the two opening cards this is -- never a hit/
 * double/split/settlement-draw card, all of which happen strictly after the
 * two-pass loop that populates this log has already finished. */
export type DealSlot =
  | { kind: 'player'; handIndex: number; cardIndex: 0 | 1 }
  | { kind: 'bot'; seatIndex: number; handIndex: number; cardIndex: 0 | 1 }
  | { kind: 'dealer'; cardIndex: 0 | 1 };

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

export { botRngSeed } from './riggedShoe';

/**
 * #1 split order: which hand this is IN PLAY ORDER, counting from 1.
 *
 * Hands are stored and rendered left to right, but a casino plays the hand on
 * the dealer's left -- the player's RIGHT -- first, so play runs from the
 * highest index down to 0. Because a split inserts the new hand immediately
 * right of the hand being split and plays it next, descending index IS the
 * order of play at every moment, and "hand 2" (on screen, in narration, in
 * the result list) always means the second hand played.
 */
export function handPlayNumber(handIndex: number, handCount: number): number {
  return handCount - handIndex;
}

/** Index of the hand to play now: the rightmost hand not yet done, or -1. All
 * hands right of it are already finished, by construction (see
 * handPlayNumber), so this is the whole of the play-order rule. */
function nextLiveHand(hands: PlayerHand[]): number {
  return hands.findLastIndex((h) => !h.done);
}

export class Game {
  readonly cfg: GameConfig;
  readonly rules: StrategyRules;
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
  /** Wave B, B6: player hands settled this game, splits counted separately; a sit-out adds none. Feeds the per-100 figure. */
  handsPlayed = 0;
  events: GradedEvent[] = [];
  /** A count check is OWED: set when a round settles on a check interval,
   * cleared by `submitCountCheck`. Owed is not asked -- see `countCheckOpen`. */
  countCheckDue = false;
  /** #36: the owed check has been POSED, which happens when the player asks
   * for the next deal (`poseCountCheck`), not when the round settles. The
   * settled hand stays on the felt while it is answered, and the deal follows
   * the answer. */
  countCheckOpen = false;
  /** #3: what the owed check asks, set as the round settles. `askRc` is false
   * only for a TC-only check; `askTcToo` is true whenever the true count is
   * asked (alone, or after the running count). */
  askRc = true;
  askTcToo = false;
  shuffledLastRound = false;
  insuranceNet: number | null = null;

  /** Seeded deterministic stream for bot-mistake substitution (Cycle-2 Task
   * 3). A single instance, held for the Game's whole lifetime, so replaying
   * the same seed + SeatConfig always substitutes the same mistakes at the
   * same decisions. Never Math.random.
   *
   * M6: DECORRELATED from the shoe. This used to be `mulberry32(cfg.seed)`,
   * the very same generator seeded with the very same number the Shoe was --
   * which is not "two streams from one seed", it is ONE stream drawn twice.
   * The Nth bot-mistake roll was literally the Nth number Fisher-Yates used to
   * arrange the deck, so who misplays and when was a deterministic function of
   * how the cards fell, and no seed existed that could vary one while holding
   * the other. See BOT_RNG_SALT. */
  private rng: () => number;

  /** UI pacing feed (Cycle-2 Task 3/6): one entry per bot decision, in the
   * order decided. Reset at the top of every startRound() -- represents
   * only the CURRENT round's bot actions. `card` is set for hit/double
   * (the card drawn); undefined for stand/surrender/split. */
  botActionLog: { seat: number; handIndex: number; action: Action; card?: Card }[] = [];

  /** Casino order of the CURRENT round's opening two-pass deal, one entry per
   * card in the exact order dealTwoPassRound() deals it: every seat in seat
   * order (first base first), each seat's hands rightmost first, for pass 1,
   * then the dealer's up-card, then the same sweep for pass 2, then the
   * dealer's hole card. Reset in beginRound().
   *
   * PRESENTATION-ONLY, read by Table.tsx to time the opening deal's CSS
   * entrance animation (Table Realism, Request B) -- grading, the running
   * count, and every phase transition are already fully decided by the time
   * this array exists, so a UI (or a test) that ignores it entirely sees the
   * exact same game state, at the exact same moment, it always has.
   *
   * A bot split during resolveBotsBefore() -- which runs AFTER this log is
   * fully populated, since it happens inside resolveAfterPeek(), which itself
   * only runs once the whole two-pass loop below has finished -- never
   * appends to or otherwise disturbs this log, so the opening deal's
   * animation timing can never be corrupted by what a bot decides to do next. */
  dealOrder: DealSlot[] = [];

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

  /** G2: dealer mistakes for rounds that settle from now on ('off' = none). */
  private dealerMistakesModeNow: DealerMistakesMode;
  /** G2: created on the first roll, so with the setting off nothing is drawn. */
  private dealerErrorRng: (() => number) | null = null;
  private readonly dealerErrorSeedBase: number;
  /** G2: the error this round settled with, or null. Cleared by the next deal. */
  dealerError: DealerError | null = null;
  /** G2: what Foul said about THIS round, or null while it has not been called. */
  foulVerdict: FoulVerdict | null = null;
  /** G2: the previous round's error, left uncalled -- graded missed as this
   * round was dealt. Null when there was none. */
  missedDealerError: DealerError | null = null;
  /** G2: this game's errors and calls. Kept apart from `events`: none of it
   * is a play decision, and it must not move play accuracy. */
  dealerErrorTally: DealerErrorTally = { ...EMPTY_DEALER_ERROR_TALLY };
  /** G2: some round settled with the setting on. */
  dealerMistakesUsed = false;
  /** Wave I: some round settled in Training mode (about one error in five). */
  dealerMistakesTrainingUsed = false;

  constructor(cfg: GameConfig) {
    this.cfg = cfg;
    this.rules = cfg.rules ?? DEFAULT_RULES;
    const cutSpec = {
      penetration: cfg.penetration,
      cutDecks: cfg.cutDecks,
      cutVary: cfg.cutVary,
      rules: { decks: this.rules.decks },
    };
    let cutCards: (() => number) | undefined;
    if (usesCutCards(cutSpec)) {
      // Its own seeded stream: placing the cut must not move a single card
      // of the shuffle, so a seed replays the same cards with or without it.
      const cutRng = mulberry32(cutRngSeed(cfg.seed ?? Date.now()));
      cutCards = () => cutCardsFor(cutSpec, cutRng);
    }
    this.shoe = new Shoe({ decks: this.rules.decks, penetration: cfg.penetration, seed: cfg.seed, cutCards,
      order: cfg.hotShoe ? hotShoeOrder : undefined });
    this.bankroll = cfg.bankrollStart;
    this.rng = mulberry32(botRngSeed(cfg.seed ?? Date.now()));
    this.dealerMistakesModeNow = toDealerMistakesMode(cfg.dealerMistakes);
    this.dealerErrorSeedBase = dealerErrorSeed(cfg.seed ?? Date.now());
  }

  /** G2: whether rounds that settle from now on can carry a dealer error. */
  get dealerMistakes(): boolean {
    return this.dealerMistakesModeNow !== 'off';
  }

  /** Wave I: which rate rounds that settle from now on roll at. */
  get dealerMistakesMode(): DealerMistakesMode {
    return this.dealerMistakesModeNow;
  }

  /** `true` is 'occasional' and `false` is 'off', as before Wave I. */
  setDealerMistakes(mode: boolean | DealerMistakesMode): void {
    this.dealerMistakesModeNow = toDealerMistakesMode(mode);
  }

  /** G2: Foul can be called now -- the round has settled with a hand of the
   * player's on the felt, and Foul has not been called on it yet. */
  get foulOpen(): boolean {
    return this.phase === 'settled' && this.hands.length > 0 && this.foulVerdict === null;
  }

  /**
   * G2: the player calls Foul on this round's payout.
   *
   * On an error it is graded right and the payout is put right: the hand gets
   * its correct result and net, and the bankroll gives back (or gets) the
   * difference. On a correct payout it is graded wrong. One call per round.
   * Returns null when no call can be made (see `foulOpen`).
   */
  callFoul(): FoulVerdict | null {
    if (!this.foulOpen) return null;
    const err = this.dealerError;
    if (err) {
      const hand = this.hands[err.handIndex];
      if (hand) {
        hand.result = err.correctResult;
        hand.net = err.correctNet;
      }
      this.bankroll += err.correctNet - err.paidNet;
      this.dealerErrorTally = { ...this.dealerErrorTally, caught: this.dealerErrorTally.caught + 1 };
      this.dealerError = null;
      this.foulVerdict = { correct: true, error: err };
    } else {
      this.dealerErrorTally = { ...this.dealerErrorTally, falseCalls: this.dealerErrorTally.falseCalls + 1 };
      this.foulVerdict = { correct: false, error: null };
    }
    return this.foulVerdict;
  }

  /**
   * G2: grade this round's uncalled error as missed. The next deal does this
   * (see beginRound); End calls it too, since no deal follows. Returns the
   * error that was missed, or null.
   */
  closeDealerError(): DealerError | null {
    const err = this.dealerError;
    this.dealerError = null;
    if (err) this.dealerErrorTally = { ...this.dealerErrorTally, missed: this.dealerErrorTally.missed + 1 };
    return err;
  }

  /** G2: roll this round's error, on the settled player hands. Only with the setting on. */
  private maybeMakeDealerError(): void {
    const mode = this.dealerMistakesModeNow;
    if (mode === 'off' || this.hands.length === 0) return;
    this.dealerMistakesUsed = true;
    if (mode === 'training') this.dealerMistakesTrainingUsed = true;
    this.dealerErrorRng ??= this.cfg.dealerErrorRng ?? mulberry32(this.dealerErrorSeedBase);
    const err = rollDealerError(this.hands, this.dealerErrorRng, dealerErrorRate(mode));
    if (!err) return;
    const hand = this.hands[err.handIndex]!;
    hand.result = err.paidResult;
    hand.net = err.paidNet;
    this.bankroll += err.paidNet - err.correctNet;
    this.dealerError = err;
    this.dealerErrorTally = { ...this.dealerErrorTally, made: this.dealerErrorTally.made + 1 };
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
    // `game.rules.decks` -- the SAME source line 234 gives the real `Shoe` --
    // so a count read off a rigged shoe is the count a player at that table
    // would compute, not one divided by the length of the script.
    game.shoe = makeRiggedShoe(cards, cfg.penetration, game.rules.decks);
    game.shoeIsRigged = true;
    return game;
  }

  /** True when this game deals from a rigged (scripted) shoe. */
  get isRigged(): boolean {
    return this.shoeIsRigged;
  }

  /**
   * Bin the next `n` cards of a RIGGED shoe without dealing them -- see
   * `RiggedShoe.discard`. They are never seen and never counted, so the running
   * count stays exactly what an honest player watching the table would have.
   *
   * Throws on a real shoe rather than silently doing nothing: burning cards out
   * of a live game would corrupt the count that everything else is graded
   * against, and a caller reaching for this on one has made a mistake worth
   * hearing about.
   */
  discardRiggedCards(n: number): void {
    if (!this.shoeIsRigged) {
      throw new Error('discardRiggedCards is only valid on a rigged shoe');
    }
    (this.shoe as unknown as RiggedShoe).discard(n);
  }

  get trueCountNow(): number {
    // V5-4: the profile's convention, not a hardcoded floor. Every grading
    // surface at the table reads this -- insurance, deviations, the bet ramp
    // and the wong decision -- so a counter whose system truncates was being
    // marked wrong on every negative-count index play.
    return trueCount(this.runningCount, this.shoe.decksRemaining, this.cfg.tcRounding);
  }

  /**
   * #41: decks left in the shoe, EXACT -- not the half-deck estimate the
   * graded true count divides by (see `trueCountNow`). The peek shows this to
   * two decimals, so it is measured from what has actually left the shoe.
   *
   * Counted from the ruleset's shoe size rather than `cardsRemaining`, which
   * for a rigged shoe is the length of a script (see riggedShoe.ts) and not
   * the shoe a player at that table would be looking at. For a real `Shoe`
   * the two are the same number.
   */
  get exactDecksRemaining(): number {
    return Math.max(0, this.rules.decks * 52 - this.shoe.cardsDealt) / 52;
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
      // F10: doubling a split hand needs the table to allow DAS.
      canDouble: hand.cards.length === 2 && !hand.doubled && !hand.splitAces && (!hand.fromSplit || this.rules.das),
      canSplit:
        isPair(hand.cards) &&
        this.countHandsWithOrigin(hands, hand.originIndex) < 4 &&
        (!hand.splitAces || this.rules.rsa),
      canSurrender: hand.cards.length === 2 && !hand.fromSplit && this.rules.ls,
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
   * The next round (staked or sat out) will shuffle before it deals: the cut
   * card is out, or the shoe is too shallow for a full round (see
   * beginRound). Read BETWEEN rounds so the table can say so before the bet
   * is placed -- the bet is then graded at the fresh shoe's count, which is
   * the count the player was told they were betting into (Wave A, s06).
   */
  get shuffleDue(): boolean {
    const totalHands = this.seatCfg.bots + this.seatCfg.playerHands;
    const needed = 4 * totalHands + 20;
    const tooShallow = !this.shoeIsRigged && this.shoe.cardsRemaining < needed;
    return this.shoe.cutCardReached || tooShallow;
  }

  /**
   * Round-start bookkeeping + the pre-deal depth/cut-card reshuffle guard,
   * shared by startRound (staked) and sitOut (wong-out). Extracted so a
   * sit-out round advances the shoe, cut card and running-count reset on
   * exactly the same terms a played round does -- the count you carry into
   * your next bet is real either way (R5, docs/BACKLOG.md).
   */
  private beginRound(): void {
    // G2: an error still standing when the next hand is dealt was missed.
    this.missedDealerError = this.closeDealerError();
    this.foulVerdict = null;
    this.roundNo += 1;
    this.countCheckDue = false;
    this.countCheckOpen = false;
    this.insuranceNet = null;
    this.botActionLog = [];
    this.dealOrder = [];

    // A full table can outrun the cut card. Reaching the cut card only
    // guarantees a handful of cards remain, but the deal alone consumes
    // 2 x (bots + playerHands) + 2, before any hits, splits or dealer draws --
    // so at deep penetration with 5 bots and 3 hands the shoe could empty
    // mid-round and `Shoe.draw()` would throw, blanking the whole React tree
    // and losing the session. Solo play never came close, which is why this
    // was unreachable before the seat model. The depth budget uses the seat's
    // configured playerHands even on a sit-out (conservative: a sit-out deals
    // strictly fewer cards, so a shoe deep enough for a full round is deep
    // enough to sit out).
    if (this.shuffleDue) {
      this.shoe.shuffle();
      this.runningCount = 0;
      this.shuffledLastRound = true;
    } else {
      this.shuffledLastRound = false;
    }
  }

  /** The play-or-sit line: one shared rule with the Bet or sit drill (engine/wong.ts). */
  private sitOutIsCorrect(tc: number): boolean {
    return sitOutIsCorrect(tc, this.cfg.spread, this.cfg.wongExitTc);
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

    this.beginRound();

    const preDealTc = this.trueCountNow;
    const betArray: number[] = Array.isArray(bets)
      ? bets
      : new Array(playerHandsCount).fill(bets ?? 1);

    if (this.cfg.betSpreadOn) {
      /**
       * C-R6: one round, one graded bet decision. When the ramp says sit out,
       * dealing in is the error and the stake size is moot -- only the
       * play-or-sit decision is graded (RV7's "wrong to be in the hand").
       * When the ramp says play and you did, the play-or-sit decision was
       * right by definition, so only the bet size is graded (one event per
       * hand, left to right, as Cycle-2 Task 4). Sitting out is graded in
       * sitOut(). Stored history is not migrated.
       */
      const shouldWong = this.sitOutIsCorrect(preDealTc);
      if (shouldWong) {
        this.events.push({
          source: 'table',
          kind: 'wong',
          category: 'wong',
          correct: false,
          classification: 'basic-error',
          taken: 'play',
          expected: 'sit-out',
          reason: `Wong decision at tc ${preDealTc}`,
          tc: preDealTc,
        });
      } else {
        const expectedUnits = spreadUnitsFor(preDealTc, this.cfg.spread);
        for (const bet of betArray) {
          // RT#11: with cover on, a bet one rung either side of the spread's
          // number is not an error -- see engine/coverBets.ts for why the
          // tolerance is a RUNG rather than a unit.
          const correct = this.cfg.coverBets
            ? betWithinStep(bet, expectedUnits, this.cfg.spread)
            : bet === expectedUnits;
          this.events.push({
            source: 'table',
            kind: 'bet',
            category: 'bet',
            correct,
            classification: correct ? 'correct' : 'basic-error',
            taken: String(bet),
            expected: String(expectedUnits),
            reason: this.cfg.coverBets
              ? `Spread bet at tc ${preDealTc} (cover: one rung either side)`
              : `Spread bet at tc ${preDealTc}`,
            tc: preDealTc,
          });
        }
      }
    }

    this.dealerCards = [];
    this.holeRevealed = false;
    this._active = 0;
    this.buildSeats(betArray);

    this.dealTwoPassRound();

    const upRank = this.dealerCards[0].rank;
    if (upRank === 'A') {
      this.phase = 'insurance';
      return;
    }

    if (isTenValueUp(upRank) && isBlackjack(this.dealerCards)) {
      this.settleDealerBlackjack();
      return;
    }

    this.resolveAfterPeek();
  }

  /**
   * Wong-out: sit this round out. The player stakes nothing and is dealt no
   * hand, but the round is still PLAYED (bots + dealer) so the running count
   * advances and the shoe's penetration burns exactly as a staked round would
   * -- the count carried into your next bet is real. Bankroll is untouched.
   *
   * The sit-out is graded as a wong decision against the pre-deal true count
   * (correct when `sitOutIsCorrect` -- at or below the Wong exit point,
   * D-R1), mirroring how startRound grades the bet, and only when
   * betSpreadOn (the wong decision is meaningless without a spread, same gate
   * bet grading uses). R5, docs/BACKLOG.md.
   *
   * With zero player hands the peek/settle path collapses cleanly: the deal
   * loops skip the empty player seat, resolveAfterPeek finds no live player
   * hand and hands straight to the dealer, and the settle loops over
   * `this.hands` (empty) never touch the bankroll -- only bots settle (for
   * display) and the dealer plays out to keep the count honest. A dealer Ace
   * never prompts insurance here: there is no stake to insure.
   */
  sitOut(): void {
    this.beginRound();

    const preDealTc = this.trueCountNow;
    if (this.cfg.betSpreadOn) {
      const correct = this.sitOutIsCorrect(preDealTc);
      this.events.push({
        source: 'table',
        kind: 'wong',
        category: 'wong',
        correct,
        classification: correct ? 'correct' : 'basic-error',
        taken: 'sit-out',
        expected: correct ? 'sit-out' : 'play',
        reason: `Wong decision at tc ${preDealTc}`,
        tc: preDealTc,
      });
    }

    this.dealerCards = [];
    this.holeRevealed = false;
    this._active = 0;
    this.buildSeats([]); // zero player hands; bot seats per the seat config

    this.dealTwoPassRound();

    const upRank = this.dealerCards[0].rank;
    // No player stake => no insurance step even on a dealer Ace. Peek for a
    // dealer natural directly: settle the bots against it, otherwise play the
    // round out (resolveAfterPeek -> dealer -> settle, all bankroll-neutral
    // for the sitting-out player).
    if ((upRank === 'A' || isTenValueUp(upRank)) && isBlackjack(this.dealerCards)) {
      this.settleDealerBlackjack();
      return;
    }
    this.resolveAfterPeek();
  }

  insuranceDecision(take: boolean): void {
    const tc = this.trueCountNow;
    // #34: without deviations, insurance is basic strategy's call -- never.
    const withIndex = this.cfg.gradeDeviations !== false;
    const advice = withIndex ? insuranceCorrect(tc, this.rules) : false;
    const { classification, correct } = withIndex
      ? classifyInsurance(take, tc, this.rules)
      : take
        ? ({ classification: 'basic-error', correct: false } as const)
        : ({ classification: 'correct', correct: true } as const);
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
      source: 'table',
      kind: 'insurance',
      category: 'insurance',
      correct,
      classification,
      taken: take ? 'take' : 'decline',
      expected: advice ? 'take' : 'decline',
      reason: `Insurance vs dealer ${up} at tc ${tc}`,
      // Only an index decision when indexes are being graded.
      ...(withIndex ? { deviationId: 'ins' as const } : {}),
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

  /**
   * `timing` (F5, W2-17) is measured by the CALLER -- this engine has no
   * clock. `elapsedMs` is how long the decision took (absent when it was not
   * measured or was idle time); `slow` tags a decision the dealer-pace clock
   * ran out on. Both land on the action event and nowhere else.
   */
  act(action: Action, timing?: { elapsedMs?: number; slow?: boolean }): void {
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
    const basicOnly: Advice = basicPlay(hand.cards, up, ctx, this.rules);
    // #34: with deviations off, the right play is basic strategy at every
    // count; correctPlay's index plays are never asked for.
    const withCount: Advice =
      this.cfg.gradeDeviations === false ? basicOnly : correctPlay(hand.cards, up, tc, ctx, this.rules);
    const { classification, correct, phantomOf } = classifyAction(action, withCount, basicOnly, hand.cards, up, tc, this.rules);
    const category = actionCategory(hand.cards, withCount.action);
    // #25: a basic error is priced, on the hand as it stood at the decision,
    // exactly as the hand drills price theirs.
    const evCost = priceMistake(hand.cards, up, ctx, this.rules, withCount, action, classification);

    this.events.push({
      source: 'table',
      kind: 'action',
      category,
      correct,
      classification,
      taken: action,
      expected: withCount.action,
      reason: withCount.reason,
      deviationId: withCount.deviationId,
      // E7: a phantom names the index it reached for, in its own field so the
      // event stays on its chart cell (see GradedEvent.phantomOf).
      ...(phantomOf === undefined ? {} : { phantomOf }),
      tc,
      hand: describeHand(hand.cards, up),
      ...(evCost === undefined ? {} : { evCost }),
      ...(timing?.elapsedMs === undefined ? {} : { elapsedMs: timing.elapsedMs }),
      ...(timing?.slow === true ? { slow: true as const } : {}),
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

  /**
   * Grade the owed count check. `rc` is the running-count answer; it is
   * ignored (pass null) when the check asks the true count only (`askRc`
   * false), and `tcGuess` is read only when the true count is asked
   * (`askTcToo`). `rcCorrect` is undefined when the running count was not
   * asked.
   */
  submitCountCheck(
    rc: number | null,
    tcGuess?: number,
  ): { rcCorrect?: boolean; actualRc: number; tcCorrect?: boolean; actualTc?: number } {
    const actualRc = this.runningCount;
    const tc = this.trueCountNow;
    let rcCorrect: boolean | undefined;
    if (this.askRc) {
      rcCorrect = rc === actualRc;
      this.events.push({
        source: 'table',
        kind: 'countCheck',
        category: 'countCheck',
        correct: rcCorrect,
        classification: rcCorrect ? 'correct' : 'basic-error',
        taken: rc === null ? '' : String(rc),
        expected: String(actualRc),
        reason: 'Running count check',
        tc,
      });
    }

    let tcCorrect: boolean | undefined;
    let actualTc: number | undefined;
    if (this.askTcToo) {
      actualTc = tc;
      // BY EYE, not to the digit. The running count is a fact the player
      // either kept or did not; the depth is a read off a tray, and a
      // half-deck misread is not a counting mistake (engine/count.ts's
      // `tcBand`). `expected` still carries the exact figure, so the
      // correction says what the shoe actually held.
      tcCorrect =
        tcGuess !== undefined &&
        // F7: the profile's rounding, as trueCountNow (the expected figure) uses.
        tcWithinEye(tcGuess, this.runningCount, this.shoe.decksRemaining, undefined, this.cfg.tcRounding);
      this.events.push({
        source: 'table',
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
    this.countCheckOpen = false;
    return { rcCorrect, actualRc, tcCorrect, actualTc };
  }

  /**
   * #36: the player asked for the next deal. If a count check is owed, pose
   * it now and return true -- the caller must collect the answer
   * (`submitCountCheck`) before dealing. Returns false when nothing is owed,
   * so the deal can go ahead. Idempotent while the check is open.
   *
   * Nothing moves between the settle and this call, so the count being
   * graded is exactly the one at the end of the round.
   */
  poseCountCheck(): boolean {
    if (!this.countCheckDue) return false;
    this.countCheckOpen = true;
    return true;
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

    // The player-hand count is driven by `bets.length`, not seatCfg.playerHands:
    // startRound always passes a bet-per-hand array of length playerHands (so
    // this is byte-identical to the old bound for every staked round), while a
    // wong-out sit-out passes [] to build a player seat with zero hands (R5).
    const playerHands: PlayerHand[] = [];
    for (let i = 0; i < bets.length; i++) {
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

  /** Deal the two-pass casino sequence -- one card to every hand of every seat
   * (in seat order; the player's own hands wherever they sit among them),
   * then the dealer's up-card; then the same seat sweep for card two, then
   * the dealer's hole card.
   *
   * A dealer deals from their own left -- the player's RIGHT -- so the sweep
   * runs right to left: seat 0 (first base) first, and within a seat the
   * rightmost hand first. That is also the order of play (#1, see
   * handPlayNumber), so the hand dealt first is the hand played first. Shared by startRound() and sitOut() so both a
   * staked round and a wong-out round burn the shoe/count in EXACTLY the same
   * order (R5, docs/BACKLOG.md) -- and now also so both populate `dealOrder`
   * (Table Realism, Request B) identically, rather than keeping two
   * hand-maintained copies of this loop in sync. Every card except the hole
   * is face-up, so runningCount updates immediately for bot cards too
   * (drawToHand does the counting). */
  private dealTwoPassRound(): void {
    for (let s = 0; s < this.seats.length; s++) {
      const seat = this.seats[s];
      const isPlayerSeat = s === this.playerSeatIndex;
      for (let h = seat.hands.length - 1; h >= 0; h--) {
        this.drawToHand(seat.hands[h]);
        this.dealOrder.push(
          isPlayerSeat
            ? { kind: 'player', handIndex: h, cardIndex: 0 }
            : { kind: 'bot', seatIndex: s, handIndex: h, cardIndex: 0 },
        );
      }
    }
    const up = this.shoe.draw();
    this.dealerCards.push(up);
    this.runningCount += hiLoTag(up.rank);
    this.dealOrder.push({ kind: 'dealer', cardIndex: 0 });

    for (let s = 0; s < this.seats.length; s++) {
      const seat = this.seats[s];
      const isPlayerSeat = s === this.playerSeatIndex;
      for (let h = seat.hands.length - 1; h >= 0; h--) {
        this.drawToHand(seat.hands[h]);
        this.dealOrder.push(
          isPlayerSeat
            ? { kind: 'player', handIndex: h, cardIndex: 1 }
            : { kind: 'bot', seatIndex: s, handIndex: h, cardIndex: 1 },
        );
      }
    }
    const hole = this.shoe.draw();
    this.dealerCards.push(hole); // hidden: not counted yet
    this.dealOrder.push({ kind: 'dealer', cardIndex: 1 });
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

  /** Resolve one bot seat's hands to completion in casino order (#1): the
   * rightmost live hand first, so a split's right-hand half is played before
   * its left -- the same rule as the player's own advance(). */
  private resolveBotSeat(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    const up = this.dealerCards[0].rank;
    for (let handIndex = nextLiveHand(seat.hands); handIndex !== -1; handIndex = nextLiveHand(seat.hands)) {
      this.playOneBotDecision(seatIndex, seat.hands, handIndex, up);
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
        // The new hand goes in at handIndex + 1, so every hand to its right
        // -- all already played, since play runs right to left (#1) -- moves
        // up one. Their logged entries move with them, or the table's paced
        // card reveal and bust lines would read the wrong hand.
        for (const e of this.botActionLog) {
          if (e.seat === seatIndex && e.handIndex > handIndex) e.handIndex += 1;
        }
        break;
      }
    }

    this.botActionLog.push({ seat: seatIndex, handIndex, action, card });
  }

  /** After the deal (and any peek that did not find dealer blackjack): seats
   * before the player (casino seat order) autoplay right away, then check
   * EVERY initial player hand for a natural blackjack. With multi-hand play,
   * one hand having a natural must not skip the others' turns: it settles
   * immediately (real casino timing) and play starts at the rightmost hand
   * that didn't (Cycle-2 Task 4, #1). No splits exist yet at this
   * point, so `this.hands` is exactly the round's initial hands. If any hand
   * has a natural, it is marked done with result 'blackjack' and bankroll
   * credited; the phase then moves to 'player' on the rightmost non-settled hand,
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

    // #1: play starts at the RIGHTMOST live hand (dealer's left) and moves
    // left. Naturals are already `done`, so they are skipped here.
    const firstLive = nextLiveHand(this.hands);
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

  /** Split `hands[index]` in place, inserting the new hand right after it
   * (immediately to its right on the felt, #1). The right-hand half is
   * played first, so it is also dealt its second card first. Generalized over an arbitrary hands array (not just `this.hands`/
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

    this.drawToHand(newHand);
    this.drawToHand(hand);

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
      // F19: at the cap, every split ace of this origin is finished. An open
      // A,A left of here can no longer resplit, and a split ace never takes a
      // second card, so it would be asked a play whose only legal answer is
      // Stand while being graded against Hit.
      if (atOriginCap) {
        for (const h of hands) {
          if (h.originIndex === hand.originIndex && h.splitAces) h.done = true;
        }
      }
    }
  }

  /** Move to the next hand in casino order (#1): the rightmost hand still
   * live. That is the current hand while it is open, the new right-hand half
   * straight after a split, and otherwise the next hand to the left. */
  private advance(): void {
    const next = nextLiveHand(this.hands);
    if (next !== -1) {
      this._active = next;
      return;
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
    // `dealerAlwaysPlaysOut` opts into the table-with-others behaviour: run
    // the dealer anyway so the hole is revealed and counted. It does NOT make
    // the dealer draw cards nobody needs -- playDealerAndSettle only draws
    // for live hands, and inventing draws would pull cards out of the shoe
    // that a real table never exposes, biasing the count the other way.
    if (!someHandUnresolved && !this.cfg.dealerAlwaysPlaysOut) {
      this.finishRound();
      return;
    }

    this.playDealerAndSettle();
  }

  /** Settle one hand against the already-played-out dealer. Pure: does not
   * touch bankroll (callers decide whether to, so bot hands can settle for
   * display without ever crediting/debiting the player's bankroll).
   *
   * Player naturals never reach this method: they are settled in
   * resolveAfterPeek() (before the dealer plays at all) and playDealerAndSettle's
   * caller filters on `result === undefined`, which already-settled naturals
   * fail -- so this natural check below can only ever fire for BOT hands
   * (code review M4). A hand with `fromSplit` reaching 21 on two cards is a
   * split-hand 21, not a natural, and must NOT pay blackjack odds -- same
   * rule resolveAfterPeek relies on implicitly (it only ever sees pre-split
   * hands). The dealer-natural branch below is defensive/unreachable in
   * practice: settleDealerBlackjack() already intercepts every seat's hands
   * the moment a dealer natural is peeked, before playDealerAndSettle (and
   * thus this method) ever runs. */
  private settleHandVsDealer(hand: PlayerHand, dealerBust: boolean, dealerTotal: number): void {
    if (hand.surrendered) {
      hand.result = 'surrender';
      hand.net = -0.5 * hand.bet;
    } else if (isBlackjack(hand.cards) && !hand.fromSplit) {
      const dealerNatural = this.dealerCards.length === 2 && isBlackjack(this.dealerCards);
      if (dealerNatural) {
        hand.result = 'push';
        hand.net = 0;
      } else {
        hand.result = 'blackjack';
        hand.net = (this.rules.bj65 ? 1.2 : 1.5) * hand.bet;
      }
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
    this.handsPlayed += this.hands.length;
    this.maybeMakeDealerError();
    this.phase = 'settled';
    if (this.cfg.countCheckEvery > 0 && this.roundNo % this.cfg.countCheckEvery === 0) {
      this.countCheckDue = true;
      this.countCheckPromptCount += 1;
      const ask = this.cfg.countCheckAsk ?? 'alternate';
      this.askRc = ask !== 'true';
      this.askTcToo =
        ask === 'true' || ask === 'both' || (ask === 'alternate' && this.countCheckPromptCount % 2 === 0);
    }
  }
}
