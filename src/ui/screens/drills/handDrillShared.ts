import type { CSSProperties } from 'react';
import type { Profile } from '../../../store/types';
import type { Action, DeviationId } from '../../../engine/deviations';
import { isIndexActive, indexSetFor } from '../../../engine/deviations';
import type { GradedEvent } from '../../../engine/grade';
import type { Card, Rank } from '../../../engine/cards';
import { strategyRulesFor } from '../../../store/profiles';
import { redundantForChart } from '../../../drills/deviationQuiz';
import { signed } from '../../../drills/signed';
import { ZONE_LABEL } from '../../../audio/zones';
import type { ZoneId } from '../../../audio/zones';
import type { HandResult } from '../../handResult';

/*
 * W2-25: what the three hand drills (Flashcards, Deviation quiz, Mixed) share
 * that is not a hook -- moved out of Drills.tsx unchanged.
 */

// Desktop keyboard input (operator request): number keys map onto the
// action-zone layout so a keypress grades identically to tapping the
// matching ActionBar button / ZonePad zone. Shared by FlashcardsView and
// DeviationQuizView's action items -- the insurance quiz variant uses its
// own 1=Take/2=Decline mapping instead (see DeviationQuizView's handler).
export const KEY_TO_ACTION: Record<string, Action> = {
  '1': 'hit',
  '2': 'stand',
  '3': 'double',
  '4': 'split',
  '5': 'surrender' };

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Wave A: a real minus sign (U+2212); 0 reads "+0" here, as before. */
export function formatSigned(n: number): string {
  return signed(n, { plusZero: true });
}

/* ---------------------------------------------------------------- */
/* Eyes-free (Task 9): shared zone-label echo for both drills.       */
/* ZONE_LABEL (src/audio/zones.ts) only covers the five action zones;*/
/* the insurance quiz's two-zone 'take'/'decline' variant isn't a    */
/* ZoneId, so this widens the lookup rather than editing zones.ts    */
/* (which is T8's file, already committed).                          */
/* ---------------------------------------------------------------- */

const INSURANCE_ZONE_LABEL: Record<'take' | 'decline', string> = {
  take: 'Take',
  decline: 'Decline' };

export function zoneLabel(zone: ZoneId | 'take' | 'decline'): string {
  if (zone === 'take' || zone === 'decline') return INSURANCE_ZONE_LABEL[zone];
  return ZONE_LABEL[zone];
}

/** What the self-check says the answer was, for an item whose answer is `correct`. */
export function answerLabelFor(correct: string): string {
  return correct === 'take-insurance'
    ? zoneLabel('take')
    : correct === 'decline-insurance'
      ? zoneLabel('decline')
      : zoneLabel(correct as ZoneId);
}

/** The take/decline zone a quiz answer string names, or the zone itself. */
export function zoneToTaken(zone: ZoneId | 'take' | 'decline'): string {
  return zone === 'take' ? 'take-insurance' : zone === 'decline' ? 'decline-insurance' : zone;
}

export function drillScreenStyle(padTop: number): CSSProperties {
  return { ['--zone-pad-top']: `${padTop}px` } as CSSProperties;
}

/* ---------------------------------------------------------------- */
/* B1 fast advance (#8, #10, #14, #17), shared by the three views.   */
/* ---------------------------------------------------------------- */

/** What the study chart is opened on: always a FROZEN hand, never the live
 *  card prop, so it cannot follow the drill onto the next hand (#10). */
export interface ChartTarget {
  cards: Card[] | null;
  up: Rank;
  graded?: { expected?: string; reason?: string; tc?: number };
}

export function chartTargetFrom(result: HandResult): ChartTarget {
  return {
    cards: result.cards,
    up: result.up,
    graded: { expected: result.expected, reason: result.reason, tc: result.tc ?? 0 },
  };
}

/** A graded answer on screen: the correction panel's contents. */
export interface AnswerFeedback {
  correct: boolean;
  correctAction?: Action;
  event: GradedEvent;
}

/* ---------------------------------------------------------------- */
/* Deviation quiz filter                                             */
/* ---------------------------------------------------------------- */

export function quizFilterArg(quizIndex: DeviationId | 'all'): DeviationId | undefined {
  return quizIndex === 'all' ? undefined : quizIndex;
}

/**
 * Get the active quiz filter, falling back to 'all' if the saved index is
 * inactive in the current ruleset.
 */
export function getActiveQuizFilter(quizIndex: DeviationId | 'all', activeProfile: Profile): DeviationId | 'all' {
  if (quizIndex === 'all') return 'all';
  const rules = strategyRulesFor(activeProfile);
  if (!isIndexActive(quizIndex, rules)) {
    return 'all';
  }
  // Wave A (s08): an index this profile's basic chart already plays is not
  // quizzed (drills/deviationQuiz.ts redundantForChart).
  const entry = indexSetFor(rules).find((d) => d.id === quizIndex);
  if (!entry || redundantForChart(entry, rules)) return 'all';
  return quizIndex;
}
