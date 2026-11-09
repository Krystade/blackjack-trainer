import type { Stats } from '../store/types';

/**
 * B7: the first Flashcards launch shows "How to read the chart" once.
 * Its own localStorage key, like CHART_ORDER_KEY: not a Settings or Profile field.
 */
export const CHART_INTRO_KEY = 'bjtrainer.chartIntro.v1';

/** Any answered hand at all: a cell tally, or a non-empty recent window. */
export function hasHandHistory(stats: Stats): boolean {
  if (stats.cellStats && Object.keys(stats.cellStats).length > 0) return true;
  const recent = stats.handRecent;
  return !!recent && Object.values(recent).some((w) => typeof w === 'string' && w.length > 0);
}

export function chartIntroDue(input: {
  stats: Stats;
  seen: boolean;
  eyesFree: boolean;
  voiceOn: boolean;
  search: string;
  e2e: boolean;
  /** D6: a guided or Drive launch. Optional so the existing caller is unchanged. */
  autoStart?: boolean;
}): boolean {
  const { stats, seen, eyesFree, voiceOn, search, e2e, autoStart = false } = input;
  return !seen && !hasHandHistory(stats) && introAllowed({ eyesFree, voiceOn, autoStart, search, e2e });
}

/**
 * T2-2B: one-shot "seen" flags for the first-run intros (the chart intro, the
 * Hi-Lo card, the worked examples). Each has its own key; blocked storage
 * reads as "seen", so an intro can never loop.
 */
export function loadIntroSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return true;
  }
}

export function saveIntroSeen(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Blocked storage: nothing to remember it in; load reads "seen" anyway.
  }
}

/**
 * T2-2B, D6: the gate every first-run intro shares. Never in a car session
 * (eyes-free or voice), never on an autoStart (guided or Drive -- the run
 * starts itself and an intro would sit in front of it), and under the e2e
 * harness only when the URL asks for it with `?intro`.
 */
export function introAllowed(input: {
  eyesFree: boolean;
  voiceOn: boolean;
  autoStart: boolean;
  search: string;
  e2e: boolean;
}): boolean {
  const { eyesFree, voiceOn, autoStart, search, e2e } = input;
  return !eyesFree && !voiceOn && !autoStart && (!e2e || new URLSearchParams(search).has('intro'));
}

/** Blocked storage reads as "seen", so the screen can never loop. */
export function loadChartIntroSeen(): boolean {
  return loadIntroSeen(CHART_INTRO_KEY);
}

export function saveChartIntroSeen(): void {
  saveIntroSeen(CHART_INTRO_KEY);
}
