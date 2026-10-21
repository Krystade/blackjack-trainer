import type { Card } from '../engine/cards';
import { mulberry32, Shoe, snapDecksRemaining } from '../engine/cards';
import { hiLoTag, trueCount } from '../engine/count';
import { RANK_INDEX, SUIT_INDEX } from '../engine/sideBets/comp';
import type { SideCountDef } from '../engine/sideBets/counts';
import { SIDE_TC_ROUNDING, SideCounter, sideExpected } from '../engine/sideBets/tableBet';
import type { SidePlanLite } from '../engine/sideBets/tableBet';
import { checkpointIndices } from './countCheckpoints';
import type { CheckpointFreq } from './countCheckpoints';

/**
 * Wave L: the side count drill. The count drill's run -- a seeded slice of a
 * shoe, flashed in groups, stopped at seeded checkpoints (countCheckpoints.ts)
 * -- kept with the side bet's count instead of (or as well as) Hi-Lo, and
 * closed with the question the count exists for: bet the side or not, at the
 * true count the run ends on.
 *
 * Review S6: PICKED UP MID-SHOE, so that question means something. A side
 * bet's trigger is deep: from a fresh six-deck shoe no Lucky Ladies, Over 13,
 * Buster or 21+3 run of 26 cards reached it, so "no bet" was right every
 * time. Now the run's END is drawn from the game's real dealing range (the
 * profile's shoe, down to its cut); the cards dealt before the run are not
 * shown but summed into a STARTING count the run opens with -- the counts so
 * far, and the decks left -- and the run is counted on from there. Half the
 * runs (by the seed) are chosen to end where the count says bet, half where
 * it says no bet, that half within NEAR_TRIGGER of the trigger when it can
 * be, so it is a real call and not a count near zero. The cards are a genuine
 * shuffled shoe either way: only WHICH shoe, and where it ends, is chosen.
 * The end depth is drawn without the coin and kept only when a pool of shoes
 * (SEED_TRIES) deals both endings there (re-review R1), so the decks left do
 * not give the answer away.
 *
 * A suit count cannot be carried as one number (the spread depends on which
 * suit is high), so its start is the four suit tallies, each above the lowest.
 *
 * The true count the bet is decided on is floored (SIDE_TC_ROUNDING), the
 * rounding the trigger was simulated under.
 */

export type SideQuestion =
  | { kind: 'count'; count: 'side' | 'hilo'; actual: number }
  | { kind: 'bet'; actual: boolean; tc: number; decksLeft: number };

export interface SideStop {
  /** Group index the run stops after; the last group's stop is the run's end. */
  atGroup: number;
  /** Cards shown through that group (the run's own cards, not the start's). */
  cardsShown: number;
  questions: SideQuestion[];
}

/** Where the run picks the shoe up: what was dealt before its first card. */
export interface SideStart {
  /** Cards dealt (not shown) before the run; 0 = a fresh shoe. */
  dealt: number;
  /** Decks left when the run starts, as the tray shows it. */
  decksLeft: number;
  /** A tag count's running count so far (0 for a suit count). */
  sideRc: number;
  /** A suit count's tallies so far (spades, hearts, diamonds, clubs), each above the lowest; null for a tag count. */
  suits: number[] | null;
  /** Hi-Lo's running count so far. */
  hiLoRc: number;
}

export interface SideCountRun {
  start: SideStart;
  groups: Card[][];
  stops: SideStop[];
}

export interface SideRunSpec {
  count: SideCountDef;
  plan: SidePlanLite;
  /** Decks in the shoe the run is cut from. */
  decks: number;
  /** Decks behind the cut: the run ends no deeper than this. Absent = half a deck. */
  cutDecks?: number;
  cards: number;
  groupSize: 1 | 2 | 3;
  checkpoints: CheckpointFreq;
  withHiLo: boolean;
  seed: number;
}

/** Shoes in a run's pool, each tried at every depth for both endings. */
export const SEED_TRIES = 400;
/** Depths tried before falling back to whatever ending was found. */
export const DEPTH_TRIES = 40;
/** A no-bet ending within this many true counts of the trigger is "near". */
export const NEAR_TRIGGER = 2;
/**
 * The widest count the run may ask or start on: the side lines' recorded
 * range (sideBetFeedback.ts SIDE_COUNT_SPOKEN_MAX, which a test holds equal).
 * Kept here so the drill does not import the UI layer.
 */
export const RUN_COUNT_MAX = 40;

