import { CasinoSim } from '../casinoSim';
import type { SimSpec } from '../casinoSim';
import { snapDecksRemaining } from '../cards';
import type { RuleSet } from '../ruleset';
import { compTotal, rankCounts, suitCounts } from './comp';
import type { Comp } from './comp';
import { effectsOfRemoval } from './eor';
import { sideBetEv } from './odds';
import type { SideCountDef } from './counts';
import type { PayTable, SideBetId } from './payTables';

/**
 * Wave L: A SIDE BET, COUNTED, OVER SIMULATED SHOES.
 *
 * The cards come from the Wave K simulator (casinoSim.ts): the same shoes,
 * cut and rounds of solo basic-strategy play, with the shoe's composition
 * read before every round. Each round is scored by the bet's EXPECTED value
 * from that composition (odds.ts) rather than by the one outcome the cards
 * happened to make: the expectation is exactly what a bet placed then is
 * worth, and it carries none of the payout's luck -- a 1000-to-1 line would
 * otherwise need hundreds of millions of rounds to settle.
 *
 * Every count asked about is kept side by side on the same rounds: its true
 * count before the deal, and the bet's EV, binned by that count. From the
 * bins come the TRIGGER (the true count at which the bet's EV crosses zero)
 * and what betting only there earns.
 *
 * The seen cards are the cards gone from the shoe. The only card a counter
 * does not see is a hole card that is never turned (a round ended by the
 * player's natural, heads-up) -- under one card in a hundred.
 *
 * BUSTER: its exact value is a recursion over the dealer's draws (about ten
 * milliseconds), too slow for every round, so with `linear` the round is
 * priced by the effects of removal instead (Griffin's linear estimate: the
 * effects times how far each rank's share of the shoe has moved).
 * sideSim.test.ts measures that estimate against the exact value on real
 * deep-shoe compositions.
 */

export interface SideSimCount {
  def: SideCountDef;
  /** Bet when the true count is at or BELOW the trigger. */
  betBelow?: boolean;
}

export interface SideSimSpec {
  bet: SideBetId;
  pays: PayTable['pays'];
  rules: RuleSet;
  /** Decks left behind the cut. */
  cutDecks: number;
  counts: SideSimCount[];
  /** Price rounds by the linear estimate (see above); absent = exactly. */
  linear?: boolean;
}

export interface TcBin {
  tc: number;
  /** Rounds dealt at this true count. */
  n: number;
  /** Sum of the bet's EV per unit over those rounds. */
  ev: number;
}

/** True counts beyond this are pooled into the end bins. */
export const TC_BIN_CLAMP = 30;

/** Griffin's linear estimate of the bet's EV from a composition. */
export function linearEv(ev0: number, eor: readonly number[], decks: number, c: Comp): number {
  const n0 = 52 * decks;
  const n = compTotal(c);
  const ranks = rankCounts(c);
  let d = 0;
  for (let r = 0; r < 13; r++) d += eor[r]! * (ranks[r]! / n - (4 * decks) / n0);
  return ev0 - (n0 - 1) * d;
}

/** The count's running count from what has left the shoe (per-rank and per-suit counts left). */
export function sideRunningCount(def: SideCountDef, ranksLeft: readonly number[], suitsLeft: readonly number[], decks: number): number {
  if (def.kind === 'suit') {
    let hi = -Infinity;
    let lo = Infinity;
    for (const left of suitsLeft) {
      const seen = 13 * decks - left;
      if (seen > hi) hi = seen;
      if (seen < lo) lo = seen;
    }
    return hi - lo;
  }
  let rc = 0;
  for (let r = 0; r < 13; r++) rc += (def.tags?.[r] ?? 0) * (4 * decks - ranksLeft[r]!);
  return rc;
}

/** The count's true count before the deal, from what has left the shoe. Floored, as Play floors by default. */
export function sideTrueCount(def: SideCountDef, c: Comp, decks: number): number {
  const rc = sideRunningCount(def, rankCounts(c), suitCounts(c), decks);
  const tc = Math.floor(rc / snapDecksRemaining(compTotal(c), decks));
  return tc === 0 ? 0 : tc;
}

