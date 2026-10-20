import { RANKS, fisherYatesShuffle, mulberry32, snapDecksRemaining } from './cards';
import type { Card, Rank } from './cards';
import { hiLoTag, trueCount } from './count';
import type { TcRounding } from './count';
import { play } from './strategy';
import { indexSetFor } from './deviations';
import type { Action, Deviation } from './deviations';
import { getChart } from './charts';
import type { Chart } from './charts';
import { upIndex } from './basicStrategy';
import { cutCardsFor, cutRngSeed } from './cut';
import type { StrategyRules } from './ruleset';
import type { SpreadRow } from './game';
import { methodBet, methodSpread } from './betMethods';
import type { BetMethod } from './betMethods';

/**
 * Wave K: THE CASINO SIMULATOR. A seeded Monte Carlo of one logged game, for
 * the Casino tab's ranking. Every number it produces comes from dealing cards
 * and playing them with the app's own engine:
 *
 *   - the shoe is `Shoe`'s: the same card order, the same `mulberry32`
 *     stream through the same `fisherYatesShuffle`, the cut from
 *     `cutCardsFor` on `Game`'s cut stream -- so a seed deals here exactly
 *     the cards it deals in Play (casinoSim.test.ts compares them card for
 *     card). Only the bookkeeping differs: an index into the shuffled array
 *     instead of `Shoe.draw`'s shift and a fresh set of card objects per shoe,
 *     which was half the cost of a simulated round;
 *   - every play is `play()` from strategy.ts, with the chart `getChart`
 *     assembles and the index set `indexSetFor` returns -- the same pair Play
 *     grades against (correctPlay is `play(..., indexSetFor(rules), getChart(rules))`);
 *   - the count is `hiLoTag` / `trueCount` over `snapDecksRemaining`, as
 *     `Game.trueCountNow` reads it, in the profile's TC rounding;
 *   - the round itself (two-pass deal, peek on A and ten, insurance on the
 *     summed stake, naturals paid at 3:2 or 6:5, splits to four hands per
 *     original with RSA only when the rules say, one card to split aces, DAS,
 *     late surrender on two-card unsplit hands, the dealer drawing only for a
 *     live hand, H17/S17) follows `Game` step for step. casinoSim.test.ts
 *     plays the same seed through `Game` itself and requires the same result
 *     on every round, so a divergence is a failing test rather than a quiet
 *     difference.
 *
 * Why not drive `Game` directly: it grades, logs and prices every decision,
 * which is what Play needs and costs a few microseconds a round. The house
 * edge needs ~20 million rounds to land within +/-0.05%, so the round loop
 * here is the same rules without the grading.
 *
 * TWO MODES.
 *   'basic': flat one unit, basic strategy, never insurance -- the house edge.
 *   'count': Hi-Lo with the profile's index set and insurance index, playing
 *     EVERY round. Each round records its pre-deal true count and its result
 *     per unit bet, and every betting method (betMethods.ts) is scored from
 *     that same sequence: what it would have bet at that count, whether it
 *     would have been seated. Sitting out a round would in reality change
 *     the cards the later rounds get -- slightly -- and this ignores that;
 *     scoring many betting schemes on one played sequence is the standard
 *     approximation in counting simulators, and the stats card says so.
 *
 * A SOLO SEAT. One player at the table, one hand, two on a ramp's x2 rows.
 * A full table would deal fewer rounds per shoe to each player.
 */

export type SimMode = 'basic' | 'count';

export interface SimSpec {
  /** The game's rules plus the profile's index flags (strategyRulesFor). */
  rules: StrategyRules;
  /** Decks left behind the cut card. `cutCardsFor` clamps it to [0.5, decks - 0.5]. */
  cutDecks: number;
  /** A continuous shuffler: a fresh shoe for every round. */
  csm: boolean;
  /** Dollars in one unit: the game's minimum bet. */
  unit: number;
  /** The table maximum in dollars; null = none. */
  maxBet: number | null;
  /** The profile's ramp. */
  spread: SpreadRow[];
  tcRounding: TcRounding;
  /** Play the profile's index set and insurance index ('count' mode only). */
  indices: boolean;
  methods: BetMethod[];
  /**
   * Shuffle before a round once fewer cards than this remain, even short of
   * the cut. Absent = 0: a dealer deals to the cut card. Play's table keeps a
   * reserve sized for a table with bots (Game.shuffleDue); the parity test
   * sets the same number to deal Play's exact shoes.
   */
  reserveCards?: number;
}

