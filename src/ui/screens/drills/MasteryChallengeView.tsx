import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../../store/types';
import type { Action } from '../../../engine/deviations';
import {
  startMasteryRun,
  advanceMasteryRun,
  isMasteryRunComplete,
  currentCellId,
  cellsForScope,
  loadMasteryRun,
  saveMasteryRun,
  hydrateMasteryRun,
  presentedCards,
} from '../../../drills/masteryChallenge';
import type { MasteryRun, MasteryScope } from '../../../drills/masteryChallenge';
import { gradeMasteryAnswer } from '../../../drills/gradeAnswer';
import { gateDrillAnswer } from '../../../drills/answerGate';
import { drillLegalActions, rulesChipLabels } from '../../../drills/legalActions';
import { correctPlay } from '../../../engine/strategy';
import { PlayingCard } from '../../components/PlayingCard';
import { ActionBar } from '../../components/ActionBar';
import { HandResultStrip } from '../../components/HandResultStrip';
import { RulesChip } from '../../components/RulesChip';
import { releaseAnswerFocus, snapshotResult, type HandResult } from '../../handResult';
import { withdrawAnswer, wrongTapOffered, type WrongTapRecord } from '../../wrongTap';
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
  activeProfile,
  onBack,
}: {
  activeProfile: Profile;
  onBack: () => void;
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
  const storedCell = cellId ? cellMap.current.get(cellId) : undefined;
  // #18: a hard cell's cards are drawn for this position of the run, not the
  // one fixed composition the cell universe stores.
  const cell = storedCell ? { ...storedCell, cards: presentedCards(storedCell, run) } : undefined;
  const complete = isMasteryRunComplete(run);

  const cellCorrectAction: Action | undefined = cell
    ? correctPlay(cell.cards, cell.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, activeProfile.rules)
        .action
    : undefined;

  // B1 (#8, #10, #17): the answered hand, frozen when it was graded. The run
  // moves on in the same handler, so the hand on screen is already the next
  // one; the strip and "Show on chart" read ONLY this snapshot. #10's bug was
  // the chart reading the live `cell` after setRun(nextRun) had replaced it,
  // so a miss on 4,4 v 4 opened whatever the reshuffle dealt next.
  const [lastResult, setLastResult] = useState<HandResult | null>(null);
  // #22: the miss on the strip while it can still be withdrawn, with the run
  // as it stood before that answer.
  const [wrongTap, setWrongTap] = useState<WrongTapRecord | null>(null);
  const resultIdRef = useRef(0);
  const [chartFor, setChartFor] = useState<HandResult | null>(null);
  const promptShownAtRef = useRef(performance.now());

  const changeScope = (scope: MasteryScope) => {
    const fresh = startMasteryRun(scope, randomSeed());
    setRun(fresh);
    setLastResult(null);
    setWrongTap(null);
    promptShownAtRef.current = performance.now();
  };

  const handleAction = (taken: Action) => {
    if (!cell || complete || !cellCorrectAction) return;
    const gate = gateDrillAnswer(taken, cell.cards, activeProfile.rules, cell.up);
    if (!gate.accepted) return; // D3: refused answers never reach grading or the run

    const elapsedMs = performance.now() - promptShownAtRef.current;
    const flashcardShapedCell = { cards: cell.cards, up: cell.up, correct: cellCorrectAction, cellId: cell.id };
    const { event, correct } = gradeMasteryAnswer(
      flashcardShapedCell,
      taken,
      activeProfile.rules,
      elapsedMs,
      Date.now(),
    );

    resultIdRef.current += 1;
    const resultId = resultIdRef.current;
    const prevRun = run;
    setWrongTap(
      wrongTapOffered(event)
        ? {
            resultId,
            event,
            // The run as it was before the miss reset it: same sweep, same
            // position, and the same hand back on screen to answer again.
            revert: () => {
              setRun(prevRun);
              promptShownAtRef.current = performance.now();
            },
          }
        : null,
    );
    setLastResult(
      snapshotResult(
        resultId,
        event,
        { cards: cell.cards, up: cell.up, tc: null },
        {
          cellId: cell.id,
          // #17: what the miss threw away, counted before the reset.
          progressLost: correct ? undefined : { at: run.index, of: run.order.length },
        },
      ),
    );
    const nextRun = advanceMasteryRun(run, correct, randomSeed());
    setRun(nextRun);
    promptShownAtRef.current = performance.now();
    releaseAnswerFocus();
  };

  const closeChart = () => {
    setChartFor(null);
    // The hand behind the chart was waiting unanswered; restart its clock.
    promptShownAtRef.current = performance.now();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (chartFor) return;
      const action = KEY_TO_ACTION[e.key];
      if (!action || !cell) return;
      e.preventDefault();
      if (gateDrillAnswer(action, cell.cards, activeProfile.rules, cell.up).accepted) handleAction(action);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, cell, chartFor]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Mastery challenge</div>
      </div>

      <div className="drill-inline-controls">
        <div className="settings-row">
          <span className="settings-label">Hands</span>
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
        {/* "Check progress" (operator ask): always-visible, live count. */}
        <div className="mastery-progress" data-testid="mastery-progress">
          {run.index} / {run.order.length} cleared &middot; {scopeLabel(run.scope)}
        </div>
      </div>

      {complete ? (
        <div className="mastery-complete">
          <div className="result-correct">
            Sweep complete: all {run.order.length} hands, no mistakes.
          </div>
          <button
            type="button"
            className="drill-next-btn"
            onClick={() => {
              const fresh = startMasteryRun(run.scope, randomSeed());
              setRun(fresh);
              setLastResult(null);
              setWrongTap(null);
            }}
          >
            Start a new sweep
          </button>
        </div>
      ) : (
        cell && (
          <>
            {/* #26: graded with surrender available wherever the rules offer it. */}
            <RulesChip labels={rulesChipLabels({ canSurrender: true, canDouble: true }, activeProfile.rules)} />
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
              {lastResult && (
                <HandResultStrip
                  result={lastResult}
                  onShowChart={setChartFor}
                  onWrongTap={
                    wrongTap && wrongTap.resultId === lastResult.id
                      ? () => {
                          withdrawAnswer(wrongTap);
                          setWrongTap(null);
                          setLastResult({ ...lastResult, undone: true });
                        }
                      : undefined
                  }
                />
              )}
            </div>

            <ActionBar
              mode={{ kind: 'actions', legal: drillLegalActions(cell.cards, activeProfile.rules, cell.up), onAction: handleAction }}
            />
          </>
        )
      )}

      {chartFor && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={chartFor.cards}
          dealerUp={chartFor.up}
          // No `graded`: this drill asks every cell at true count zero, so
          // the expectation IS the chart and there is never anything to
          // reconcile. Passing one would only ever produce silence.
          onClose={closeChart}
        />
      )}
    </div>
  );
}
