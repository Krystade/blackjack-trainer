import { useEffect, useRef, useState } from 'react';
import type { Settings, Profile } from '../../../store/types';
import type { Action } from '../../../engine/deviations';
import type { GradedEvent } from '../../../engine/grade';
import {
  startMasteryRun,
  advanceMasteryRun,
  isMasteryRunComplete,
  currentCellId,
  cellsForScope,
  loadMasteryRun,
  saveMasteryRun,
  hydrateMasteryRun,
} from '../../../drills/masteryChallenge';
import type { MasteryRun, MasteryScope } from '../../../drills/masteryChallenge';
import { gradeMasteryAnswer } from '../../../drills/gradeAnswer';
import { gateDrillAnswer } from '../../../drills/answerGate';
import { drillLegalActions } from '../../../drills/legalActions';
import { isDistractionPoint, makeDistraction } from '../../../drills/distraction';
import type { Distraction } from '../../../drills/distraction';
import { correctPlay } from '../../../engine/strategy';
import { saveSettings } from '../../../store/persist';
import { PlayingCard } from '../../components/PlayingCard';
import { ActionBar } from '../../components/ActionBar';
import { MistakeCard } from '../../components/MistakeCard';
import { StudyChartOverlay } from '../../components/StudyChartOverlay';
import { Segmented } from '../Settings';
import { KEY_TO_ACTION } from '../Drills';
import { focusSwallowsKey } from '../../keyboardFocus';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function scopeLabel(scope: MasteryScope): string {
  return scope === 'all' ? 'All' : scope.charAt(0).toUpperCase() + scope.slice(1);
}

/**
 * Mastery Challenge (operator request): walk EVERY cell in a chosen scope
 * (Hard / Soft / Pairs / All), in random order, exactly once, and get every
 * single one right. One wrong answer wipes the run -- back to zero, with a
 * fresh shuffle. All the sequencing logic lives in the pure
 * drills/masteryChallenge.ts state machine and is unit-tested there; this
 * view is wiring only. Visual-only (D7, plan doc) -- no eyes-free ZonePad or
 * narration, matching PairCancelView's precedent.
 */