/**
 * Running sums for one betting method (or the basic-strategy house edge).
 * Money is dollars. "Observed" rounds are the ones the method spends time on:
 * played, or watched while back-counting. Rounds after a wong-out exit are
 * neither -- the player has left that shoe for a fresh one (`MethodState`).
 */
export interface Accum {
  observed: number;
  played: number;
  /** Rounds played with two hands. */
  twoHands: number;
  net: number;
  /** Sum of squared net over PLAYED rounds. */
  net2: number;
  /** Initial bets over played rounds. */
  wagered: number;
  /**
   * Shoe-by-shoe sums for an honest standard error: rounds in a shoe are not
   * independent (the bet follows the count), so the error of the mean is
   * taken over shoes, the ratio estimator's variance
   * sum((y - R x)^2) / (sum x)^2 with y = a shoe's net, x = its observed rounds.
   */
  sy2: number;
  sxy: number;
  sx2: number;
  shoes: number;
}

export function emptyAccum(): Accum {
  return { observed: 0, played: 0, twoHands: 0, net: 0, net2: 0, wagered: 0, sy2: 0, sxy: 0, sx2: 0, shoes: 0 };
}

interface MethodState {
  spread: SpreadRow[];
  method: BetMethod;
  seated: boolean;
  left: boolean;
  shoeNet: number;
  shoeObs: number;
  acc: Accum;
}

interface SimHand {
  cards: Card[];
  /** The total with every ace counted as one, and how many aces: enough for
   * the total, softness, bust and natural without re-reading the cards. */
  hard: number;
  aces: number;
  doubled: boolean;
  surrendered: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  /** Settled before the dealer played: a natural. */
  settled: boolean;
  origin: number;
  /** Result in units of this hand's initial bet. */
  net: number;
}

const ACTIONS: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

/**
 * True counts outside this are clamped for the decision cache only. Every
 * index in every set `indexSetFor` returns lies well inside it
 * (casinoSim.test.ts checks), so a clamped count makes the same comparison
 * against every threshold as the real one.
 */
export const TC_CLAMP = 15;

/** Each rank's value with the ace as one -- also its pair group (A = 1, tens = 10). */
const VAL: Record<Rank, number> = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 10, Q: 10, K: 10 };
/** `hiLoTag` per rank, looked up once. */
const TAG = Object.fromEntries((Object.keys(VAL) as Rank[]).map((r) => [r, hiLoTag(r)])) as Record<Rank, number>;

/** `handValue` from the running (hard, aces) pair: one ace may count eleven. */
const totalOf = (hard: number, aces: number) => (aces > 0 && hard + 10 <= 21 ? hard + 10 : hard);
const softOf = (hard: number, aces: number) => aces > 0 && hard + 10 <= 21;
/** `isBlackjack`: two cards, an ace and a ten. */
const naturalOf = (h: SimHand) => h.cards.length === 2 && h.aces === 1 && h.hard === 11;

function newHand(origin: number): SimHand {
  return { cards: [], hard: 0, aces: 0, doubled: false, surrendered: false, fromSplit: false, splitAces: false, done: false, settled: false, origin, net: 0 };
}

const SUITS = ['s', 'h', 'd', 'c'] as const;

const isTenUp = (r: Rank) => VAL[r] === 10;

export class CasinoSim {
  readonly mode: SimMode;
  readonly spec: SimSpec;
  /** The shuffled shoe, the next card's index, and where the cut card sits. */
  private cards: Card[] = [];
  private pos = 0;
  private cutPos = 0;
  /** Every card of the shoe, in `Shoe`'s build order (deck, suit, rank). */
  private readonly base: Card[] = [];
  private readonly shoeRng: () => number;
  private readonly cutCards: () => number;
  private rc = 0;
  private readonly decks: number;
  private readonly chart: Chart;
  private readonly deviations: Deviation[];
  private readonly insThreshold: number | null;
  private readonly bjPays: number;
  /** Decision cache: an action index + 1, or 0 when not yet asked. */
  private readonly cache = new Int8Array(11 * 32 * 2 * 10 * 8 * (2 * TC_CLAMP + 1));
  private roundInShoe = 0;
  private readonly methods: MethodState[];
  /** The house edge's sums (mode 'basic'). */
  readonly basic: Accum = emptyAccum();
  /** Hands the simulated seat opens with at each clamped pre-deal count (index tc + TC_CLAMP). */
  private readonly handsAt: (1 | 2)[] = [];
  rounds = 0;
  /** Test hook: every round's pre-deal count and results, per unit bet. */
  onRound?: (r: { tc: number; hands: 1 | 2; first: number; total: number; shuffled: boolean }) => void;
  private shuffledThisRound = false;
  /** Per method, per clamped pre-deal count: units on each hand and hands. */
  private readonly unitsAt: number[][] = [];
  private readonly methodHandsAt: (1 | 2)[][] = [];
  /** CSM only: the shoe's cards, drawn by a lazy Fisher-Yates (see `draw`). */
  private readonly csmCards: Card[] = [];
  private csmLeft = 0;
  private readonly csmRng: () => number;

