/**
 * Wave L: what each play is worth in Free Bet, Spanish 21 and Blackjack Switch.
 *
 * The variant layer over the app's infinite-deck EV machinery (dealerOdds.ts,
 * handEv.ts). Same assumptions, same reasons -- read dealerOdds.ts's header --
 * generalised in the four places the variants need:
 *
 *  1. THE DECK. A Spanish deck has no tens: A-9 are 1/12 each and the J/Q/K
 *     are 3/12, instead of 1/13 and 4/13. `drawWeights` is the only place this
 *     lives; the dealer and the player both draw from it.
 *  2. THE DEALER'S 22. Free Bet and Switch push a dealer 22 against every
 *     standing hand, so the dealer's distribution keeps 22 apart from 23+.
 *  3. THE STAKE. A Free Bet hand may hold a free-bet token instead of money
 *     (a push or a loss on it costs nothing, a win pays), and a free double
 *     adds a token, not a chip. Every hand state carries (W, L): what a win
 *     pays and what a loss costs, in units of the original bet. A real hand is
 *     (1, 1), a free hand (1, 0), a free-doubled real hand (2, 1).
 *  4. THE CARD COUNT. Spanish 21 pays 3:2 / 2:1 / 3:1 for a 5 / 6 / 7+-card 21
 *     and 3:2 / 2:1 / 3:1 for a mixed / suited / spaded 6-7-8 or 7-7-7, and a
 *     player 21 always wins. So the state carries the number of cards and,
 *     for a two-card 6-7 / 6-8 / 7-8 / 7-7, which card would complete the set
 *     and how its suits stand. Suits are independent and uniform (infinite
 *     deck), so a suited pair's third card matches with probability 1/4.
 *
 * INFINITE DECK, stated: every draw is with replacement. That is an
 * approximation for a 6- or 8-deck shoe, and published.ts records every cell
 * where the Wizard of Odds' finite-deck chart disagrees and why.
 *
 * SPLITS ARE EXACT here (unlike handEv.ts): `splitEv` walks the resplit chain
 * hand by hand (play the first hand out, including its own resplits, before
 * the next), up to the table's hand limit, always resplitting when allowed.
 * That is what Free Bet needs: every hand a free split creates is a free hand,
 * and the first hand stays the real one.
 *
 * ASSUMPTIONS that are rules, not maths, all written down here:
 *  - The player stands on any 21 (no fishing for a five-card 21 from a soft 21).
 *  - Spanish 21 bonuses are not paid after a split (most casinos; the Wizard
 *    puts the difference at about 0.01%) or after a double (every casino).
 *  - The Spanish 21 Super Bonus (suited 7-7-7 v a dealer 7, a dollar amount
 *    rather than odds) and envy bonus are not modelled.
 *  - Rescue gives up half the hand's current stake: the original bet after one
 *    double, which is how the Wizard words the rule.
 *  - A redouble ("double double down") doubles the whole stake again, up to
 *    `maxDoubles` doubles on one hand.
 *
 * Pure: no React, no store, no randomness.
 */

import type { VariantRules } from './rules';

export interface Draw {
  /** 2-10, or 11 for an ace. */
  value: number;
  p: number;
}

/** Infinite-deck draw weights for a regular or a Spanish deck. */
export function drawWeights(spanish: boolean): Draw[] {
  const one = spanish ? 1 / 12 : 1 / 13;
  const ten = spanish ? 3 / 12 : 4 / 13;
  return [
    { value: 11, p: one },
    { value: 2, p: one },
    { value: 3, p: one },
    { value: 4, p: one },
    { value: 5, p: one },
    { value: 6, p: one },
    { value: 7, p: one },
    { value: 8, p: one },
    { value: 9, p: one },
    { value: 10, p: ten },
  ];
}

/** P(the next card is worth `value`). */
export function drawP(rules: VariantRules, value: number): number {
  return drawWeights(rules.spanishDeck).find((d) => d.value === value)!.p;
}

/* ---------------------------------------------------------------- */
/* The dealer                                                        */
/* ---------------------------------------------------------------- */

