import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import {
  makeBetSitLeaveScenario,
  correctAction,
  explainAction,
} from '../../../drills/betSitLeave';
import type { BetSitLeaveScenario, TableAction } from '../../../drills/betSitLeave';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';
import { focusSwallowsKey } from '../../keyboardFocus';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

const ACTIONS: { key: TableAction; label: string }[] = [
  { key: 'bet', label: 'Bet' },
  { key: 'sit', label: 'Sit out' },
];

/**
 * ET3 (docs/BACKLOG.md): the bet / sit-out decision drill. A snapshot (true
 * count, decks remaining) → bet or sit out. #48-51 dropped the "leave"
 * answer. Grading = drills/betSitLeave.ts. Keyboard 1/2.
 */
export function BetSitLeaveView({
  settings,
  activeProfile,
  onBack,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
}) {
  // V4-3: the shoe is the profile's, not a hardcoded 6. See ProduceTcDrillView.
  const totalDecks = activeProfile.rules.decks;
  const audio = useAudio(settings.audio);
  const [scenario, setScenario] = useState<BetSitLeaveScenario>(() =>
    makeBetSitLeaveScenario(randomSeed(), totalDecks, activeProfile.spread),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; taken: TableAction } | null>(null);
  const shownAtRef = useRef(performance.now());

  const answer = (taken: TableAction) => {
    if (feedback) return;
    const correct = taken === correctAction(scenario, activeProfile.spread);
    setFeedback({ correct, taken });
    audio.ding(correct ? 'good' : 'bad');

    const stats = loadStats();
    saveStats({
      ...stats,
      betSitLeave: {
        history: [
          ...stats.betSitLeave.history,
          { date: new Date().toISOString(), taken, correctAction: correctAction(scenario, activeProfile.spread), correct },
        ],
      },
    });
  };

  const next = () => {
    setScenario(makeBetSitLeaveScenario(randomSeed(), totalDecks, activeProfile.spread));
    setFeedback(null);
    shownAtRef.current = performance.now();
  };

  // Keyboard: 1=Bet, 2=Sit Out; Enter/Space advances past feedback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (!feedback) {
        const idx = ['1', '2'].indexOf(e.key);
        if (idx >= 0) {
          e.preventDefault();
          answer(ACTIONS[idx].key);
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, scenario]);

  const dealtFraction = (totalDecks - scenario.decksRemaining) / totalDecks;
  const fillPct = Math.min(98, Math.max(2, dealtFraction * 100));
  const correct = correctAction(scenario, activeProfile.spread);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Bet or sit</div>
      </div>

      <div className="settings-row settings-note-row">
        From the true count and how much shoe is left: bet, or sit out?
      </div>

      <div className="bsl-snapshot">
        <div className="bsl-tc">TC {formatSigned(scenario.trueCount)}</div>
        <div className="table-discard-tray" aria-label="Discard tray">
          <span className="table-discard-label">Discard</span>
          <div className="table-discard-frame">
            <div className="table-discard-fill" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
        {/* V4-3: the shoe size is the profile's now, so the tray alone is
            ambiguous -- a half-full tray is 1 deck left in a 2-deck shoe
            and 3 in a 6-deck one. Same line DeckEstimationView carries. */}
        <div className="deck-tray-context">{totalDecks}-deck shoe</div>
      </div>

      <div className="message-strip">
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : `Wrong — ${ACTIONS.find((a) => a.key === correct)!.label}`}
            </div>
            <div className="bsl-explain">{explainAction(scenario, activeProfile.spread)}</div>
          </>
        )}
      </div>

      {!feedback ? (
        <div className="action-bar bsl-answers">
          {ACTIONS.map((a) => (
            <button key={a.key} type="button" className="action-btn" onClick={() => answer(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={next}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