  constructor(spec: SimSpec, mode: SimMode, seed: number) {
    this.spec = spec;
    this.mode = mode;
    this.decks = spec.rules.decks;
    this.chart = getChart(spec.rules);
    const counting = mode === 'count' && spec.indices;
    this.deviations = counting ? indexSetFor(spec.rules) : [];
    const ins = this.deviations.find((d) => d.id === 'ins');
    this.insThreshold = counting && ins ? ins.threshold : null;
    this.bjPays = spec.rules.bj65 ? 1.2 : 1.5;
    // The cut, seeded the way Game seeds it, so a seed deals the same shoe here as there.
    const cutRng = mulberry32(cutRngSeed(seed));
    const cutSpec = { penetration: 0.75, cutDecks: spec.cutDecks, cutVary: false, rules: { decks: this.decks } };
    this.cutCards = () => cutCardsFor(cutSpec, cutRng);
    for (let d = 0; d < this.decks; d++) for (const suit of SUITS) for (const rank of RANKS) this.base.push({ rank, suit });
    this.shoeRng = mulberry32(seed);
    this.shuffleShoe();
    this.methods =
      mode === 'count'
        ? spec.methods.map((m) => ({
            method: m,
            spread: methodSpread(m, spec.spread),
            seated: m.entryTc === null,
            left: false,
            shoeNet: 0,
            shoeObs: 0,
            acc: emptyAccum(),
          }))
        : [];
    // A ramp row beyond the clamp never fires; every ramp the profile editor
    // can build stays inside it.
    for (const m of this.methods) {
      const units: number[] = [];
      const hands: (1 | 2)[] = [];
      for (let tc = -TC_CLAMP; tc <= TC_CLAMP; tc++) {
        const b = methodBet(m.spread, tc);
        units.push(b.units);
        hands.push(b.hands);
      }
      this.unitsAt.push(units);
      this.methodHandsAt.push(hands);
    }
    for (let i = 0; i <= 2 * TC_CLAMP; i++) {
      this.handsAt.push(this.methodHandsAt.some((h) => h[i] === 2) ? 2 : 1);
    }
    this.csmRng = mulberry32(seed);
    if (spec.csm) this.csmCards.push(...this.base);
  }

  /** Each method's sums, in the order of `spec.methods`. */
  methodAccums(): { method: BetMethod; acc: Accum }[] {
    return this.methods.map((m) => ({ method: m.method, acc: this.withOpenShoe(m.acc, m.shoeNet, m.shoeObs) }));
  }

  basicAccum(): Accum {
    return this.withOpenShoe(this.basic, this.basicShoeNet, this.basicShoeObs);
  }

  private basicShoeNet = 0;
  private basicShoeObs = 0;

  /** The sums with the shoe in progress counted as if it ended now. */
  private withOpenShoe(a: Accum, y: number, x: number): Accum {
    if (x === 0) return { ...a };
    return { ...a, sy2: a.sy2 + y * y, sxy: a.sxy + x * y, sx2: a.sx2 + x * x, shoes: a.shoes + 1 };
  }

  private closeShoe(): void {
    if (this.roundInShoe === 0) return;
    const close = (a: Accum, y: number, x: number) => {
      if (x === 0) return;
      a.sy2 += y * y;
      a.sxy += x * y;
      a.sx2 += x * x;
      a.shoes += 1;
    };
    close(this.basic, this.basicShoeNet, this.basicShoeObs);
    this.basicShoeNet = 0;
    this.basicShoeObs = 0;
    for (const m of this.methods) {
      close(m.acc, m.shoeNet, m.shoeObs);
      m.shoeNet = 0;
      m.shoeObs = 0;
      m.seated = m.method.entryTc === null;
      m.left = false;
    }
  }

