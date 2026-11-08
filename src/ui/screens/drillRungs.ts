import type { Ladder, NextStepKind, RungId } from './nextStep';
import { rungDone } from './nextStep';
import { BET_SIZING_DRILL } from './drills/betSizingCopy';

/**
 * Track 1 (1A): the Drills picker's learning-path labels, read off the Home
 * ladder. "Start here" on the drill for the current rung; "After: X" on a
 * drill whose rung is not reached yet. Labels, never locks -- every drill
 * still opens.
 */

/** The picker's drills (Drills.tsx `entry(...)` ids). */
export type PickerDrill =
  | 'flash'
  | 'mastery'
  | 'speed'
  | 'custom'
  | 'count'
  | 'paircancel'
  | 'deckest'
  | 'truecount'
  | 'producetc'
  | 'quiz'
  | 'mixed'
  | 'betsizing'
  | 'rulesdiff'
  | 'variant'
  | 'sidecount';

/**
 * The ladder rung each picker drill belongs to on the learning path; null =
 * off the path (other games and side counts), never labelled.
 *
 * Not drills/rungProgress.ts DRILL_RUNG, which says whose ANSWERS feed a
 * rung's figure (drillRungs.test.ts holds the two together): Produce the true
 * count feeds no rung's figure but is learned with the true count.
 */
export const PICKER_RUNG: Record<PickerDrill, RungId | null> = {
  flash: 'basic',
  speed: 'basic',
  mastery: 'repair',
  custom: 'repair',
  count: 'count',
  paircancel: 'count',
  deckest: 'tc',
  truecount: 'tc',
  producetc: 'tc',
  quiz: 'deviations',
  mixed: 'deviations',
  betsizing: 'betramp',
  rulesdiff: null,
  variant: null,
  sidecount: null,
};

/** The drill an "After:" label names for each rung. */
export const RUNG_DRILL_NAME: Record<Exclude<RungId, 'play'>, string> = {
  basic: 'Flashcards',
  repair: 'Mastery challenge',
  count: 'Count drill',
  tc: 'True count drill',
  deviations: 'Deviation quiz',
  betramp: BET_SIZING_DRILL,
};

export type DrillTag = { kind: 'start'; text: string } | { kind: 'after'; text: string };

/** Which picker drill a rung's Start opens. */
function drillForStart(kind: NextStepKind): PickerDrill | null {
  return kind === 'play' ? null : kind;
}

export function drillTag(drill: PickerDrill, lad: Ladder): DrillTag | null {
  const rung = PICKER_RUNG[drill];
  if (rung === null || lad.current === null) return null;
  const current = lad.rungs[lad.current]!;
  // Only the shoe left: its Start is Play, and every drill's rung is behind it.
  if (drillForStart(current.start.kind) === drill) {
    // The picker's Custom opens the editor; Home's Start fills it with Auto.
    return { kind: 'start', text: drill === 'custom' ? 'Start here: use Auto' : 'Start here' };
  }
  const at = lad.rungs.findIndex((r) => r.id === rung);
  if (at <= lad.current || rungDone(lad.rungs[at]!)) return null;
  // The nearest earlier rung still to do: what this drill comes after.
  for (let i = at - 1; i >= 0; i--) {
    const r = lad.rungs[i]!;
    if (!rungDone(r) && r.id !== 'play') return { kind: 'after', text: `After: ${RUNG_DRILL_NAME[r.id]}` };
  }
  return null;
}
