import { useEffect, useRef } from 'react';
import type { Profile } from '../../../store/types';
import { Charts } from '../Charts';
import './chartIntro.css';

/**
 * B7: shown once, on the first Flashcards launch by someone who has never
 * answered a hand. Three lines on how to read the chart, then the real chart
 * with one cell ringed as the example. Both Start quiz buttons call onStart.
 */
export function ChartIntro({
  activeProfile,
  onStart,
  onBack,
}: {
  activeProfile: Profile;
  onStart: () => void;
  onBack: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  // Charts scrolls its ringed cell into view on mount (a child effect, so it
  // runs first). Here the explanation and Start quiz lead, so put the layer
  // back at the top; the ringed cell is a scroll below.
  useEffect(() => {
    if (layerRef.current) layerRef.current.scrollTop = 0;
  }, []);
  return (
    <div className="chart-intro" data-testid="chart-intro" ref={layerRef}>
      <div className="chart-intro-head">
        <div className="drill-topbar">
          <button type="button" className="drill-back-btn" onClick={onBack}>
            Back
          </button>
          <div className="drill-heading">Flashcards</div>
        </div>
        <section className="chart-intro-card">
          <h2>How to read the chart</h2>
          <ol>
            <li>1. Find your hand. Pairs first, then soft hands (an ace counted as 11), then hard totals.</li>
            <li>2. Go across to the dealer's card.</li>
            <li>3. The letter in that box is your play. A second letter is the play when the first isn't allowed.</li>
          </ol>
          <button type="button" className="chart-intro-start" onClick={onStart}>
            Start quiz
          </button>
        </section>
      </div>
      <Charts
        activeProfile={activeProfile}
        onNavigate={() => {}}
        highlight={{ section: 'HARD', row: 16, dealerUp: '10' }}
        note="Example: hard 16 against a 10 is ringed."
        onBack={onStart}
        backText="Start quiz"
        backPlacement="floating"
      />
    </div>
  );
}
