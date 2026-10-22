import { MULBERRY32_STEP, RANKS, fisherYatesShuffle, mulberry32, snapDecksRemaining } from './cards';
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
  // ---- Wave M (lane m): the owner's real games. Absent = the old behaviour.
  /**
   * Decks in the physical shoe when it differs from `rules.decks` (4 or 5:
   * RuleSet knows 1/2/6/8, and every chart lookup for 4+ decks is the same
   * multi-deck chart, charts/index.ts `deckClassFor`).
   */
  shoeDecks?: number;
  /** Most hands one original hand may become (absent = 4). */
  maxSplitHands?: 2 | 3 | 4;
  /** Which two-card hands may double (absent = any two). Hard-or-soft total, two cards. */
  doubleOn?: 'any2' | '9-11' | '10-11';
  /**
   * Split aces may be doubled (one card, doubled stake). The hand still cannot
   * hit: it doubles when the chart says double and stands otherwise.
   */
  doubleSplitAces?: boolean;
  /** Commission, in percent of each hand's initial bet, charged once per hand dealt (not on split hands or doubles). */
  commissionPct?: number;
  // ---- end Wave M
}

/**
 * Running sums for one betting method (or the basic-strategy house edge).
 * Money is dollars. "Observed" rounds are the ones the method spends time on:
 * played, or watched while back-counting. Rounds after an exit (a wong-out,
 * or a back-counter leaving at its exit count) are neither -- the player has
 * left that shoe for a fresh one -- but the EXIT itself costs time: finding
 * another table, or waiting for a shuffle where mid-shoe entry is barred.
 * That time is a setting (minutes per exit, Casino settings) turned into
 * rounds at display time (casinoStats.ts `summarize`), so the simulator
 * counts exits and keeps the per-shoe cross sums the interval needs.
 */
export interface Accum {
  observed: number;
  played: number;
  /**
   * Exits: shoes the method left with at least one more round still to be
   * dealt from them. Re-review R3: leaving on a shoe's last round before the
   * cut costs no table time -- the shuffle was coming anyway, as it does for
   * every method -- so it is not counted (and not charged).
   */
  exits: number;
  /** Every round dealt while the method was in the simulation, played or not. */
  dealt: number;
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
   * sum((y - R t)^2) / (sum t)^2 with y = a shoe's net and t = its time:
   * x observed rounds plus e exits at k rounds each, t = x + k e. k is only
   * known at display time, so the sum of every product is kept.
   */
  sy2: number;
  sxy: number;
  sx2: number;
  /** Per shoe: sums of e^2, e y and x e. */
  se2: number;
  sey: number;
  sxe: number;
  shoes: number;
}

export function emptyAccum(): Accum {
  return { observed: 0, played: 0, exits: 0, dealt: 0, twoHands: 0, net: 0, net2: 0, wagered: 0, sy2: 0, sxy: 0, sx2: 0, se2: 0, sey: 0, sxe: 0, shoes: 0 };
}

const ACCUM_FIELDS = Object.keys(emptyAccum()) as (keyof Accum)[];

/**
 * Wave Q: two runs' sums as one. Every field is a sum -- over rounds, or over
 * shoes for the interval's cross sums -- so the sums of two independent runs
 * (different seeds, each a whole number of shoes, its open shoe closed by
 * `withOpenShoe`) are exactly the sums of the longer run made of both. That is
 * what lets a game's figures firm up across several short runs instead of one
 * long one. An absent field (a result stored before it existed) adds as 0.
 */
export function mergeAccum(a: Accum, b: Accum): Accum {
  const out = emptyAccum();
  for (const k of ACCUM_FIELDS) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
}