export function MasteryChallengeView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [run, setRun] = useState<MasteryRun>(() => {
    const persisted = loadMasteryRun();
    return hydrateMasteryRun(persisted) ?? startMasteryRun('all', randomSeed());
  });

  useEffect(() => {
    saveMasteryRun(run);
  }, [run]);

  const cellMap = useRef(new Map(cellsForScope(run.scope).map((c) => [c.id, c])));
  useEffect(() => {
    cellMap.current = new Map(cellsForScope(run.scope).map((c) => [c.id, c]));
  }, [run.scope]);

  const cellId = currentCellId(run);
  const cell = cellId ? cellMap.current.get(cellId) : undefined;
  const complete = isMasteryRunComplete(run);

  const cellCorrectAction: Action | undefined = cell
    ? correctPlay(cell.cards, cell.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, activeProfile.rules)
        .action
    : undefined;

  const [feedback, setFeedback] = useState<{
    correct: boolean;
    event: GradedEvent;
    reset: boolean; // true when this wrong answer just wiped the run
  } | null>(null);
  const [distraction, setDistraction] = useState<Distraction | null>(null);
  const [showChart, setShowChart] = useState(false);
  const promptShownAtRef = useRef(performance.now());

  const changeScope = (scope: MasteryScope) => {
    const fresh = startMasteryRun(scope, randomSeed());
    setRun(fresh);
    setFeedback(null);
    setDistraction(null);
    promptShownAtRef.current = performance.now();
  };

  const changeDistractionFreq = (masteryDistractionFreq: Settings['drill']['masteryDistractionFreq']) => {
    const next: Settings = { ...settings, drill: { ...settings.drill, masteryDistractionFreq } };
    saveSettings(next);
    onSettingsChange(next);
  };

  const maybeTriggerDistraction = (nextRun: MasteryRun) => {
    // D4a: always 'generic' -- there is no running count in this drill for a
    // 'near-count' distraction to be near.
    if (isDistractionPoint(nextRun.index, settings.drill.masteryDistractionFreq)) {
      setDistraction(makeDistraction(0, 'generic', randomSeed()));
    }
  };

  const handleAction = (taken: Action) => {
    if (!cell || complete || !cellCorrectAction) return;
    const gate = gateDrillAnswer(taken, cell.cards, activeProfile.rules);
    if (!gate.accepted) return; // D3: refused answers never reach grading or the run

    const elapsedMs = performance.now() - promptShownAtRef.current;
    const flashcardShapedCell = { cards: cell.cards, up: cell.up, correct: cellCorrectAction, cellId: cell.id };
    const { event, correct } = gradeMasteryAnswer(flashcardShapedCell, taken, activeProfile.rules, elapsedMs);

    const nextRun = advanceMasteryRun(run, correct, randomSeed());
    setFeedback({ correct, event, reset: !correct });
    setRun(nextRun);
    if (correct && !isMasteryRunComplete(nextRun)) maybeTriggerDistraction(nextRun);
  };

  const next = () => {
    setFeedback(null);
    promptShownAtRef.current = performance.now();
  };

  const answerDistraction = (_guess: number) => {
    // The distraction's own right/wrong is telemetry only (D4b) -- it never
    // touches `run`. Recording into Stats.distraction.history is a follow-up
    // nicety, not required for this plan's minimum scope.
    setDistraction(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (showChart || distraction) return;
      if (!feedback) {
        const action = KEY_TO_ACTION[e.key];
        if (!action || !cell) return;
        e.preventDefault();
        if (gateDrillAnswer(action, cell.cards, activeProfile.rules).accepted) handleAction(action);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, cell, showChart, distraction]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Mastery Challenge</div>
      </div>

      <div className="drill-inline-controls">
        <div className="settings-row">
          <span className="settings-label">Scope</span>
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pairs', label: 'Pairs' },
            ]}
            value={run.scope}
            onChange={changeScope}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Interruptions</span>
          <Segmented
            options={[
              { value: 'off', label: 'Off' },
              { value: 'occasional', label: 'Occasional' },
              { value: 'relentless', label: 'Relentless' },
            ]}
            value={settings.drill.masteryDistractionFreq}
            onChange={changeDistractionFreq}
          />
        </div>
        {/* "Check progress" (operator ask): always-visible, live count. */}
        <div className="mastery-progress" data-testid="mastery-progress">
          {run.index} / {run.order.length} cleared &middot; {scopeLabel(run.scope)}
        </div>
      </div>

      {complete ? (
        <div className="mastery-complete">
          <div className="result-correct">
            Sweep complete! {run.order.length}/{run.order.length}, zero errors.
          </div>
          <button
            type="button"
            className="drill-next-btn"
            onClick={() => {
              const fresh = startMasteryRun(run.scope, randomSeed());
              setRun(fresh);
              setFeedback(null);
            }}
          >
            Start a new sweep
          </button>
        </div>
      ) : distraction ? (
        <div className="distraction-area">
          <div className="distraction-prompt">{distraction.prompt}</div>
          <button type="button" className="drill-next-btn" onClick={() => answerDistraction(distraction.answer)}>
            Continue
          </button>
        </div>
      ) : (
        cell && (
          <>
            <div className="dealer-area">
              <PlayingCard card={{ rank: cell.up, suit: 's' }} />
            </div>
            <div className="hands-row">
              <div className="player-hand">
                <div className="hand-cards">
                  {cell.cards.map((c, i) => (
                    <PlayingCard key={i} card={c} />
                  ))}
                </div>
              </div>
            </div>

            <div className="message-strip">
              {feedback && (
                <>
                  {feedback.correct ? (
                    <div className="result-correct">Correct!</div>
                  ) : (
                    <>
                      <div className="mastery-reset-banner" role="alert">
                        Wrong — progress reset. New sweep started.
                      </div>
                      <MistakeCard
                        taken={feedback.event.taken}
                        expected={feedback.event.expected}
                        reason={feedback.event.reason}
                        tc={feedback.event.tc}
                        hand={feedback.event.hand}
                        classification={feedback.event.classification}
                        onShowTable={() => setShowChart(true)}
                      />
                    </>
                  )}
                </>
              )}
            </div>

            {!feedback ? (
              <ActionBar
                mode={{ kind: 'actions', legal: drillLegalActions(cell.cards, activeProfile.rules), onAction: handleAction }}
              />
            ) : (
              <div className="action-bar">
                <button type="button" className="drill-next-btn" onClick={next}>
                  Next
                </button>
              </div>
            )}
          </>
        )
      )}

      {showChart && cell && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={cell.cards}
          dealerUp={cell.up}
          onClose={() => setShowChart(false)}
        />
      )}
    </div>
  );
}
