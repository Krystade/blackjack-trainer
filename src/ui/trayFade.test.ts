import { describe, expect, it } from 'vitest';
import { trayMarksShown } from './trayFade';
import { deckTcResult } from './screens/ladderRules';
import { EMPTY_STATS, type Stats } from '../store/types';

/** F6 (W2-18, D2): marks hide on target by the ladder's own rule, and come back off it. */
function withDeckRows(results: boolean[]): Stats {
  return {
    ...EMPTY_STATS,
    deckEstimation: {
      history: results.map((correct, i) => ({
        date: `2026-10-${String(1 + i).padStart(2, '0')}T12:00:00.000Z`,
        actualDecks: 3,
        guess: correct ? 3 : 1,
        errorDecks: correct ? 0 : 2,
        correct,
      })),
    },
  };
}

describe('tray auto-fade', () => {
  it('shows the marks with no deck-estimation history', () => {
    expect(trayMarksShown(EMPTY_STATS)).toBe(true);
  });

  it('hides them once the last 10 estimates are 8+ right (on target)', () => {
    const stats = withDeckRows([true, true, false, true, true, true, false, true, true, true]);
    expect(deckTcResult(stats).deck.passed).toBe(true);
    expect(trayMarksShown(stats)).toBe(false);
  });

  it('shows them again when deck estimation falls off target', () => {
    const on = new Array<boolean>(10).fill(true);
    const slipped = withDeckRows([...on, false, false, false]); // last 10: 7 right
    expect(deckTcResult(slipped).deck.passed).toBe(false);
    expect(trayMarksShown(slipped)).toBe(true);
  });

  it('nine right of nine is not yet judged on target', () => {
    expect(trayMarksShown(withDeckRows(new Array<boolean>(9).fill(true)))).toBe(true);
  });
});
