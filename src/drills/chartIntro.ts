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
}): boolean {
  const { stats, seen, eyesFree, voiceOn, search, e2e } = input;
  return (
    !seen &&
    !hasHandHistory(stats) &&
    !eyesFree &&
    !voiceOn &&
    (!e2e || new URLSearchParams(search).has('intro'))
  );
}

/** Blocked storage reads as "seen", so the screen can never loop. */
export function loadChartIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(CHART_INTRO_KEY) === '1';
  } catch {
    return true;
  }
}

export function saveChartIntroSeen(): void {
  try {
    window.localStorage.setItem(CHART_INTRO_KEY, '1');
  } catch {
    // Blocked storage: nothing to remember it in; load reads "seen" anyway.
  }
}
