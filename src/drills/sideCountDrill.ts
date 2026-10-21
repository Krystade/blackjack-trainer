import type { Card } from '../engine/cards';
import { Shoe, snapDecksRemaining } from '../engine/cards';
import { hiLoTag, trueCount } from '../engine/count';
import type { TcRounding } from '../engine/count';
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
 * The run is drawn from a shoe of the PROFILE's size, so the depth the true
 * count divides by is the depth the bet is played at: the last question
 * names it ("2 decks left"), as the table's tray would show it.
 */

export type SideQuestion =
  | { kind: 'count'; count: 'side' | 'hilo'; actual: number }
  | { kind: 'bet'; actual: boolean; tc: number; decksLeft: number };

export interface SideStop {
  /** Group index the run stops after; the last group's stop is the run's end. */
  atGroup: number;
  /** Cards shown through that group. */
  cardsShown: number;
  questions: SideQuestion[];
}

export interface SideCountRun {
  groups: Card[][];
  stops: SideStop[];
}

export interface SideRunSpec {
  count: SideCountDef;
  plan: SidePlanLite;
  /** Decks in the shoe the run is cut from. */
  decks: number;
  cards: number;
  groupSize: 1 | 2 | 3;
  checkpoints: CheckpointFreq;
  withHiLo: boolean;
  seed: number;
  rounding?: TcRounding;
}

/** Hi-Lo first: it is the count already being kept, the side count rides on it. */
function countQuestions(spec: SideRunSpec, counter: SideCounter, hiLo: number): SideQuestion[] {
  const out: SideQuestion[] = [];
  if (spec.withHiLo) out.push({ kind: 'count', count: 'hilo', actual: hiLo });
  out.push({ kind: 'count', count: 'side', actual: counter.rc(spec.count) });
  return out;
}

export function makeSideCountRun(spec: SideRunSpec): SideCountRun {
  // At most the shoe less a deck, so the run ends with something left to divide by.
  const shoe = new Shoe({ decks: spec.decks, seed: spec.seed });
  const n = Math.max(1, Math.min(spec.cards, spec.decks * 52 - 26));
  const all: Card[] = [];
  for (let i = 0; i < n; i++) all.push(shoe.draw());
  const groups: Card[][] = [];
  for (let i = 0; i < all.length; i += spec.groupSize) groups.push(all.slice(i, i + spec.groupSize));

  const at = new Set(checkpointIndices(groups.length, spec.checkpoints, spec.seed ^ 0x5eed));
  const counter = new SideCounter();
  let hiLo = 0;
  let shown = 0;
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
    if (last) {
      const decksLeft = snapDecksRemaining(spec.decks * 52 - shown, spec.decks);
      const tc = trueCount(counter.rc(spec.count), decksLeft, spec.rounding);
      questions.push({ kind: 'bet', actual: sideExpected(spec.plan, tc), tc, decksLeft });
    }
    stops.push({ atGroup: i, cardsShown: shown, questions });
  });
  return { groups, stops };
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
