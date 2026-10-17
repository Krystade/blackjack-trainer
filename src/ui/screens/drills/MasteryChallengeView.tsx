import { useEffect, useMemo, useState, useRef } from 'react';
import type { Profile, Settings } from '../../../store/types';
import type { Action } from '../../../engine/deviations';
import {
  startMasteryRun,
  advanceMasteryRun,
  isMasteryRunComplete,
  currentCellId,
  loadMasteryRun,
  saveMasteryRun,
  hydrateMasteryRun,
  presentedCards,
  runCoversExactly,
  srCellWeight,
} from '../../../drills/masteryChallenge';
import type { MasteryRun } from '../../../drills/masteryChallenge';
import { generateAllCells } from '../../../drills/flashcards';
import { deckLabel } from '../../../drills/deckSource';
import { handDeckFor } from './handDeckFor';
import { gradeMasteryAnswer, loadFlashSr } from '../../../drills/gradeAnswer';
import { gateDrillAnswer } from '../../../drills/answerGate';
import { drillLegalActions, rulesChipLabels } from '../../../drills/legalActions';
import { correctPlay } from '../../../engine/strategy';
import { PlayingCard } from '../../components/PlayingCard';
import { MarkableHand } from '../../components/MarkableHand';
import { ActionBar } from '../../components/ActionBar';
import { HandResultStrip } from '../../components/HandResultStrip';
import { RulesChip } from '../../components/RulesChip';
import { releaseAnswerFocus, snapshotResult, type HandResult } from '../../handResult';
import { withRegionRule } from './drillMiss';
import { withdrawAnswer, wrongTapOffered, type WrongTapRecord } from '../../wrongTap';
import { answerTooSoon } from '../../answerBounce';
import { StudyChartOverlay } from '../../components/StudyChartOverlay';
import { HandDeckControls } from './HandDeckControls';
import { DealToggles } from './DealToggles';
import { mulberry32 } from '../../../engine/cards';
import { maybeFallback, FULL_CTX } from '../../../drills/fallbackHand';
import { KEY_TO_ACTION } from '../Drills';
import { focusSwallowsKey } from '../../keyboardFocus';
import { isWholeChartSweep } from '../nextStep';
import { loadStats, saveStats } from '../../../store/persist';
import './mastery.css';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** #29: each cell's flashcard spaced-repetition weight, read now, which
 * orders a new sweep so the due and missed cells come first. */
function srWeightsNow() {
  return srCellWeight(loadFlashSr(), Date.now());
}

/** Every cell, by id: a run's order can hold any of them. */
const CELLS = new Map(generateAllCells().map((c) => [c.id, c]));

/** #13 / B2: the cells a sweep walks: the deck (chart, Custom selection,
 * index cells or marked cells) within the scope chosen now. */
function universeFor(settings: Settings, profile: Profile): string[] {
  return handDeckFor(settings.drill, profile).ids;
}

/**
 * Mastery Challenge (operator request): walk EVERY cell in a chosen scope
 * (#13: any of Hard / Soft / Pairs), exactly once (#29: due and missed cells
 * first), and get every single one right. One wrong answer wipes the run -- back to zero, with a
 * fresh shuffle. All the sequencing logic lives in the pure
 * drills/masteryChallenge.ts state machine and is unit-tested there; this
 * view is wiring only. Visual-only (D7, plan doc) -- no eyes-free ZonePad or
 * narration, matching PairCancelView's precedent.
 */
