import type { Card } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { signed } from './signed';
import { introAllowed } from './chartIntro';
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
  // T2-2A: from here the pace steps up as the count holds (countPaceRamp.ts).
  countPaceRamp: true,
};

/** T2-2B: the "Learn Hi-Lo" card's one-shot seen flag. */
export const HILO_INTRO_KEY = 'bjtrainer.hiLoIntro.v1';

/**
 * T2-2B: the "Learn Hi-Lo" card shows in place of the count drill's setup
 * once basic strategy is done and counting is not, to someone with no count
 * run on record (the Easy first run audience). Shared intro gate as well:
 * never in a car session, never on an autoStart (D6), `?intro` under e2e.
 *
 * `basicDone`/`countDone` are the ladder's own rung verdicts (homeLadder),
 * so the card and Home cannot disagree about where you are.
 */
export function hiLoIntroDue(input: {
  seen: boolean;
  basicDone: boolean;
  countDone: boolean;
  easyOffered: boolean;
  eyesFree: boolean;
  voiceOn: boolean;
  autoStart: boolean;
  search: string;
  e2e: boolean;
}): boolean {
  const { seen, basicDone, countDone, easyOffered, ...gate } = input;
  return !seen && basicDone && !countDone && easyOffered && introAllowed(gate);
}

/** The tap-along: six cards whose tags add back to 0. */
export const HILO_TAP_ALONG: readonly Card[] = [
  { rank: '5', suit: 'h' },
  { rank: 'K', suit: 's' },
  { rank: '9', suit: 'd' },
  { rank: '2', suit: 'c' },
  { rank: 'A', suit: 'h' },
  { rank: '7', suit: 's' },
];
