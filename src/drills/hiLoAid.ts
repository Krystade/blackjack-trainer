import type { Card } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { signed } from './signed';
import type { Settings, Stats } from '../store/types';

/**
 * Wave G, G1 (L-1): the count drill's beginner aid.
 *
 * "Show Hi-Lo values" prints each flashed card's tag under it -- +1, 0 or −1,
 * with a real minus -- and opens the result's run listing, which already
 * carries the running count after every card (E5). "Easy first run" is a
 * one-tap preset for someone who has never run the drill: one deck, slow,
 * values shown, and nothing else that makes a run harder.
 *
 * Screen only. Eyes-free narration is untouched, and the aid is not drawn
 * while eyes-free is on.
 */

/** "+1", "0", "−1". */
export function hiLoLabel(card: Pick<Card, 'rank'>): string {
  return signed(hiLoTag(card.rank));
}

/** The aid is drawn: the option is on and the run is not eyes-free. */
export function hiLoShown(drill: Pick<Settings['drill'], 'countShowHiLo'>, eyesFree: boolean): boolean {
  return drill.countShowHiLo === true && !eyesFree;
}

/**
 * Easy first run is offered only to someone with no count run on record --
 * neither an ordinary/Countdown run nor a Timed Challenge. One run of either
 * and it is gone for good.
 */
export function offersEasyFirstRun(stats: Pick<Stats, 'countDrill' | 'timedCount'>): boolean {
  return stats.countDrill.history.length === 0 && stats.timedCount.history.length === 0;
}

/** 2 s a card: well under the default 0.8 s, and inside the setup's 0.3–3 s stepper. */
export const EASY_INTERVAL_MS = 2000;

/** What Easy first run writes to the drill settings before it starts. */
export const EASY_FIRST_RUN: Partial<Settings['drill']> = {
  countLengthCards: 52,
  countGroup: 1,
  countIntervalMs: EASY_INTERVAL_MS,
  countManual: false,
  countTableMode: false,
  countShowHiLo: true,
  distractionFreq: 'off',
  countCheckpoints: 'off',
  countBias: 'none',
  messyCards: false,
  pacePressure: false,
};
