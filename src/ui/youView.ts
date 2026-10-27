/**
 * WAVE W: THE "YOU" TAB. Progress (streaks, the 12-week calendar, the
 * achievements) and Stats share one tab, with a two-way switch at the top.
 *
 * Jack asked to see his achievements "in a tab or something", and they lived
 * on a screen only Home's streak card opened. A seventh tab was measured
 * first: at 320 px each tab would be 45.7 px wide (53.3 now), "Progress"
 * would not fit its cell at all (47.7 px of label) and "Casino" bold would
 * sit 3 px from its neighbour. So the Stats tab became You instead.
 *
 * The two screens stay what they were (`'progress'` and `'stats'` in App), so
 * every way in -- Home's streak card, Home's stats link, Charts' "Back to
 * Stats" -- still lands where it did. The tab itself opens whichever of the
 * two was open last, on this device; Progress the first time.
 */

export type YouView = 'progress' | 'stats';

export const YOU_VIEWS: readonly YouView[] = ['progress', 'stats'];

const KEY = 'bjtrainer.youView.v1';

/** The screen the You tab opens: the last one shown, else Progress. */
export function lastYouView(): YouView {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'stats' ? 'stats' : 'progress';
  } catch {
    return 'progress';
  }
}

/** Remember which of the two is open (a per-device convenience: losing it costs one tap). */
export function rememberYouView(view: YouView): void {
  try {
    if (localStorage.getItem(KEY) !== view) localStorage.setItem(KEY, view);
  } catch {
    /* private mode or storage full: the tab opens Progress next time */
  }
}

/** Is this screen one of the You tab's two? */
export function isYouScreen(screen: string): screen is YouView {
  return (YOU_VIEWS as readonly string[]).includes(screen);
}