export function MasteryChallengeView({
  settings,
  activeProfile,
  onSettingsChange,
  onBack,
}: {
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (next: Settings) => void;
  onBack: () => void;
}) {
  const deck = useMemo(() => handDeckFor(settings.drill, activeProfile), [settings.drill, activeProfile]);
  const universe = deck.ids;
  // A saved run resumes when it walks the cells chosen now. Wave A (s10):
  // it ALSO resumes when it is a sweep in progress over other cells. The Hands
  // scope is shared with Flashcards and Speed, so tapping Pairs in Speed used
  // to overwrite a 61/330 sweep here on mount with no word said. Now the sweep
  // carries on over its own cells and says so; changing Hands HERE is the
  // explicit way to start a new one. A run with nothing cleared is not worth
  // keeping, and a fresh sweep follows the scope chosen now.
  const [initial] = useState(() => {
    const saved = hydrateMasteryRun(loadMasteryRun());
    if (saved && runCoversExactly(saved, universe)) return { run: saved, foreign: false };
    if (saved && saved.index > 0 && !isMasteryRunComplete(saved)) return { run: saved, foreign: true };
    return { run: startMasteryRun(universe, randomSeed(), srWeightsNow()), foreign: false };
  });
  const [run, setRun] = useState<MasteryRun>(initial.run);
  // The resumed sweep's cells differ from the Hands picked now.
  const [foreignRun, setForeignRun] = useState(initial.foreign);

  useEffect(() => {
    saveMasteryRun(run);
  }, [run]);

  const cellId = currentCellId(run);
  const storedCell = cellId ? CELLS.get(cellId) : undefined;
  // #18: a hard cell's cards are drawn for this position of the run, not the
  // one fixed composition the cell universe stores.
  const presented = storedCell ? { ...storedCell, cards: presentedCards(storedCell, run) } : undefined;
  // #27: with Fallbacks on, some double/surrender cells are dealt with the
  // double or surrender gone. Seeded by the run position like the cards, so
  // a re-render (or a Wrong-tap revert) deals the same hand.
  const fallback = presented
    ? maybeFallback(
        presented.cards,
        presented.up,
        activeProfile.rules,
        mulberry32((run.seed ^ Math.imul(run.index + 1, 0x85ebca6b) ^ 0x27) | 0),
        settings.drill.fallbacks === true,
      )
    : null;
  const cell = presented && fallback ? { ...presented, cards: fallback.cards } : presented;
  const cellCtx = fallback?.ctx;
  const complete = isMasteryRunComplete(run);

  const cellCorrectAction: Action | undefined = cell
    ? correctPlay(cell.cards, cell.up, 0, cellCtx ?? FULL_CTX, activeProfile.rules).action
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

  // #13 / B2: HandDeckControls has already saved the change. An
  // empty deck starts nothing: HandDeckGate takes the screen.
  const changeScopes = (next: Settings) => {
    onSettingsChange(next);
    const cells = universeFor(next, activeProfile);
    if (cells.length === 0) return;
    // Wave A (s10): picking the Hands the sweep in progress already walks
    // (back to All after Speed moved it to Pairs) carries that sweep on.
    if (runCoversExactly(run, cells)) {
      setForeignRun(false);
      return;
    }
    const fresh = startMasteryRun(cells, randomSeed(), srWeightsNow());
    setRun(fresh);
    setForeignRun(false);
    setLastResult(null);
    setWrongTap(null);
    promptShownAtRef.current = performance.now();
  };

  const handleAction = (taken: Action) => {
    if (!cell || complete || !cellCorrectAction) return;
    // Review fix (c): the second touch of a bounce lands on the next hand.
    if (answerTooSoon(promptShownAtRef.current)) return;
    const gate = gateDrillAnswer(taken, cell.cards, activeProfile.rules, cell.up, cellCtx);
    if (!gate.accepted) return; // D3: refused answers never reach grading or the run

    const elapsedMs = performance.now() - promptShownAtRef.current;
    const flashcardShapedCell = {
      cards: cell.cards,
      up: cell.up,
      correct: cellCorrectAction,
      cellId: cell.id,
      ...(cellCtx ? { ctx: cellCtx } : {}),
    };
    const { event, correct, cellBefore } = gradeMasteryAnswer(
      flashcardShapedCell,
      taken,
      activeProfile.rules,
      elapsedMs,
      Date.now(),
    );

    resultIdRef.current += 1;
    const resultId = resultIdRef.current;
    const prevRun = run;
    const prevForeign = foreignRun;
    setWrongTap(
      wrongTapOffered(event)
        ? {
            resultId,
            event,
            cellBefore,
            // The run as it was before the miss reset it: same sweep, same
            // position, and the same hand back on screen to answer again.
            revert: () => {
              setRun(prevRun);
              setForeignRun(prevForeign);
              promptShownAtRef.current = performance.now();
            },
          }
        : null,
    );
    setLastResult(
      withRegionRule(
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
        event,
        activeProfile.rules,
      ),
    );
    // #29: a miss reshuffles by the SR weights as they stand now. Wave A
    // review: a miss in a resumed sweep restarts over the Hands picked now --
    // its progress is gone either way, and a fresh sweep follows the scope.
    const restartOver = foreignRun && universe.length > 0 ? universe : run.order;
    const nextRun = advanceMasteryRun(run, correct, randomSeed(), correct ? undefined : srWeightsNow(), restartOver);
    setRun(nextRun);
    if (!correct) setForeignRun(false);
    // #28: remember a finished whole-chart sweep; the saved run forgets it
    // the moment the next sweep starts.
    if (correct && isWholeChartSweep(nextRun)) {
      const s = loadStats();
      saveStats({ ...s, masterySweepsCompleted: (s.masterySweepsCompleted ?? 0) + 1 });
    }
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
      if (gateDrillAnswer(action, cell.cards, activeProfile.rules, cell.up, cellCtx).accepted) handleAction(action);
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
        <HandDeckControls settings={settings} onChange={changeScopes} />
        <DealToggles settings={settings} onChange={onSettingsChange} />
        {/* "Check progress" (operator ask): always-visible, live count. */}
        <div className="mastery-progress" data-testid="mastery-progress">
          {run.index} / {run.order.length} cleared &middot; {foreignRun ? 'your sweep in progress' : deckLabel(deck)}
        </div>
        {foreignRun && (
          <div className="mastery-resumed" data-testid="mastery-resumed">
            Carrying on your {run.index}/{run.order.length} sweep. Pick Hands above to start a new one.
          </div>
        )}
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
              // Wave A review: a new sweep follows the Hands picked now, even
              // after finishing a resumed sweep over other cells.
              const fresh = startMasteryRun(universe.length > 0 ? universe : run.order, randomSeed(), srWeightsNow());
              setRun(fresh);
              setForeignRun(false);
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
            <RulesChip labels={rulesChipLabels(cellCtx ?? FULL_CTX, activeProfile.rules, cell)} />
            <div className="dealer-area">
              <PlayingCard card={{ rank: cell.up, suit: 's' }} />
            </div>
            <div className="hands-row">
              {/* #31: long-press the hand to mark its cell. */}
              <MarkableHand
                cellId={cell.id}
                handKey={`${run.seed}:${run.index}`}
                settings={settings}
                onSettingsChange={onSettingsChange}
              >
                <div className="hand-cards">
                  {cell.cards.map((c, i) => (
                    <PlayingCard key={i} card={c} />
                  ))}
                </div>
              </MarkableHand>
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
              mode={{ kind: 'actions', legal: drillLegalActions(cell.cards, activeProfile.rules, cell.up, cellCtx), onAction: handleAction }}
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