/** Final-total buckets: 17, 18, 19, 20, 21, 22, 23+. */
export type DealerDist = [number, number, number, number, number, number, number];

const EMPTY: DealerDist = [0, 0, 0, 0, 0, 0, 0];

function addInto(into: number[], from: readonly number[], w: number): void {
  for (let i = 0; i < into.length; i++) into[i]! += from[i]! * w;
}

function dealerFinal(
  total: number,
  soft: boolean,
  h17: boolean,
  draw: Draw[],
  cache: Map<string, DealerDist>,
): DealerDist {
  if (total > 21) {
    const out = [...EMPTY] as DealerDist;
    out[total === 22 ? 5 : 6] = 1;
    return out;
  }
  if (total >= 17 && !(h17 && soft && total === 17)) {
    const out = [...EMPTY] as DealerDist;
    out[total - 17] = 1;
    return out;
  }
  const key = `${total}${soft ? 's' : 'h'}`;
  const seen = cache.get(key);
  if (seen) return seen;
  const out = [...EMPTY] as DealerDist;
  for (const card of draw) {
    const next = afterDraw(total, soft, card.value);
    addInto(out, dealerFinal(next.total, next.soft, h17, draw, cache), card.p);
  }
  cache.set(key, out);
  return out;
}

export interface VariantDealer {
  /** How the dealer finishes, given the peek found no natural. Sums to 1. */
  dist: DealerDist;
  /** P(the dealer has a natural) before the peek: 0 unless an ace or ten shows. */
  pNatural: number;
}

/** The dealer's outcome distribution for an up card (2-11), after the peek. */
export function variantDealer(upValue: number, rules: VariantRules): VariantDealer {
  const draw = drawWeights(rules.spanishDeck);
  const cache = new Map<string, DealerDist>();
  const out = [...EMPTY] as DealerDist;
  let pNatural = 0;
  let live = 0;
  for (const hole of draw) {
    if ((upValue === 11 && hole.value === 10) || (upValue === 10 && hole.value === 11)) {
      pNatural += hole.p;
      continue;
    }
    let total = upValue + hole.value;
    let soft = upValue === 11 || hole.value === 11;
    if (total > 21) {
      total -= 10;
      soft = true;
    }
    addInto(out, dealerFinal(total, soft, !rules.s17, draw, cache), hole.p);
    live += hole.p;
  }
  for (let i = 0; i < 7; i++) out[i]! /= live;
  return { dist: out, pNatural };
}

/* ---------------------------------------------------------------- */
/* The player                                                        */
/* ---------------------------------------------------------------- */

export function afterDraw(total: number, soft: boolean, card: number): { total: number; soft: boolean } {
  let next = total + card;
  // Aces still counted as 11: the soft hand's one, plus the card if an ace.
  // Two of them (soft 21 drawing an ace: 32) take two steps down, to hard 12
  // -- one step left a "soft 22" (review N8).
  let elevens = (soft ? 1 : 0) + (card === 11 ? 1 : 0);
  while (next > 21 && elevens > 0) {
    next -= 10;
    elevens -= 1;
  }
  return { total: next, soft: elevens > 0 };
}

/**
 * The Spanish 21 6-7-8 / 7-7-7 track of a two-card hand.
 *  - '' : no bonus possible.
 *  - 'c<need><suit>' : one more card worth `need` makes the set; suit is
 *    m (mixed), s (suited, not spades) or p (both spades).
 *  - 'w<mult>' : the set is made; a 21 paying `mult` times the bet.
 */
export type Track = string;
export type SuitState = 'm' | 's' | 'p';

/** Expected multiplier when the completing card lands, given the first two cards' suits. */
function setMultiplier(suit: SuitState): number {
  // Mixed pays 3:2, suited 2:1, spades 3:1. The third card matches the first
  // two's suit with probability 1/4.
  if (suit === 'm') return 1.5;
  if (suit === 's') return 0.25 * 2 + 0.75 * 1.5;
  return 0.25 * 3 + 0.75 * 1.5;
}

/**
 * The set-bonus track for two cards, or '' when they cannot start a 6-7-8 or
 * 7-7-7. Values are card values (11 = ace).
 */