/** Hi-Lo first: it is the count already being kept, the side count rides on it. */
function countQuestions(spec: SideRunSpec, counter: SideCounter, hiLo: number): SideQuestion[] {
  const out: SideQuestion[] = [];
  if (spec.withHiLo) out.push({ kind: 'count', count: 'hilo', actual: hiLo });
  out.push({ kind: 'count', count: 'side', actual: counter.rc(spec.count) });
  return out;
}

interface Attempt {
  run: SideCountRun;
  bet: boolean;
  near: boolean;
  speakable: boolean;
}

function attempt(spec: SideRunSpec, shoeSeed: number, endAt: number, n: number): Attempt {
  const shoe = new Shoe({ decks: spec.decks, seed: shoeSeed });
  const counter = new SideCounter();
  let hiLo = 0;
  const dealt = endAt - n;
  for (let i = 0; i < dealt; i++) {
    const c = shoe.draw();
    counter.see(c);
    hiLo += hiLoTag(c.rank);
  }
  const suit = spec.count.kind === 'suit';
  const low = Math.min(...counter.suits);
  const start: SideStart = {
    dealt,
    decksLeft: snapDecksRemaining(spec.decks * 52 - dealt, spec.decks),
    sideRc: suit ? 0 : counter.rc(spec.count),
    suits: suit ? [...counter.suits].map((x) => x - low) : null,
    hiLoRc: hiLo,
  };
  let speakable = Math.abs(start.sideRc) <= RUN_COUNT_MAX && Math.abs(hiLo) <= RUN_COUNT_MAX && (start.suits ?? []).every((x) => x <= RUN_COUNT_MAX);

  const all: Card[] = [];
  for (let i = 0; i < n; i++) all.push(shoe.draw());
  const groups: Card[][] = [];
  for (let i = 0; i < all.length; i += spec.groupSize) groups.push(all.slice(i, i + spec.groupSize));

  const at = new Set(checkpointIndices(groups.length, spec.checkpoints, spec.seed ^ 0x5eed));
  let shown = 0;
  let bet = false;
  let near = false;
  const stops: SideStop[] = [];
  groups.forEach((g, i) => {
    for (const c of g) {
      counter.see(c);
      hiLo += hiLoTag(c.rank);
    }
    shown += g.length;
    const last = i === groups.length - 1;
    if (!last && !at.has(i)) return;
    const questions = countQuestions(spec, counter, hiLo);
    for (const q of questions) if (q.kind === 'count' && Math.abs(q.actual) > RUN_COUNT_MAX) speakable = false;
    if (last) {
      const decksLeft = snapDecksRemaining(spec.decks * 52 - dealt - shown, spec.decks);
      const tc = counter.tc(spec.count, decksLeft);
      bet = sideExpected(spec.plan, tc);
      near = spec.plan.trigger !== null && Math.abs(tc - spec.plan.trigger) <= NEAR_TRIGGER;
      questions.push({ kind: 'bet', actual: bet, tc, decksLeft });
    }
    stops.push({ atGroup: i, cardsShown: shown, questions });
  });
  return { run: { start, groups, stops }, bet, near, speakable };
}

export function makeSideCountRun(spec: SideRunSpec): SideCountRun {
  const total = spec.decks * 52;
  // The deepest the bet can be decided: at the cut, with something left to divide by.
  const behindCut = Math.max(26, Math.round((spec.cutDecks ?? 0.5) * 52));
  const deepest = Math.max(1, total - behindCut);
  const n = Math.max(1, Math.min(spec.cards, deepest));
  // A plan that bets every hand, or never, has no call to make: a fresh shoe.
  if (spec.plan.always || spec.plan.trigger === null) return attempt(spec, spec.seed, n, n).run;
  const wantBet = mulberry32((spec.seed ^ 0x51de) >>> 0)() < 0.5;
  // Re-review R1: the depth must not depend on the answer, or "decks left"
  // answers the question without a count (a fresh depth per try, kept on the
  // first try that matched the coin, put bet runs ~1 deck deeper). So a depth
  // is drawn without the coin and kept only when BOTH endings can be dealt at
  // it -- a bet and a near no-bet, from the same pool of shoes -- and only then
  // does the coin pick one. Which depths survive is the same for both answers.
  const depths = mulberry32((spec.seed ^ 0xde97) >>> 0);
  const pool: Prefix[] = [];
  const shoeAt = (k: number): Prefix => (pool[k] ??= prefixOf(spec, (spec.seed + Math.imul(k, 0x9e3779b1)) >>> 0, deepest));
  let fallback: { k: number; endAt: number } | null = null;
  for (let d = 0; d < DEPTH_TRIES; d++) {
    const endAt = n + Math.floor(depths() * (deepest - n + 1));
    let yes: Attempt | null = null;
    let no: Attempt | null = null;
    for (let k = 0; k < SEED_TRIES && !(yes && no); k++) {
      const p = shoeAt(k);
      const end = quickEnding(spec, p, endAt, n);
      if (end === null || (end === 'bet' ? yes : no)) continue;
      // Dealt in full: the quick look checks the start and the end, the run checks every stop.
      const a = attempt(spec, p.seed, endAt, n);
      if (!a.speakable || a.bet !== (end === 'bet')) continue;
      if (a.bet) yes = a;
      else no = a;
      if (!fallback && a.bet === wantBet) fallback = { k, endAt };
    }
    if (yes && no) return (wantBet ? yes : no).run;
  }
  // No depth deals both: the first ending the coin asked for, else a fresh shoe.
  return fallback ? attempt(spec, shoeAt(fallback.k).seed, fallback.endAt, n).run : attempt(spec, spec.seed, n, n).run;
}

