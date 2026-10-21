import type { Card } from '../engine/cards';
import { mulberry32, Shoe, snapDecksRemaining } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import type { SideCountDef } from '../engine/sideBets/counts';
import { SideCounter, sideExpected } from '../engine/sideBets/tableBet';
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
 * shuffled shoe either way: only WHICH shoe is used is chosen, by trying
 * seeds until one ends the way the coin asked (SEED_TRIES).
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

/** Shoes tried per run for the ending the coin asked for. */
export const SEED_TRIES = 600;
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
  const rng = mulberry32((spec.seed ^ 0x51de) >>> 0);
  const wantBet = rng() < 0.5;
  let fallback: Attempt | null = null;
  for (let k = 0; k < SEED_TRIES; k++) {
    const endAt = n + Math.floor(rng() * (deepest - n + 1));
    const a = attempt(spec, (spec.seed + Math.imul(k, 0x9e3779b1)) >>> 0, endAt, n);
    if (!a.speakable) continue;
    if (a.bet === wantBet && (wantBet || a.near)) return a.run;
    // No near miss to be had: the first ending the coin asked for, else the first speakable one.
    if (!fallback || (a.bet === wantBet && fallback.bet !== wantBet)) fallback = a;
  }
  return (fallback ?? attempt(spec, spec.seed, n, n)).run;
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
