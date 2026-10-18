import type { Stats } from '../store/types';
import { deckTcResult } from './screens/ladderRules';

/**
 * F6 (W2-18, D2): Play's discard tray drops its deck marks once deck
 * estimation is on target, and gets them back if it slips.
 *
 * Real trays have no marks. The marks are training wheels for reading depth
 * by eye; once the Deck estimation drill shows the eye is there, the table
 * should ask for it unaided. No setting (the low-friction rule): the rule is
 * the Home ladder's own for that rung -- the deck half of rung 4,
 * `deckTcResult(stats).deck.passed` (8 of the last 10 estimates right) --
 * so "on target" means the same thing on Home and at the table, and a run of
 * misses that unticks it on Home brings the marks back here.
 */
export function trayMarksShown(stats: Stats): boolean {
  return !deckTcResult(stats).deck.passed;
}