export function trackFor(v1: number, v2: number, suit: SuitState): Track {
  const pair = [v1, v2].sort((a, b) => a - b).join(',');
  const need: Record<string, number> = { '6,7': 8, '6,8': 7, '7,8': 6, '7,7': 7 };
  const n = need[pair];
  return n === undefined ? '' : `c${n}${suit}`;
}

export interface HandState {
  total: number;
  soft: boolean;
  /** Cards in the hand. */
  n: number;
  track: Track;
  /** What a win pays and a loss costs, in original-bet units. */
  W: number;
  L: number;
  /** Doubles already made on this hand. */
  doubles: number;
  /** Just doubled: the only choices are stand, rescue and redouble. */
  postDouble: boolean;
  /** The hand came from a split: DAS applies, no surrender, no card bonus. */
  split: boolean;
  /** A split ace that may not draw: it stands on whatever its card made. */
  lockedAce: boolean;
  canSurrender: boolean;
  /** Free Bet: a free double is on offer (two-card hard 9-11). */
  freeDouble: boolean;
}

/** Plays a hand state can be valued for. FD/FP are Free Bet's free double / split. */
export type VAct = 'H' | 'S' | 'D' | 'FD' | 'P' | 'FP' | 'R';

export type ActionValues = Partial<Record<VAct, number>>;

/** Everything that stays fixed while one up card's hands are valued. */
export interface EvTable {
  rules: VariantRules;
  upValue: number;
  dealer: VariantDealer;
  draw: Draw[];
  cache: Map<string, number>;
  splitCache: Map<string, number>;
}

export function evTable(rules: VariantRules, upValue: number): EvTable {
  return {
    rules,
    upValue,
    dealer: variantDealer(upValue, rules),
    draw: drawWeights(rules.spanishDeck),
    cache: new Map(),
    splitCache: new Map(),
  };
}

/** P(win) and P(lose) for standing on `total` (<= 21) against the dealer. */
export function standOdds(total: number, t: EvTable): { win: number; lose: number } {
  const d = t.dealer.dist;
  let win = d[6] + (t.rules.dealer22Push ? 0 : d[5]);
  let lose = 0;
  for (let i = 0; i < 5; i++) {
    const dealerTotal = 17 + i;
    if (total > dealerTotal) win += d[i]!;
    else if (total < dealerTotal) lose += d[i]!;
  }
  return { win, lose };
}

function bonusOn(s: HandState, t: EvTable): boolean {
  return t.rules.cardBonuses && (!s.split || t.rules.bonusAfterSplit === true) && s.doubles === 0;
}

export function standValue(s: HandState, t: EvTable): number {
  if (s.total > 21) return -s.L;
  if (t.rules.player21Wins && s.total === 21) {
    let mult = 1;
    if (bonusOn(s, t)) {
      if (s.track.startsWith('w')) mult = Number(s.track.slice(1));
      else if (s.n >= 7) mult = 3;
      else if (s.n === 6) mult = 2;
      else if (s.n === 5) mult = 1.5;
    }
    return s.W * mult;
  }
  const { win, lose } = standOdds(s.total, t);
  return s.W * win - s.L * lose;
}

function stateKey(s: HandState, t: EvTable): string {
  // Card count only matters for the first-two-card options and, in Spanish
  // 21, for the bonuses -- capping it keeps the memo small.
  const n = t.rules.cardBonuses ? Math.min(s.n, 7) : Math.min(s.n, 3);
  return [
    s.total,
    s.soft ? 1 : 0,
    n,
    s.track,
    s.W,
    s.L,
    s.doubles,
    s.postDouble ? 1 : 0,
    s.split ? 1 : 0,
    s.lockedAce ? 1 : 0,
    s.canSurrender ? 1 : 0,
    s.freeDouble ? 1 : 0,
  ].join('|');
}

function canDoubleNow(s: HandState, t: EvTable): boolean {
  if (s.postDouble || s.doubles > 0 || s.lockedAce) return false;
  if (s.n !== 2 && !t.rules.doubleAnyCards) return false;
  return !s.split || t.rules.das;
}

