import type { Card, Rank } from '../../engine/cards';
import type { Profile } from '../../store/types';
import { Charts, highlightForHand } from '../screens/Charts';
import type { ChartHighlight } from '../screens/Charts';

/**
 * "Show me the table" (operator item #7): the strategy chart opened OVER a
 * graded mistake, ringed on the exact cell that mistake belongs to.
 *
 * An overlay rather than a navigation, deliberately. The drills and the table
 * hold live state — the card being corrected, the hand mid-round, the shoe —
 * and `App`'s router has no payload channel and remounts screens on entry, so
 * routing to Charts would throw that away and return the learner to an
 * unrelated card. The entire value of #7 is seeing the decision you just got
 * wrong sitting among its neighbours, then landing back on it; a round trip
 * through the router breaks both halves.
 *
 * Rendered as a fixed, opaque layer so the chart's own scrolling (it has a
 * horizontally scrollable table with a sticky label column) is unaffected by
 * whatever it happens to be covering.
 */

export interface StudyChartOverlayProps {
  activeProfile: Profile;
  /** The player hand being corrected. `null` for a hand with no chart row —
   * an insurance prompt, say — which opens the chart unhighlighted. */
  cards: Card[] | null;
  /** Dealer upcard. J/Q/K are normalized to the '10' column downstream. */
  dealerUp: Rank | null;
  /** False when splitting was not on the table, so a pair still resolves to
   * its hard/soft row rather than lighting a PAIRS cell that never applied. */
  canSplit?: boolean;
  onClose: () => void;
}

export function StudyChartOverlay({
  activeProfile,
  cards,
  dealerUp,
  canSplit,
  onClose,
}: StudyChartOverlayProps) {
  const highlight: ChartHighlight | undefined =
    cards && dealerUp
      ? (highlightForHand(cards, dealerUp, activeProfile.rules, { canSplit }) ?? undefined)
      : undefined;

  return (
    <div className="study-chart-overlay">
      <Charts
        activeProfile={activeProfile}
        highlight={highlight}
        // Back closes the overlay instead of routing Home; `onNavigate` is
        // never reached, but the prop is required by the screen's contract.
        onBack={onClose}
        onNavigate={onClose}
      />
    </div>
  );
}