interface MethodState {
  spread: SpreadRow[];
  method: BetMethod;
  seated: boolean;
  left: boolean;
  shoeNet: number;
  shoeObs: number;
  shoeExits: number;
  /** Left this shoe, and no round has been dealt from it since (R3: not yet an exit that costs time). */
  exitPending: boolean;
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

/** Close one shoe into the sums: y its net, x its observed rounds, e its exits. */
function addShoe(a: Accum, y: number, x: number, e: number): void {
  if (x === 0 && e === 0) return;
  a.sy2 += y * y;
  a.sxy += x * y;
  a.sx2 += x * x;
  a.se2 += e * e;
  a.sey += e * y;
  a.sxe += x * e;
  a.shoes += 1;
}

const isTenUp = (r: Rank) => VAL[r] === 10;

/** Card type index as sideBets/comp.ts numbers them: rank (A..K) x 4 + suit (s, h, d, c). */
const RANK_I = Object.fromEntries(RANKS.map((r, i) => [r, i])) as Record<Rank, number>;
const SUIT_I: Record<Card['suit'], number> = { s: 0, h: 1, d: 2, c: 3 };
const typeOfCard = (c: Card) => RANK_I[c.rank] * 4 + SUIT_I[c.suit];

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
  /** Wave M: the split cap, and the commission as a fraction of each hand's bet. */
  private readonly maxHands: number;
  private readonly fee: number;
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
  onRound?: (r: { tc: number; hands: 1 | 2; first: number; total: number; shuffled: boolean; midShuffle: boolean }) => void;
  private shuffledThisRound = false;
  /** The shoe ran dry inside this round and a fresh one finished it (see `draw`). */
  private midShuffle = false;
  /** Per method, per clamped pre-deal count: units on each hand and hands. */
  private readonly unitsAt: number[][] = [];
  private readonly methodHandsAt: (1 | 2)[][] = [];
  /** CSM only: the shoe's cards, drawn by a lazy Fisher-Yates (see `draw`). */
  private readonly csmCards: Card[] = [];
  private csmLeft = 0;
  private readonly csmRng: () => number;
  /**
   * Wave Q re-review R1: the seed, and the draws each generator seeded with
   * it has taken (see `nextSeed`): the shoe's shuffles, a shuffler's draw per
   * card. Both start at the seed, so the stream used is the longer of the two.
   */
  private readonly seed: number;
  private shoeDraws = 0;
  private csmDraws = 0;
  /**
   * Wave L (side bets): the cards left in the shoe, per card type
   * (sideBets/comp.ts), kept only after `trackComposition()`. A side bet's
   * odds are a function of exactly this, so its simulation reads it before
   * every round (`onPreDeal`). Off, nothing here costs a thing.
   */
  left: Int16Array | null = null;
  /** Wave L: called before each round is dealt, after any shuffle. */
  onPreDeal?: () => void;

  constructor(spec: SimSpec, mode: SimMode, seed: number) {
    this.spec = spec;
    this.mode = mode;
    this.decks = spec.shoeDecks ?? spec.rules.decks;
    this.maxHands = spec.maxSplitHands ?? 4;
    this.fee = (spec.commissionPct ?? 0) / 100;
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
    this.seed = seed >>> 0;
    const shoeRng = mulberry32(seed);
    this.shoeRng = () => {
      this.shoeDraws++;
      return shoeRng();
    };
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
            shoeExits: 0,
            exitPending: false,
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
    const csmRng = mulberry32(seed);
    this.csmRng = () => {
      this.csmDraws++;
      return csmRng();
    };
    if (spec.csm) this.csmCards.push(...this.base);
  }

  /** Draws taken from the seed's stream so far. */
  get draws(): number {
    return Math.max(this.shoeDraws, this.csmDraws);
  }

  /**
   * Wave Q re-review R1: the seed that carries on this sim's dealing stream
   * from where it stands (MULBERRY32_STEP): a sim seeded with it deals the
   * very draws this one would take next, and none it has taken. The seed's
   * stream is all the dealing there is: the cut has its own, and never
   * varies here.
   */
  nextSeed(): number {
    return (this.seed + Math.imul(this.draws, MULBERRY32_STEP)) >>> 0;
  }