/** The state after drawing `card` as a hit. */
function hitState(s: HandState, card: number): HandState {
  const next = afterDraw(s.total, s.soft, card);
  let track: Track = '';
  if (s.n === 2 && s.track.startsWith('c') && Number(s.track.slice(1, -1)) === card && next.total === 21) {
    track = `w${setMultiplier(s.track.slice(-1) as SuitState)}`;
  }
  return {
    ...s,
    total: next.total,
    soft: next.soft,
    n: s.n + 1,
    track,
    canSurrender: false,
    freeDouble: false,
  };
}

/** Value of doubling (real money, a free token, or a redouble), card by card. */
function doubleValue(s: HandState, kind: 'real' | 'free' | 'redouble', t: EvTable): number {
  const W = kind === 'redouble' ? s.W * 2 : s.W + 1;
  const L = kind === 'redouble' ? s.L * 2 : kind === 'free' ? s.L : s.L + 1;
  let ev = 0;
  for (const card of t.draw) {
    const next = afterDraw(s.total, s.soft, card.value);
    const after: HandState = {
      ...s,
      total: next.total,
      soft: next.soft,
      n: s.n + 1,
      track: '',
      W,
      L,
      doubles: s.doubles + 1,
      postDouble: true,
      canSurrender: false,
      freeDouble: false,
    };
    ev += card.p * bestValue(after, t);
  }
  return ev;
}

/** Every play open to this hand state (not splitting) and its value. */
export function actionValues(s: HandState, t: EvTable): ActionValues {
  const rules = t.rules;
  if (s.total > 21) return { S: -s.L };
  const out: ActionValues = { S: standValue(s, t) };
  if (s.postDouble) {
    if (rules.rescue) out.R = -s.L / 2;
    if (s.doubles < rules.maxDoubles) out.D = doubleValue(s, 'redouble', t);
    return out;
  }
  // A locked split ace stands; and nobody hits a 21.
  if (s.lockedAce || s.total === 21) return out;
  let hit = 0;
  for (const card of t.draw) hit += card.p * bestValue(hitState(s, card.value), t);
  out.H = hit;
  if (canDoubleNow(s, t)) out.D = doubleValue(s, 'real', t);
  if (s.freeDouble) out.FD = doubleValue(s, 'free', t);
  if (s.canSurrender) out.R = -s.L / 2;
  return out;
}

export function bestValue(s: HandState, t: EvTable): number {
  if (s.total > 21) return -s.L;
  const key = stateKey(s, t);
  const seen = t.cache.get(key);
  if (seen !== undefined) return seen;
  const vals = actionValues(s, t);
  let best = -Infinity;
  for (const v of Object.values(vals)) if (v !== undefined && v > best) best = v;
  t.cache.set(key, best);
  return best;
}

export type StakeType = 'real' | 'free';

const STAKE: Record<StakeType, { W: number; L: number }> = {
  real: { W: 1, L: 1 },
  free: { W: 1, L: 0 },
};

/** Two-card total of two card values (11 = ace). */
export function twoCardTotal(v1: number, v2: number): { total: number; soft: boolean } {
  let total = v1 + v2;
  let soft = v1 === 11 || v2 === 11;
  if (total > 21) {
    total -= 10;
    soft = true;
  }
  return { total, soft };
}

export interface StartOptions {
  stake?: StakeType;
  /** The hand came from a split. */
  split?: boolean;
  /** Surrender is still on offer (first two cards, rules allow it). */
  surrender?: boolean;
  /** Bonus track for a Spanish 21 6-7-8 / 7-7-7 start; '' (the default) for none. */
  track?: Track;
  /** Cards in the hand, for a Spanish 21 multi-card hand (default 2). */
  n?: number;
  /** A split ace that may not draw. */
  lockedAce?: boolean;
}

/** A hand state for a total, as the chart and the drills ask about it. */
export function startState(
  total: number,
  soft: boolean,
  t: EvTable,
  opts: StartOptions = {},
): HandState {
  const stake = STAKE[opts.stake ?? 'real'];
  const n = opts.n ?? 2;
  const split = opts.split ?? false;
  return {
    total,
    soft,
    n,
    track: opts.track ?? '',
    W: stake.W,
    L: stake.L,
    doubles: 0,
    postDouble: false,
    split,
    lockedAce: opts.lockedAce ?? false,
    canSurrender: (opts.surrender ?? (n === 2 && !split && t.rules.ls)) && stake.L > 0,
    freeDouble: t.rules.freeDoubles && n === 2 && !soft && total >= 9 && total <= 11,
  };
}

