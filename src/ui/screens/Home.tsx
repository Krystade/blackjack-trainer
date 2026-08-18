import type { Screen } from '../App';
import type { Profile } from '../../store/types';
import { loadStats } from '../../store/persist';
import { readiness, weakestCategories } from './readiness';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
  activeProfile: Profile;
}

const CATEGORY_LABEL: Record<string, string> = {
  hard: 'hard totals',
  soft: 'soft totals',
  pairs: 'pairs',
  surrender: 'surrender',
  insurance: 'insurance',
  bet: 'bet sizing',
  countCheck: 'count checks',
  wong: 'wong-outs',
};

function pct(n: number | null): string {
  return n === null ? '—' : `${Math.round(n)}%`;
}

function secs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Home as a dashboard (C4).
 *
 * It used to be five big buttons — a menu the bottom tab bar now renders
 * redundant. Freed of navigation, the launch screen can do the job only it
 * can: answer "am I ready?" before you decide what to practise, and name the
 * hands you are actually worst at rather than a single blended percentage.
 *
 * Stats keeps no tab of its own precisely because this exists; the full
 * breakdown hangs off the summary that made you want it.
 */
export function Home({ onNavigate, activeProfile }: HomeProps) {
  const stats = loadStats();
  const r = readiness(stats);
  const weak = weakestCategories(stats);

  return (
    <div className="home-screen">
      <header className="home-head">
        <h1 className="home-title">Blackjack Trainer</h1>
        <button type="button" className="home-profile-chip" onClick={() => onNavigate('profiles')}>
          {activeProfile.name}
        </button>
      </header>

      <section className="readiness" aria-label="Readiness">
        <div className="readiness-figures">
          <div className="readiness-stat">
            <span className="readiness-value">{pct(r.accuracyPct)}</span>
            <span className="readiness-label">accuracy</span>
          </div>
          <div className="readiness-stat">
            <span className="readiness-value">{secs(r.medianMs)}</span>
            <span className="readiness-label">median decision</span>
          </div>
          <div className="readiness-stat">
            <span className="readiness-value">
              {r.indicesKnown}/{r.indicesTotal}
            </span>
            <span className="readiness-label">indices seen</span>
          </div>
        </div>

        {r.decisions === 0 ? (
          <p className="u-note">
            No hands played yet. Start at the table, or drill the charts first.
          </p>
        ) : (
          <p className="u-note">
            {r.decisions} decisions graded
            {weak.length > 0 && (
              <> · weakest: {weak.map((w) => CATEGORY_LABEL[w] ?? w).join(', ')}</>
            )}
          </p>
        )}

        <button type="button" className="home-stats-link" onClick={() => onNavigate('stats')}>
          Full stats
        </button>
      </section>

      {/* Only the primary action lives here now. Drills and Charts are one
          tap away in the tab bar, and repeating them would make Home a menu
          again -- the exact thing the tab bar exists to replace. */}
      <div className="home-actions">
        <button type="button" className="u-btn u-btn-primary home-play-btn" onClick={() => onNavigate('table')}>
          Play a shoe
        </button>
      </div>
    </div>
  );
}