  /** `Shoe`'s constructor and `shuffle()`: build-order cards through Fisher-Yates, then place the cut. */
  private shuffleShoe(): void {
    this.cards = fisherYatesShuffle(this.base, this.shoeRng);
    this.pos = 0;
    this.cutPos = this.cards.length - this.cutCards();
  }

  /** Test hook: the next `n` cards this shoe will deal, without dealing them. */
  peekCards(n: number): Card[] {
    return this.cards.slice(this.pos, this.pos + n);
  }

  private newShoe(): void {
    this.closeShoe();
    if (this.spec.csm) this.csmLeft = this.csmCards.length;
    else this.shuffleShoe();
    this.rc = 0;
    this.roundInShoe = 0;
    this.shuffledThisRound = true;
  }

  private tcNow(): number {
    const left = this.spec.csm ? this.csmLeft : this.cards.length - this.pos;
    return trueCount(this.rc, snapDecksRemaining(left, this.decks), this.spec.tcRounding);
  }

  private draw(): Card {
    if (this.spec.csm) {
      // A continuous shuffler deals each round from a freshly mixed shoe. A
      // Fisher-Yates shuffle run lazily -- one swap per card drawn, from the
      // cards not yet drawn this round -- deals exactly the distribution of
      // `Shoe.shuffle()` then `draw()`, without rebuilding the shoe per round.
      const n = this.csmLeft;
      const j = Math.floor(this.csmRng() * n);
      const c = this.csmCards[j]!;
      this.csmCards[j] = this.csmCards[n - 1]!;
      this.csmCards[n - 1] = c;
      this.csmLeft = n - 1;
      return c;
    }
    // cutCardsFor never leaves fewer than half a deck behind the cut, so a
    // round only runs the shoe dry on a freak run of splits and small cards.
    // A dealer then shuffles the discards back in; a fresh shoe stands in.
    if (this.pos >= this.cards.length) {
      this.shuffleShoe();
      this.rc = 0;
    }
    return this.cards[this.pos++]!;
  }

  private drawTo(h: SimHand): void {
    const c = this.draw();
    h.cards.push(c);
    h.hard += VAL[c.rank];
    if (c.rank === 'A') h.aces += 1;
    this.rc += TAG[c.rank];
  }

  /**
   * `play()`, memoised on everything it reads: the pair group (isPair /
   * pairRank), the total and softness (handValue), the up card (upIndex), the
   * count and the three options. casinoSim.test.ts asks `play()` itself for
   * every cached cell.
   */
  private decide(h: SimHand, up: Rank, upIdx: number, tc: number, canDouble: boolean, canSplit: boolean, canSurrender: boolean): Action {
    const cards = h.cards;
    const pr = cards.length === 2 && VAL[cards[0]!.rank] === VAL[cards[1]!.rank] ? VAL[cards[0]!.rank] : 0;
    const t = tc > TC_CLAMP ? TC_CLAMP : tc < -TC_CLAMP ? -TC_CLAMP : tc;
    const ctx = (canDouble ? 1 : 0) | (canSplit ? 2 : 0) | (canSurrender ? 4 : 0);
    const key =
      ((((pr * 32 + totalOf(h.hard, h.aces)) * 2 + (softOf(h.hard, h.aces) ? 1 : 0)) * 10 + upIdx) * 8 + ctx) * (2 * TC_CLAMP + 1) +
      (t + TC_CLAMP);
    const hit = this.cache[key]!;
    if (hit !== 0) return ACTIONS[hit - 1]!;
    const action = play(cards, up, t, { canDouble, canSplit, canSurrender }, this.deviations, this.chart).action;
    this.cache[key] = ACTIONS.indexOf(action) + 1;
    return action;
  }

  /** Test hook: the cached decision for a hand of these cards, as `play()` would be asked it. */
  decideCards(cards: Card[], up: Rank, tc: number, canDouble: boolean, canSplit: boolean, canSurrender: boolean): Action {
    const h = newHand(0);
    for (const c of cards) {
      h.cards.push(c);
      h.hard += VAL[c.rank];
      if (c.rank === 'A') h.aces += 1;
    }
    return this.decide(h, up, upIndex(up), tc, canDouble, canSplit, canSurrender);
  }