/* ---------------------------------------------------------------- */
/* Splits                                                            */
/* ---------------------------------------------------------------- */

function splitHandLimit(pair: number, rules: VariantRules): number {
  return pair === 11 && !rules.rsa ? 2 : rules.maxHands;
}

/** Is this split a free split (Free Bet, any pair but tens)? */
export function isFreeSplit(pair: number, rules: VariantRules): boolean {
  return rules.freeSplits && pair !== 10;
}

/**
 * Value of one finished split hand: the pair card plus `card`, played out.
 * No further split (either it is not a pair, or the hand limit is reached).
 */
function splitHandValue(pair: number, card: number, stake: StakeType, t: EvTable): number {
  const { total, soft } = twoCardTotal(pair, card);
  const s = startState(total, soft, t, {
    stake,
    split: true,
    surrender: false,
    lockedAce: pair === 11 && !t.rules.splitAcesDraw,
  });
  return bestValue(s, t);
}

/**
 * Value of splitting a pair worth `pair` (11 = aces) held as a `stake` hand,
 * summed over every hand the split ends up making.
 *
 * Exact for an infinite deck: hands are played one at a time, the first hand
 * to completion (including its own resplits, which sit next to it) before the
 * next. A hand created by a free split holds a free-bet token; the first hand
 * keeps whatever the pair held.
 */
export function splitEv(pair: number, stake: StakeType, t: EvTable): number {
  const key = `${pair}|${stake}`;
  const seen = t.splitCache.get(key);
  if (seen !== undefined) return seen;
  const newStake: StakeType = isFreeSplit(pair, t.rules) ? 'free' : 'real';
  const limit = splitHandLimit(pair, t.rules);
  const memo = new Map<string, number>();
  const chain = (queue: StakeType[], hands: number): number => {
    if (queue.length === 0) return 0;
    const k = `${queue.join(',')}|${hands}`;
    const m = memo.get(k);
    if (m !== undefined) return m;
    const [front, ...rest] = queue;
    let ev = 0;
    for (const card of t.draw) {
      if (card.value === pair && hands < limit) {
        ev += card.p * chain([front!, newStake, ...rest], hands + 1);
      } else {
        ev += card.p * (splitHandValue(pair, card.value, front!, t) + chain(rest, hands));
      }
    }
    memo.set(k, ev);
    return ev;
  };
  const value = chain([stake, newStake], 2);
  t.splitCache.set(key, value);
  return value;
}

/**
 * Every play open to a fresh two-card hand, including the split when it is a
 * pair. `pair` is the pair's card value (11 = aces) or null.
 */
export function decisionValues(s: HandState, pair: number | null, t: EvTable, stake: StakeType = 'real'): ActionValues {
  const out = actionValues(s, t);
  if (pair !== null && s.n === 2 && !s.postDouble) {
    out[isFreeSplit(pair, t.rules) ? 'FP' : 'P'] = splitEv(pair, stake, t);
  }
  return out;
}

