import type { GameResult } from '../store/casinoGameStats';
import { capOf, workFor } from './casinoAutoSim';
import { roundsText } from './casinoStatsText';

/** Wave Q: the stats card's line on where a game's run stands (GameStats.tsx). */

/** "the one-minute cap", "the 3-minute cap". */
function capText(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min === 1 ? 'the one-minute cap' : `the ${min}-minute cap`;
}

/**
 * What the run's state means. Review N2: "it firms up on its own" only when
 * it will: an estimate with time left, its key neither failed nor unsaved,
 * and no session holding the firming up.
 */
export type Hold = 'none' | 'session' | 'unsaved' | 'failed';
export function statusNote(r: GameResult, hold: Hold): string {
  switch (r.status) {
    case 'done':
      return 'Both targets met (house edge ±0.05%, best EV/hour ±10%).';
    case 'time':
      return `Stopped at ${capText(capOf(r))}; the intervals say how close it got.`;
    case 'budget':
      return 'Stopped at the test round budget.';
    default: {
      // An estimate that has had its time (a run stopped by hand before Wave Q) is as finished as one at the cap.
      if (workFor(r) === null) return `Stopped at ${capText(capOf(r))}; the intervals say how close it got.`;
      const est = `An estimate from ${roundsText(r.basicRounds + r.countRounds)} rounds`;
      if (hold === 'failed') return `${est}.`;
      if (hold === 'unsaved') return `${est}; it could not be saved, so it is not firmed up until there is room.`;
      if (hold === 'session') return `${est}; it firms up after this session.`;
      return `${est}; it firms up on its own while Casino is open.`;
    }
  }
}
