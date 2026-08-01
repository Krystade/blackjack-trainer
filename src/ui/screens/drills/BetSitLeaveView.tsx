import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import {
  makeBetSitLeaveScenario,
  correctAction,
  explainAction,
} from '../../../drills/betSitLeave';
import type { BetSitLeaveScenario, TableAction } from '../../../drills/betSitLeave';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

const ACTIONS: { key: TableAction; label: string }[] = [
  { key: 'bet', label: 'Bet' },
  { key: 'sit', label: 'Sit Out' },
  { key: 'leave', label: 'Leave' },
];
const TOTAL_DECKS = 6;

/**
 * ET3 (docs/BACKLOG.md): the bet / sit-out / leave decision drill. A snapshot
 * (true count, decks remaining, whether a fresh table is open) → pick the
 * consensus-correct table action. Adds the LEAVE axis R5's wong-out drill can't
 * express. Grading = drills/betSitLeave.ts (the researched consensus rule).
 * Continuous flow like the other decision drills; keyboard 1/2/3.
 */
export function BetSitLeaveView({ settings, onBack }: { settings: Settings; onBack: () => void }) {
  const audio = useAudio(settings.audio);
  const [scenario, setScenario] = useState<BetSitLeaveScenario>(() => makeBetSitLeaveScenario(randomSeed()));
  const [feedback, setFeedback] = useState<{ correct: boolean; taken: TableAction } | null>(null);
  const shownAtRef = useRef(performance.now());

  const answer = (taken: TableAction) => {
    if (feedback) return;
    const correct = taken === correctAction(scenario);
    setFeedback({ correct, taken });
    audio.ding(correct ? 'good' : 'bad');

    const stats = loadStats();
    saveStats({
      ...stats,
      betSitLeave: {
        history: [
          ...stats.betSitLeave.history,
          { date: new Date().toISOString(), taken, correctAction: correctAction(scenario), correct },
        ],
      },
    });
  };

  const next = () => {
    setScenario(makeBetSitLeaveScenario(randomSeed()));
    setFeedback(null);
    shownAtRef.current = performance.now();
  };

  // Keyboard: 1=Bet, 2=Sit Out, 3=Leave; Enter/Space advances past feedback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!feedback) {
        const idx = ['1', '2', '3'].indexOf(e.key);
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

  const dealtFraction = (TOTAL_DECKS - scenario.decksRemaining) / TOTAL_DECKS;
  const fillPct = Math.min(98, Math.max(2, dealtFraction * 100));
  const correct = correctAction(scenario);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Bet / Sit / Leave</div>
      </div>

      <div className="settings-row settings-note-row">
        Given the count, how deep the shoe is, and whether another table is open — what do you do?
      </div>

      <div className="bsl-snapshot">
        <div className="bsl-tc">TC {formatSigned(scenario.trueCount)}</div>
        <div className="table-discard-tray" aria-label="Discard tray">
          <span className="table-discard-label">Discard</span>
          <div className="table-discard-frame">
            <div className="table-discard-fill" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
        <div className={`bsl-freshshoe ${scenario.freshShoe ? 'bsl-fresh-yes' : 'bsl-fresh-no'}`}>
          {scenario.freshShoe ? 'Another table is open' : 'No other table open'}
        </div>
      </div>

      <div className="message-strip">
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : `Wrong — ${ACTIONS.find((a) => a.key === correct)!.label}`}
            </div>
            <div className="bsl-explain">{explainAction(scenario)}</div>
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