  /** Simulate `n` more rounds. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  private step(): void {
    this.shuffledThisRound = false;
    if (this.spec.csm || this.pos >= this.cutPos || this.cards.length - this.pos < (this.spec.reserveCards ?? 0)) this.newShoe();
    const tc = this.tcNow();
    const counting = this.mode === 'count';
    const clamped = tc > TC_CLAMP ? TC_CLAMP : tc < -TC_CLAMP ? -TC_CLAMP : tc;
    const handsN = counting ? this.handsAt[clamped + TC_CLAMP]! : 1;
    this.playRound(handsN, counting);
    const first = this.lastFirst;
    const total = this.lastTotal;
    this.rounds += 1;
    this.onRound?.({ tc, hands: handsN, first, total, shuffled: this.shuffledThisRound });

    if (!counting) {
      const net = first * this.spec.unit;
      const a = this.basic;
      a.observed += 1;
      a.played += 1;
      a.net += net;
      a.net2 += net * net;
      a.wagered += this.spec.unit;
      this.basicShoeNet += net;
      this.basicShoeObs += 1;
    } else {
      for (let i = 0; i < this.methods.length; i++) this.score(i, clamped + TC_CLAMP, tc, handsN, first, total);
    }
    this.roundInShoe += 1;
  }

  /** One round, as this method would have met it. */
  private score(mi: number, tcIdx: number, tc: number, simHands: 1 | 2, first: number, total: number): void {
    const m = this.methods[mi]!;
    if (m.left) return;
    const { entryTc, exitTc } = m.method;
    if (m.seated && exitTc !== null && this.roundInShoe > 0 && tc <= exitTc) {
      // Wong out: this shoe is over for the method. It walks to a fresh one,
      // and the walk is free -- the rest of this shoe is neither played nor timed.
      m.left = true;
      return;
    }
    const a = m.acc;
    if (!m.seated) {
      if (entryTc !== null && tc >= entryTc) {
        m.seated = true;
      } else {
        a.observed += 1;
        m.shoeObs += 1;
        return;
      }
    }
    const units = this.unitsAt[mi]![tcIdx]!;
    const hands = this.methodHandsAt[mi]![tcIdx]!;
    const bet = Math.min(units * this.spec.unit, this.spec.maxBet ?? Infinity);
    // Two hands on the method's ramp take both hands' result; one hand takes
    // the first-dealt hand's alone (the seat opens two whenever ANY method
    // spreads to two at this count -- `handsAt` -- so two were dealt).
    const perUnit = hands === 2 && simHands === 2 ? total : first;
    const net = bet * perUnit;
    a.observed += 1;
    a.played += 1;
    if (hands === 2) a.twoHands += 1;
    a.net += net;
    a.net2 += net * net;
    a.wagered += bet * hands;
    m.shoeNet += net;
    m.shoeObs += 1;
  }

  private lastFirst = 0;
  private lastTotal = 0;

