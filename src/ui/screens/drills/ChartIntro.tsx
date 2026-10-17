import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../../store/types';
import { Charts } from '../Charts';
import { FloatingBackPill } from '../../components/FloatingBackPill';
import './chartIntro.css';
import '../../components/insetLayers.css';

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
  // #55: the floating Start quiz only once the card's own one has scrolled
  // away. At rest it sat over the cell-code legend, doubling a button that
  // was already on screen.
  const startRef = useRef<HTMLButtonElement>(null);
  const [cardStartGone, setCardStartGone] = useState(false);
  useEffect(() => {
    const target = startRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([entry]) => setCardStartGone(!entry!.isIntersecting), {
      root: layerRef.current,
    });
    obs.observe(target);
    return () => obs.disconnect();
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
            {/* #54: the lookup order, with where each chart is -- they run
                Hard, Soft, Pairs down the page. */}
            <li>
              1. Find your hand. A pair? Pairs (the last chart). An ace counted as 11? Soft totals. Anything else:
              Hard totals (the first chart).
            </li>
            <li>2. Go across to the dealer's card.</li>
            <li>3. The letter in that box is your play. A second letter is the play when the first isn't allowed.</li>
          </ol>
          <button type="button" className="chart-intro-start" onClick={onStart} ref={startRef}>
            Start quiz
          </button>
        </section>
      </div>
      <Charts
        activeProfile={activeProfile}
        onNavigate={() => {}}
        highlight={{ section: 'HARD', row: 16, dealerUp: '10' }}
        note="Example: hard 16 against a 10 is ringed."
        backPlacement="none"
      />
      {cardStartGone && <FloatingBackPill label="Start quiz" onClick={onStart} forward />}
    </div>
  );
}