  /** Each method's sums, in the order of `spec.methods`. */
  methodAccums(): { method: BetMethod; acc: Accum }[] {
    return this.methods.map((m) => ({ method: m.method, acc: this.withOpenShoe(m.acc, m.shoeNet, m.shoeObs, m.shoeExits) }));
  }

  basicAccum(): Accum {
    return this.withOpenShoe(this.basic, this.basicShoeNet, this.basicShoeObs, 0);
  }

  private basicShoeNet = 0;
  private basicShoeObs = 0;

  /** The sums with the shoe in progress counted as if it ended now. */
  private withOpenShoe(a: Accum, y: number, x: number, e: number): Accum {
    const out = { ...a };
    addShoe(out, y, x, e);
    return out;
  }

  private closeShoe(): void {
    if (this.roundInShoe === 0) return;
    addShoe(this.basic, this.basicShoeNet, this.basicShoeObs, 0);
    this.basicShoeNet = 0;
    this.basicShoeObs = 0;
    for (const m of this.methods) {
      addShoe(m.acc, m.shoeNet, m.shoeObs, m.shoeExits);
      m.shoeNet = 0;
      m.shoeObs = 0;
      m.shoeExits = 0;
      // R3: left on the shoe's last round: the shuffle came anyway, no time lost.
      m.exitPending = false;
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

  /** Wave L: keep `left` from now on (a fresh count of the shoe as it stands). */
  trackComposition(): void {
    const left = new Int16Array(52);
    const from = this.spec.csm ? this.csmCards.slice(0, this.csmLeft) : this.cards.slice(this.pos);
    for (const c of from) left[typeOfCard(c)]! += 1;
    this.left = left;
  }

  private refillLeft(): void {
    if (this.left) this.left.fill(this.decks);
  }

  /** Test hook: the next `n` cards this shoe will deal, without dealing them. */
  peekCards(n: number): Card[] {
    return this.cards.slice(this.pos, this.pos + n);
  }

  private newShoe(): void {
    this.closeShoe();
    if (this.spec.csm) this.csmLeft = this.csmCards.length;
    else this.shuffleShoe();
    this.refillLeft();
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
      if (this.left) this.left[typeOfCard(c)]! -= 1;
      return c;
    }
    // cutCardsFor never leaves fewer than half a deck behind the cut, so a
    // round only runs the shoe dry on a freak run of splits and small cards.
    // A dealer then shuffles the discards back in; a fresh shoe stands in.
    // Review N7: the round is scored in the old shoe, then that shoe is closed
    // like any other (`step`), so a method that had left comes back for it.
    if (this.pos >= this.cards.length) {
      this.shuffleShoe();
      this.refillLeft();
      this.rc = 0;
      this.midShuffle = true;
    }
    const c = this.cards[this.pos++]!;
    if (this.left) this.left[typeOfCard(c)]! -= 1;
    return c;
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
    this.onPreDeal?.();
    const tc = this.tcNow();
    const counting = this.mode === 'count';
    const clamped = tc > TC_CLAMP ? TC_CLAMP : tc < -TC_CLAMP ? -TC_CLAMP : tc;
    const handsN = counting ? this.handsAt[clamped + TC_CLAMP]! : 1;
    this.playRound(handsN, counting);
    const first = this.lastFirst;
    const total = this.lastTotal;
    this.rounds += 1;
    this.onRound?.({ tc, hands: handsN, first, total, shuffled: this.shuffledThisRound, midShuffle: this.midShuffle });

    if (!counting) {
      const net = first * this.spec.unit;
      const a = this.basic;
      a.observed += 1;
      a.played += 1;
      a.dealt += 1;
      a.net += net;
      a.net2 += net * net;
      a.wagered += this.spec.unit;
      this.basicShoeNet += net;
      this.basicShoeObs += 1;
    } else {
      for (let i = 0; i < this.methods.length; i++) this.score(i, clamped + TC_CLAMP, tc, handsN, first, total);
    }
    this.roundInShoe += 1;
    if (this.midShuffle) {
      // The cards already dealt from the fresh shoe make its next round its
      // second, so the exit check (never on a shoe's first round) applies.
      this.midShuffle = false;
      this.closeShoe();
      this.roundInShoe = 1;
    }
  }

  /** One round, as this method would have met it. */
  private score(mi: number, tcIdx: number, tc: number, simHands: 1 | 2, first: number, total: number): void {
    const m = this.methods[mi]!;
    const a = m.acc;
    a.dealt += 1;
    if (m.left) {
      // R3: the shoe went on past the exit, so leaving cost a table change.
      if (m.exitPending) {
        m.exitPending = false;
        a.exits += 1;
        m.shoeExits += 1;
      }
      return;
    }
    const { entryTc, exitTc } = m.method;
    if (m.seated && exitTc !== null && this.roundInShoe > 0 && tc <= exitTc) {
      // Exit (a wong-out, or a seated back-counter at its exit count): this
      // shoe is over for the method. The rest of it is neither played nor
      // watched. The exit is counted once the shoe deals another round (R3,
      // see Accum), and its time -- finding another table -- is added at
      // display time.
      m.left = true;
      m.exitPending = true;
      return;
    }
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
      const dsa = hand.splitAces && this.spec.doubleSplitAces === true;
      const canDouble =
        two && !hand.doubled && (!hand.splitAces || dsa) && (!hand.fromSplit || r.das) && this.doubleAllowed(hand);
      const canSplit =
        two && VAL[hand.cards[0]!.rank] === VAL[hand.cards[1]!.rank] && countOrigin(hands, hand.origin) < this.maxHands && (!hand.splitAces || r.rsa);
      const canSurrender = two && !hand.fromSplit && r.ls;
      let action = this.decide(hand, up.rank, upIdx, counting ? this.tcNow() : 0, canDouble, canSplit, canSurrender);
      // Wave M: a split ace that may double but never hit stands on anything else.
      if (hand.splitAces && (action === 'hit' || action === 'surrender')) action = 'stand';
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

  /** Wave M: the double-on restriction, on the two-card total. */
  private doubleAllowed(h: SimHand): boolean {
    const on = this.spec.doubleOn;
    if (!on || on === 'any2') return true;
    const t = totalOf(h.hard, h.aces);
    return on === '9-11' ? t >= 9 && t <= 11 : t >= 10 && t <= 11;
  }

  /** Test hook (Wave M): every round's final hands, before they are summed. */
  onHands?: (hands: readonly { cards: readonly Card[]; doubled: boolean; splitAces: boolean; origin: number }[]) => void;

  private finish(hands: SimHand[], n: number, insurance: number): void {
    this.onHands?.(hands);
    // The first-dealt hand is the rightmost: origin n - 1.
    let first = 0;
    let total = 0;
    for (const h of hands) {
      total += h.net;
      if (h.origin === n - 1) first += h.net;
    }
    // Wave M: a card room's commission, once per hand DEALT (its initial bet),
    // win or lose -- not again on a split hand or a double (review N5).
    this.lastFirst = first + insurance - this.fee;
    this.lastTotal = total + insurance * n - this.fee * n;
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
      const atCap = countOrigin(hands, hand.origin) === this.maxHands;
      // Wave M: with doubling on split aces each still gets its decision (double or stand).
      const dsa = this.spec.doubleSplitAces === true;
      const resplit = (h: SimHand) => this.spec.rules.rsa && h.cards[1]!.rank === 'A' && !atCap;
      hand.done = !dsa && !resplit(hand);
      newH.done = !dsa && !resplit(newH);
      if (atCap && !dsa) for (const h of hands) if (h.origin === hand.origin && h.splitAces) h.done = true;
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