export class SideSim {
  readonly spec: SideSimSpec;
  readonly sim: CasinoSim;
  readonly bins: Map<number, TcBin>[];
  /** EV off the top of a fresh shoe, per unit. */
  readonly evTop: number;
  private readonly eor: number[] | null;
  rounds = 0;

  constructor(spec: SideSimSpec, seed: number) {
    this.spec = spec;
    const simSpec: SimSpec = {
      rules: spec.rules,
      cutDecks: spec.cutDecks,
      csm: false,
      unit: 1,
      maxBet: null,
      spread: [{ minTc: -99, units: 1 }],
      tcRounding: 'floor',
      indices: false,
      methods: [],
    };
    this.sim = new CasinoSim(simSpec, 'basic', seed >>> 0);
    this.sim.trackComposition();
    const decks = spec.rules.decks;
    const opts = { s17: spec.rules.s17 };
    this.eor = spec.linear ? effectsOfRemoval(spec.bet, spec.pays, decks, opts) : null;
    const full = new Int16Array(52).fill(decks);
    this.evTop = sideBetEv(spec.bet, spec.pays, full, opts);
    this.bins = spec.counts.map(() => new Map());
    this.sim.onPreDeal = () => this.score();
  }

  run(n: number): void {
    this.sim.run(n);
  }

  private score(): void {
    const c = this.sim.left!;
    const decks = this.spec.rules.decks;
    const ev = this.eor
      ? linearEv(this.evTop, this.eor, decks, c)
      : sideBetEv(this.spec.bet, this.spec.pays, c, { s17: this.spec.rules.s17 });
    this.rounds += 1;
    const ranks = rankCounts(c);
    const suits = suitCounts(c);
    const decksLeft = snapDecksRemaining(compTotal(c), decks);
    for (let i = 0; i < this.spec.counts.length; i++) {
      const raw = Math.floor(sideRunningCount(this.spec.counts[i]!.def, ranks, suits, decks) / decksLeft) || 0;
      const tc = Math.max(-TC_BIN_CLAMP, Math.min(TC_BIN_CLAMP, raw));
      const m = this.bins[i]!;
      const b = m.get(tc);
      if (b) {
        b.n += 1;
        b.ev += ev;
      } else m.set(tc, { tc, n: 1, ev });
    }
  }

  /** The bins of count `i`, ascending. */
  binsOf(i: number): TcBin[] {
    return [...this.bins[i]!.values()].sort((a, b) => a.tc - b.tc);
  }
}

/** Bins with fewer rounds than this are too thin to place a trigger on. */
export const MIN_BIN_ROUNDS = 400;

/**
 * The trigger: the true count from which the bet's EV is positive. Read off
 * the bins (each a mean EV), counting only bins with enough rounds: the
 * lowest count such that it and every populated count beyond it are >= 0
 * (for a count that bets low, the highest such count, looking down). Null
 * when no populated count gets there.
 */
export function findTrigger(bins: readonly TcBin[], betBelow = false, minN = MIN_BIN_ROUNDS): number | null {
  const ok = bins.filter((b) => b.n >= minN).sort((a, b) => a.tc - b.tc);
  const seq = betBelow ? [...ok].reverse() : ok;
  let trigger: number | null = null;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i]!.ev / seq[i]!.n >= 0) trigger = seq[i]!.tc;
    else break;
  }
  return trigger;
}

export interface CountedResult {
  trigger: number | null;
  /** Share of rounds the bet is made. */
  freq: number;
  /** Average EV per unit when made. */
  edge: number;
  /** Units won per 100 rounds dealt, betting one unit at or beyond the trigger. */
  per100: number;
}

/** What betting at the trigger earns over the simulated rounds. */
export function countedResult(bins: readonly TcBin[], rounds: number, trigger: number | null, betBelow = false): CountedResult {
  if (trigger === null || rounds === 0) return { trigger, freq: 0, edge: 0, per100: 0 };
  let n = 0;
  let ev = 0;
  for (const b of bins) {
    if (betBelow ? b.tc <= trigger : b.tc >= trigger) {
      n += b.n;
      ev += b.ev;
    }
  }
  return { trigger, freq: n / rounds, edge: n > 0 ? ev / n : 0, per100: (ev / rounds) * 100 };
}