  /**
   * Deal and play one round with `n` one-unit hands. Leaves the first-dealt
   * hand's result and the round's total in `lastFirst` / `lastTotal`, both in
   * units per hand-unit, insurance included (each hand insures half its own bet).
   */
  private playRound(n: 1 | 2, counting: boolean): void {
    const r = this.spec.rules;
    const hands: SimHand[] = n === 1 ? [newHand(0)] : [newHand(0), newHand(1)];
    // Game.dealTwoPassRound: each hand rightmost first, the up card, again, the hole.
    for (let h = n - 1; h >= 0; h--) this.drawTo(hands[h]!);
    const up = this.draw();
    this.rc += TAG[up.rank];
    for (let h = n - 1; h >= 0; h--) this.drawTo(hands[h]!);
    const hole = this.draw(); // face down: counted only when revealed
    const upIdx = upIndex(up.rank);
    let dHard = VAL[up.rank] + VAL[hole.rank];
    let dAces = (up.rank === 'A' ? 1 : 0) + (hole.rank === 'A' ? 1 : 0);
    const dealerBJ = dAces === 1 && dHard === 11;

    // Insurance (Game.insuranceDecision): one decision on the summed stake,
    // taken at the index on the live count.
    let insurance = 0;
    if (up.rank === 'A' && this.insThreshold !== null && this.tcNow() >= this.insThreshold) {
      insurance = dealerBJ ? 1 : -0.5;
    }

    if (dealerBJ && (up.rank === 'A' || isTenUp(up.rank))) {
      this.rc += TAG[hole.rank];
      for (const h of hands) h.net = naturalOf(h) ? 0 : -1;
      this.finish(hands, n, insurance);
      return;
    }

    for (const h of hands) {
      if (naturalOf(h)) {
        h.done = true;
        h.settled = true;
        h.net = this.bjPays;
      }
    }

    for (let i = lastLive(hands); i !== -1; i = lastLive(hands)) {
      const hand = hands[i]!;
      const two = hand.cards.length === 2;
      const canDouble = two && !hand.doubled && !hand.splitAces && (!hand.fromSplit || r.das);
      const canSplit =
        two && VAL[hand.cards[0]!.rank] === VAL[hand.cards[1]!.rank] && countOrigin(hands, hand.origin) < 4 && (!hand.splitAces || r.rsa);
      const canSurrender = two && !hand.fromSplit && r.ls;
      const action = this.decide(hand, up.rank, upIdx, counting ? this.tcNow() : 0, canDouble, canSplit, canSurrender);
      switch (action) {
        case 'hit':
          if (hand.splitAces) throw new Error('casinoSim: hit on a split ace (Game would refuse it too)');
          this.drawTo(hand);
          if (hand.hard > 21) hand.done = true;
          break;
        case 'stand':
          hand.done = true;
          break;
        case 'double':
          hand.doubled = true;
          this.drawTo(hand);
          hand.done = true;
          break;
        case 'surrender':
          hand.surrendered = true;
          hand.done = true;
          break;
        case 'split':
          this.split(hands, i);
          break;
      }
    }

    // Game.finishAfterPlayerDone: only naturals on the felt -> the dealer never acts.
    let unsettled = false;
    let live = false;
    for (const h of hands) {
      if (h.settled) continue;
      unsettled = true;
      if (!h.surrendered && h.hard <= 21) live = true;
    }
    if (!unsettled) {
      this.finish(hands, n, insurance);
      return;
    }
    this.rc += TAG[hole.rank];
    if (live) {
      // Game.dealerShouldHit: below 17, or a soft 17 under H17.
      for (;;) {
        const t = totalOf(dHard, dAces);
        if (!(t < 17 || (t === 17 && softOf(dHard, dAces) && !r.s17))) break;
        const c = this.draw();
        dHard += VAL[c.rank];
        if (c.rank === 'A') dAces += 1;
        this.rc += TAG[c.rank];
      }
    }
    const dTotal = totalOf(dHard, dAces);
    const dealerBust = dTotal > 21;
    for (const h of hands) {
      if (h.settled) continue;
      const stake = h.doubled ? 2 : 1;
      if (h.surrendered) h.net = -0.5;
      else if (h.hard > 21) h.net = -stake;
      else if (dealerBust) h.net = stake;
      else {
        const t = totalOf(h.hard, h.aces);
        h.net = t > dTotal ? stake : t < dTotal ? -stake : 0;
      }
    }
    this.finish(hands, n, insurance);
  }

  private finish(hands: SimHand[], n: number, insurance: number): void {
    // The first-dealt hand is the rightmost: origin n - 1.
    let first = 0;
    let total = 0;
    for (const h of hands) {
      total += h.net;
      if (h.origin === n - 1) first += h.net;
    }
    this.lastFirst = first + insurance;
    this.lastTotal = total + insurance * n;
  }

  /** Game.performSplit: the new hand goes right of the old, and is dealt first. */
  private split(hands: SimHand[], index: number): void {
    const hand = hands[index]!;
    const aces = hand.cards[0]!.rank === 'A';
    const newH = newHand(hand.origin);
    newH.cards.push(hand.cards[1]!);
    newH.hard = VAL[hand.cards[1]!.rank];
    newH.aces = aces ? 1 : 0;
    newH.fromSplit = true;
    newH.splitAces = aces;
    hand.cards = [hand.cards[0]!];
    hand.hard = VAL[hand.cards[0]!.rank];
    hand.aces = aces ? 1 : 0;
    hand.fromSplit = true;
    hand.splitAces = aces;
    hands.splice(index + 1, 0, newH);
    this.drawTo(newH);
    this.drawTo(hand);
    if (aces) {
      const atCap = countOrigin(hands, hand.origin) === 4;
      hand.done = !this.spec.rules.rsa || hand.cards[1]!.rank !== 'A' || atCap;
      newH.done = !this.spec.rules.rsa || newH.cards[1]!.rank !== 'A' || atCap;
      if (atCap) for (const h of hands) if (h.origin === hand.origin && h.splitAces) h.done = true;
    }
  }
}

function lastLive(hands: SimHand[]): number {
  for (let i = hands.length - 1; i >= 0; i--) if (!hands[i]!.done) return i;
  return -1;
}

function countOrigin(hands: SimHand[], origin: number): number {
  let n = 0;
  for (const h of hands) if (h.origin === origin) n += 1;
  return n;
}
