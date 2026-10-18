/**
 * Wave G, G2 (L-8): the dealer's mistakes, and the player's "Foul" call.
 *
 * A real dealer pays thousands of hands a shift and gets some wrong. A counter
 * who only ever watches the count misses them, and a missed overpay is money
 * the house takes back on the next audit while a missed underpay is money
 * simply lost. With the Play setting "Dealer mistakes" on, about one round in
 * thirty settles with ONE realistic error on one of the player's hands:
 *
 *   - overpay:   a winning hand is paid one unit too much,
 *   - underpay:  a winning hand is paid one unit too little (only where the
 *                correct payout is more than one unit, so the hand is still
 *                paid -- a 1-unit win paid nothing is "took the win" instead),
 *   - pay-push:  a push is paid as a win,
 *   - take-win:  a winning hand is swept as a loss.
 *
 * The hand then SHOWS what the dealer paid -- its result and net are the paid
 * ones, and the bankroll moves by them -- because that is what a player sees on
 * the felt; the round banner's totals ("You 19 · Dealer 18") are how the error
 * is spotted. Calling Foul on an error restores the correct payout.
 *
 * The roll runs on its OWN seeded stream (salted from the game seed, like the
 * bot-mistake and cut-card streams) and only when the setting is on, so every
 * existing seed deals exactly the cards it always did.
 */
import type { PlayerHand } from './game';

export type DealerErrorKind = 'overpay' | 'underpay' | 'pay-push' | 'take-win';

/** One dealer error, made on one of the player's hands as the round settled. */
export interface DealerError {
  /** Index into the player's `hands` (storage order, as `Game.hands`). */
  handIndex: number;
  kind: DealerErrorKind;
  correctResult: NonNullable<PlayerHand['result']>;
  correctNet: number;
  paidResult: NonNullable<PlayerHand['result']>;
  paidNet: number;
}

/** A session's tally. `made` counts every error dealt, called or not. */
export interface DealerErrorTally {
  made: number;
  caught: number;
  missed: number;
  falseCalls: number;
}

export const EMPTY_DEALER_ERROR_TALLY: DealerErrorTally = { made: 0, caught: 0, missed: 0, falseCalls: 0 };

/**
 * The chance of an error on a round that HAS a hand one could be made on (a
 * win, a blackjack or a push). Roughly half of all rounds have one, so this
 * lands near one error in thirty rounds overall -- see the rate test in
 * dealerErrors.test.ts, which measures it over simulated play.
 */
export const DEALER_ERROR_RATE = 1 / 15;

/**
 * Wave I: how often the dealer errs. 'occasional' is G2's rate (about one
 * round in thirty, for a session whose main work is something else);
 * 'training' is for a session spent on catching them -- about one round in
 * five, by the same per-eligible-round reasoning (rate test in
 * dealerErrors.test.ts). 'off' never rolls.
 */
export type DealerMistakesMode = 'off' | 'occasional' | 'training';

export const DEALER_ERROR_TRAINING_RATE = 2 / 5;

/** A config value as a mode: true is 'occasional' (G2's only rate), anything else unknown is 'off'. */
export function toDealerMistakesMode(v: unknown): DealerMistakesMode {
  if (v === 'occasional' || v === 'training') return v;
  return v === true ? 'occasional' : 'off';
}

/** The per-eligible-round chance for a mode that rolls. */
export function dealerErrorRate(mode: Exclude<DealerMistakesMode, 'off'>): number {
  return mode === 'training' ? DEALER_ERROR_TRAINING_RATE : DEALER_ERROR_RATE;
}

/** Different from the bot (0x9e3779b9) and cut-card (0x85ebca6b) salts. */
const DEALER_ERROR_SALT = 0xc2b2ae35;

export function dealerErrorSeed(gameSeed: number): number {
  return (gameSeed ^ DEALER_ERROR_SALT) >>> 0;
}

/** What is riding on the hand: twice the bet once doubled. */
function stake(hand: Pick<PlayerHand, 'bet' | 'doubled'>): number {
  return hand.doubled ? hand.bet * 2 : hand.bet;
}

/** The errors a dealer could plausibly make on this settled hand. */
export function errorKindsFor(hand: Pick<PlayerHand, 'result' | 'net' | 'bet' | 'doubled'>): DealerErrorKind[] {
  const net = hand.net ?? 0;
  if (hand.result === 'win' || hand.result === 'blackjack') {
    return net > 1 ? ['overpay', 'underpay', 'take-win'] : ['overpay', 'take-win'];
  }
  if (hand.result === 'push') return ['pay-push'];
  return [];
}

/** The payout the dealer makes instead of the right one. */
export function erroneousPayout(
  hand: Pick<PlayerHand, 'result' | 'net' | 'bet' | 'doubled'>,
  kind: DealerErrorKind,
): { result: NonNullable<PlayerHand['result']>; net: number } {
  const net = hand.net ?? 0;
  switch (kind) {
    case 'overpay':
      return { result: hand.result!, net: net + 1 };
    case 'underpay':
      return { result: hand.result!, net: net - 1 };
    case 'pay-push':
      return { result: 'win', net: stake(hand) };
    case 'take-win':
      return { result: 'lose', net: -stake(hand) };
  }
}

/**
 * Roll for this round's error. `hands` are the player's settled hands. Draws
 * from `rng` only when some hand is eligible: once for the roll (an error when
 * it is under `rate`), and -- when it hits -- once for which hand and once for
 * which error.
 */
export function rollDealerError(
  hands: readonly PlayerHand[],
  rng: () => number,
  rate: number = DEALER_ERROR_RATE,
): DealerError | null {
  const eligible = hands
    .map((h, i) => ({ h, i, kinds: errorKindsFor(h) }))
    .filter((e) => e.kinds.length > 0);
  if (eligible.length === 0) return null;
  if (rng() >= rate) return null;
  const pick = eligible[Math.min(eligible.length - 1, Math.floor(rng() * eligible.length))]!;
  const kind = pick.kinds[Math.min(pick.kinds.length - 1, Math.floor(rng() * pick.kinds.length))]!;
  return makeDealerError(pick.h, pick.i, kind);
}

/** The error `kind` on `hand`, with both payouts spelled out. */
export function makeDealerError(hand: PlayerHand, handIndex: number, kind: DealerErrorKind): DealerError {
  const paid = erroneousPayout(hand, kind);
  return {
    handIndex,
    kind,
    correctResult: hand.result!,
    correctNet: hand.net ?? 0,
    paidResult: paid.result,
    paidNet: paid.net,
  };
}