/** The highest-valued play. Ties go to the earlier entry of `order`. */
export function bestOf(vals: ActionValues, order: readonly VAct[] = ['S', 'H', 'D', 'FD', 'P', 'FP', 'R']): VAct {
  let best: VAct = 'S';
  let bestV = -Infinity;
  for (const a of order) {
    const v = vals[a];
    if (v !== undefined && v > bestV + 1e-12) {
      best = a;
      bestV = v;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- */
/* The whole round: house edge                                        */
/* ---------------------------------------------------------------- */

const SUIT_STATES: readonly [SuitState, number][] = [
  ['m', 3 / 4],
  ['s', 3 / 16],
  ['p', 1 / 16],
];

/** Value of the best play of a dealt two-card non-natural hand (no dealer natural). */
function dealtHandValue(v1: number, v2: number, t: EvTable): number {
  const { total, soft } = twoCardTotal(v1, v2);
  const pair = v1 === v2 ? v1 : null;
  const valueFor = (track: Track) => {
    const vals = decisionValues(startState(total, soft, t, { track }), pair, t);
    return Math.max(...(Object.values(vals) as number[]));
  };
  if (!t.rules.cardBonuses || trackFor(v1, v2, 'm') === '') return valueFor('');
  let ev = 0;
  for (const [suit, p] of SUIT_STATES) ev += p * valueFor(trackFor(v1, v2, suit));
  return ev;
}

/**
 * The player's expected return per initial bet over a whole round, playing
 * the computed strategy perfectly. House edge = minus this. Not for Switch,
 * whose two-hand round is `switchReturn`.
 */
export function roundReturn(rules: VariantRules): number {
  const draw = drawWeights(rules.spanishDeck);
  let total = 0;
  for (const up of draw) {
    const t = evTable(rules, up.value);
    const pNat = t.dealer.pNatural;
    let vsNatural = 0;
    let live = 0;
    for (const c1 of draw) {
      for (const c2 of draw) {
        const p = c1.p * c2.p;
        const natural = (c1.value === 11 && c2.value === 10) || (c1.value === 10 && c2.value === 11);
        vsNatural += p * (natural ? (rules.playerBjBeatsDealerBj ? rules.bjPays : 0) : -1);
        live += p * (natural ? rules.bjPays : dealtHandValue(c1.value, c2.value, t));
      }
    }
    total += up.p * (pNat * vsNatural + (1 - pNat) * live);
  }
  return total;
}

/* ---------------------------------------------------------------- */
/* Blackjack Switch                                                   */
/* ---------------------------------------------------------------- */

/**
 * Value of a Switch starting hand after the peek (no dealer natural).
 * A natural pays 1:1 and beats a dealer 22; an ace-ten made BY switching is
 * only a 21 (the Las Vegas rule the Wizard's tables assume).
 */
export function switchHandValue(v1: number, v2: number, natural: boolean, t: EvTable): number {
  const isAceTen = (v1 === 11 && v2 === 10) || (v1 === 10 && v2 === 11);
  if (isAceTen && natural) return t.rules.bjPays;
  return dealtHandValue(v1, v2, t);
}

export interface SwitchChoice {
  keep: number;
  swap: number;
  /** True when switching is worth more. */
  switchIt: boolean;
}

/**
 * The switch decision: hands (a, b) and (c, d) as dealt, or (a, d) and (c, b)
 * with the second cards switched. Values summed over both hands, after the peek.
 */
export function switchChoice(a: number, b: number, c: number, d: number, t: EvTable): SwitchChoice {
  const keep = switchHandValue(a, b, true, t) + switchHandValue(c, d, true, t);
  const swap = switchHandValue(a, d, false, t) + switchHandValue(c, b, false, t);
  return { keep, swap, switchIt: swap > keep + 1e-12 };
}

/** Switch's expected return per unit bet (two equal bets), switching optimally. */
export function switchReturn(rules: VariantRules): number {
  const draw = drawWeights(rules.spanishDeck);
  let total = 0;
  for (const up of draw) {
    const t = evTable(rules, up.value);
    const pNat = t.dealer.pNatural;
    // Against a dealer natural every hand loses but a dealt natural, which pushes.
    let vsNatural = 0;
    for (const c1 of draw) {
      for (const c2 of draw) {
        const natural = (c1.value === 11 && c2.value === 10) || (c1.value === 10 && c2.value === 11);
        vsNatural += c1.p * c2.p * (natural ? 0 : -1);
      }
    }
    vsNatural *= 2;
    let live = 0;
    for (const a of draw)
      for (const b of draw)
        for (const c of draw)
          for (const d of draw) {
            const ch = switchChoice(a.value, b.value, c.value, d.value, t);
            live += a.p * b.p * c.p * d.p * Math.max(ch.keep, ch.swap);
          }
    total += up.p * (pNat * vsNatural + (1 - pNat) * live);
  }
  // Two bets per round: per unit wagered.
  return total / 2;
}