/** One shuffled shoe's counts after each card, so a depth is tested without dealing it again. */
interface Prefix {
  seed: number;
  /** A tag count's running count after i cards (null for a suit count). */
  side: Int16Array | null;
  /** A suit count's four tallies after i cards, at [4i .. 4i+3] (null for a tag count). */
  suits: Int16Array | null;
  hiLo: Int16Array;
}

function prefixOf(spec: SideRunSpec, seed: number, upto: number): Prefix {
  const shoe = new Shoe({ decks: spec.decks, seed });
  const tags = spec.count.kind === 'suit' ? null : (spec.count.tags ?? []);
  const side = tags ? new Int16Array(upto + 1) : null;
  const suits = tags ? null : new Int16Array(4 * (upto + 1));
  const hiLo = new Int16Array(upto + 1);
  for (let i = 0; i < upto; i++) {
    const c = shoe.draw();
    hiLo[i + 1] = hiLo[i]! + hiLoTag(c.rank);
    if (side) side[i + 1] = side[i]! + (tags![RANK_INDEX[c.rank]] ?? 0);
    if (suits) {
      for (let s = 0; s < 4; s++) suits[4 * (i + 1) + s] = suits[4 * i + s]!;
      suits[4 * (i + 1) + SUIT_INDEX[c.suit]]! += 1;
    }
  }
  return { seed, side, suits, hiLo };
}

/** The side count after `at` cards: the running count, or a suit count's spread. */
function sideAt(p: Prefix, at: number): number {
  if (p.side) return p.side[at]!;
  const s = p.suits!;
  const t = [s[4 * at]!, s[4 * at + 1]!, s[4 * at + 2]!, s[4 * at + 3]!];
  return Math.max(...t) - Math.min(...t);
}

/** How a run ending after `endAt` cards would end -- 'bet', 'near' (a near no-bet) or null -- from the start and end counts alone. */
function quickEnding(spec: SideRunSpec, p: Prefix, endAt: number, n: number): 'bet' | 'near' | null {
  const start = endAt - n;
  if (Math.abs(sideAt(p, start)) > RUN_COUNT_MAX || Math.abs(p.hiLo[start]!) > RUN_COUNT_MAX) return null;
  if (Math.abs(sideAt(p, endAt)) > RUN_COUNT_MAX || (spec.withHiLo && Math.abs(p.hiLo[endAt]!) > RUN_COUNT_MAX)) return null;
  const tc = trueCount(sideAt(p, endAt), snapDecksRemaining(spec.decks * 52 - endAt, spec.decks), SIDE_TC_ROUNDING);
  if (sideExpected(spec.plan, tc)) return 'bet';
  return spec.plan.trigger !== null && Math.abs(tc - spec.plan.trigger) <= NEAR_TRIGGER ? 'near' : null;
}

/** The side count the run starts from: the running count, or a suit count's spread. */
export function startSideCount(start: SideStart): number {
  return start.suits ? Math.max(...start.suits) - Math.min(...start.suits) : start.sideRc;
}

/** One answer: right when it is the actual value. */
export function gradeSideAnswer(q: SideQuestion, answer: number | boolean): boolean {
  return q.kind === 'count' ? answer === q.actual : answer === q.actual;
}

/** "1½", "2" -- decks left, as the bet question shows them. */
export function decksText(d: number): string {
  const whole = Math.floor(d);
  const frac = d - whole;
  const f = frac === 0.5 ? '½' : frac === 0.25 ? '¼' : frac === 0.75 ? '¾' : '';
  return whole === 0 && f ? f : `${whole}${f}`;
}
