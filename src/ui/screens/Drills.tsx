import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import type { Settings } from '../../store/types';
import type { Card } from '../../engine/cards';
import type { Action } from '../../engine/deviations';
import type { GradedEvent } from '../../engine/grade';
import { classifyAction, actionCategory, classifyInsurance } from '../../engine/grade';
import type { PlayContext } from '../../engine/strategy';
import { correctPlay, basicPlay } from '../../engine/strategy';
import { hiLoTag } from '../../engine/count';
import { makeCountDrill, makeCountdown } from '../../drills/countDrill';
import type { CountDrillRound, CountdownRound } from '../../drills/countDrill';
import { drawFlashcard } from '../../drills/flashcards';
import type { Flashcard } from '../../drills/flashcards';
import { drawQuizItem } from '../../drills/deviationQuiz';
import type { QuizItem } from '../../drills/deviationQuiz';
import { loadStats, saveStats } from '../../store/persist';
import { applyEvents } from '../../store/stats';
import { PlayingCard } from '../components/PlayingCard';
import { NumPad } from '../components/NumPad';
import { ActionBar } from '../components/ActionBar';

interface DrillsProps {
  settings: Settings;
  onNavigate: (screen: Screen) => void;
}

const ALL_ACTIONS: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/* ---------------------------------------------------------------- */
/* Count Drill                                                       */
/* ---------------------------------------------------------------- */

type CountPhase = 'setup' | 'flashing' | 'answering' | 'result';

function CountDrillView({ settings, onBack }: { settings: Settings; onBack: () => void }) {
  const [countdownMode, setCountdownMode] = useState(false);
  const [phase, setPhase] = useState<CountPhase>('setup');
  const [drillRound, setDrillRound] = useState<CountDrillRound | null>(null);
  const [countdownRound, setCountdownRound] = useState<CountdownRound | null>(null);
  const [shownIndex, setShownIndex] = useState(0);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [actualValue, setActualValue] = useState(0);
  const [enteredValue, setEnteredValue] = useState(0);

  const groups: Card[][] = countdownMode
    ? countdownRound
      ? countdownRound.shown.map((c) => [c])
      : []
    : drillRound
      ? drillRound.groups
      : [];

  useEffect(() => {
    if (phase !== 'flashing' || groups.length === 0) return undefined;

    if (shownIndex >= groups.length - 1) {
      const t = setTimeout(() => setPhase('answering'), settings.drill.countIntervalMs);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setShownIndex((i) => i + 1), settings.drill.countIntervalMs);
    return () => clearTimeout(t);
  }, [phase, shownIndex, groups.length, settings.drill.countIntervalMs]);

  const start = () => {
    const seed = randomSeed();
    if (countdownMode) {
      setCountdownRound(makeCountdown(seed));
      setDrillRound(null);
    } else {
      setDrillRound(makeCountDrill(settings.drill.countLengthCards, settings.drill.countGroup, seed));
      setCountdownRound(null);
    }
    setShownIndex(0);
    setPhase('flashing');
  };

  const finishRun = (correct: boolean, actual: number, entered: number) => {
    setWasCorrect(correct);
    setActualValue(actual);
    setEnteredValue(entered);
    setPhase('result');

    const cardsInRun = countdownMode ? 52 : settings.drill.countLengthCards;
    const stats = loadStats();
    const updated = {
      ...stats,
      countDrill: {
        history: [
          ...stats.countDrill.history,
          {
            date: new Date().toISOString(),
            cards: cardsInRun,
            intervalMs: settings.drill.countIntervalMs,
            correct,
          },
        ],
      },
    };
    saveStats(updated);
  };

  const handleRcSubmit = (value: number) => {
    if (!drillRound) return;
    finishRun(value === drillRound.finalRc, drillRound.finalRc, value);
  };

  const handleTagGuess = (guess: -1 | 0 | 1) => {
    if (!countdownRound) return;
    const actual = hiLoTag(countdownRound.hidden.rank);
    finishRun(guess === actual, actual, guess);
  };

  const currentGroup = shownIndex < groups.length ? groups[shownIndex] : null;

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Count Drill</div>
      </div>

      {phase === 'setup' && (
        <div className="count-setup">
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={countdownMode}
              onChange={(e) => setCountdownMode(e.target.checked)}
            />
            Countdown (52-card, guess the hidden card&apos;s tag)
          </label>
          {!countdownMode && (
            <div className="count-config">
              <div>Length: {settings.drill.countLengthCards} cards</div>
              <div>Group size: {settings.drill.countGroup}</div>
              <div>Interval: {settings.drill.countIntervalMs}ms</div>
            </div>
          )}
          <button type="button" className="drill-start-btn" onClick={start}>
            Start
          </button>
        </div>
      )}

      {phase === 'flashing' && (
        <div className="count-flash-area">
          <div className="count-flash-cards">
            {currentGroup?.map((c, i) => <PlayingCard key={i} card={c} />)}
          </div>
          <div className="count-flash-progress">
            {shownIndex + 1} / {groups.length}
          </div>
        </div>
      )}

      {phase === 'answering' && !countdownMode && (
        <NumPad label="Enter the running count" onSubmit={handleRcSubmit} />
      )}

      {phase === 'answering' && countdownMode && (
        <div className="tag-guess">
          <div className="tag-guess-label">What&apos;s the hidden card&apos;s tag?</div>
          <div className="tag-guess-row">
            <button type="button" className="tag-guess-btn" onClick={() => handleTagGuess(1)}>
              +1
            </button>
            <button type="button" className="tag-guess-btn" onClick={() => handleTagGuess(0)}>
              0
            </button>
            <button type="button" className="tag-guess-btn" onClick={() => handleTagGuess(-1)}>
              &minus;1
            </button>
          </div>
        </div>
      )}

      {phase === 'result' && (
        <div className="drill-result">
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-detail">
            You entered {enteredValue}, actual was {actualValue}
          </div>
          <button type="button" className="drill-replay-btn" onClick={start}>
            Replay
          </button>
          <button type="button" className="drill-back-btn" onClick={onBack}>
            Back to Drills
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Flashcards                                                        */
/* ---------------------------------------------------------------- */

const FLASH_WEIGHTS_KEY = 'bjtrainer.flashweights.v1';

function loadFlashWeights(): Record<string, number> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(FLASH_WEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, number>;
    return {};
  } catch {
    return {};
  }
}

function saveFlashWeights(weights: Record<string, number>): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(FLASH_WEIGHTS_KEY, JSON.stringify(weights));
  } catch {
    // best-effort persistence only
  }
}

function cellCategory(cellId: string, correct: Action): 'hard' | 'soft' | 'pairs' | 'surrender' {
  if (correct === 'surrender') return 'surrender';
  if (cellId.startsWith('hard-')) return 'hard';
  if (cellId.startsWith('soft-')) return 'soft';
  return 'pairs';
}

function FlashcardsView({ settings, onBack }: { settings: Settings; onBack: () => void }) {
  const weightsRef = useRef<Record<string, number>>(loadFlashWeights());
  const [card, setCard] = useState<Flashcard>(() =>
    drawFlashcard(settings.drill.flashCategory, weightsRef.current, randomSeed()),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction: Action } | null>(null);

  const next = () => {
    setCard(drawFlashcard(settings.drill.flashCategory, weightsRef.current, randomSeed()));
    setFeedback(null);
  };

  const handleAction = (taken: Action) => {
    const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
    const withCount = correctPlay(card.cards, card.up, 0, ctx);
    const basicOnly = basicPlay(card.cards, card.up, ctx);
    const { classification, correct } = classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0);

    if (!correct) {
      weightsRef.current = { ...weightsRef.current, [card.cellId]: (weightsRef.current[card.cellId] ?? 0) + 1 };
      saveFlashWeights(weightsRef.current);
    }

    const event: GradedEvent = {
      kind: 'action',
      category: cellCategory(card.cellId, card.correct),
      correct,
      classification,
      taken,
      expected: card.correct,
      reason: card.cellId,
      tc: 0,
      hand: card.cellId,
    };
    saveStats(applyEvents(loadStats(), [event]));

    setFeedback({ correct, correctAction: withCount.action });
  };

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Flashcards</div>
      </div>

      <div className="dealer-area">
        <PlayingCard card={{ rank: card.up, suit: 's' }} />
      </div>

      <div className="hands-row">
        <div className="player-hand">
          <div className="hand-cards">
            {card.cards.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
        </div>
      </div>

      <div className="message-strip">
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : `Wrong — correct: ${feedback.correctAction.toUpperCase()}`}
            </div>
            <div className="feedback-cell">{card.cellId}</div>
          </>
        )}
      </div>

      {!feedback ? (
        <ActionBar mode={{ kind: 'actions', legal: ALL_ACTIONS, onAction: handleAction }} />
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

/* ---------------------------------------------------------------- */
/* Deviation Quiz                                                     */
/* ---------------------------------------------------------------- */

function buildQuizEvent(item: QuizItem, taken: string): GradedEvent {
  if (item.cards === null) {
    const take = taken === 'take-insurance';
    const { classification, correct } = classifyInsurance(take, item.tc);
    return {
      kind: 'insurance',
      category: 'insurance',
      correct,
      classification,
      taken: take ? 'take' : 'decline',
      expected: item.correct === 'take-insurance' ? 'take' : 'decline',
      reason: item.label,
      deviationId: item.deviationId,
      tc: item.tc,
      hand: 'dealer A',
    };
  }

  // canSurrender: false must match drawQuizItem's ctx (deviationQuiz.ts) so the
  // grader agrees with item.correct — see the deviation-quiz surrender-masking fix.
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
  const withCount = correctPlay(item.cards, item.up, item.tc, ctx);
  const basicOnly = basicPlay(item.cards, item.up, ctx);
  const { classification, correct } = classifyAction(taken as Action, withCount, basicOnly, item.cards, item.up, item.tc);

  return {
    kind: 'action',
    category: actionCategory(item.cards, item.correct as Action),
    correct,
    classification,
    taken,
    expected: item.correct,
    reason: item.label,
    deviationId: item.deviationId,
    tc: item.tc,
    hand: item.label,
  };
}

function DeviationQuizView({ onBack }: { onBack: () => void }) {
  const [item, setItem] = useState<QuizItem>(() => drawQuizItem(randomSeed()));
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);

  const next = () => {
    setItem(drawQuizItem(randomSeed()));
    setFeedback(null);
  };

  const handleAnswer = (taken: string) => {
    const event = buildQuizEvent(item, taken);
    saveStats(applyEvents(loadStats(), [event]));
    setFeedback({ correct: event.correct });
  };

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Deviation Quiz</div>
      </div>

      <div className="quiz-tc">TC {formatSigned(item.tc)}</div>

      {item.cards !== null ? (
        <>
          <div className="dealer-area">
            <PlayingCard card={{ rank: item.up, suit: 's' }} />
          </div>
          <div className="hands-row">
            <div className="player-hand">
              <div className="hand-cards">
                {item.cards.map((c, i) => (
                  <PlayingCard key={i} card={c} />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="quiz-insurance-prompt">Dealer shows an Ace. Insurance?</div>
      )}

      <div className="message-strip">
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : 'Wrong'}
            </div>
            <div className="quiz-label">{item.label}</div>
          </>
        )}
      </div>

      {!feedback ? (
        item.cards === null ? (
          <div className="action-bar">
            <button type="button" className="action-btn" onClick={() => handleAnswer('take-insurance')}>
              Take Insurance
            </button>
            <button type="button" className="action-btn" onClick={() => handleAnswer('decline-insurance')}>
              Decline Insurance
            </button>
          </div>
        ) : (
          <ActionBar mode={{ kind: 'actions', legal: ALL_ACTIONS, onAction: handleAnswer }} />
        )
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

/* ---------------------------------------------------------------- */
/* Picker                                                             */
/* ---------------------------------------------------------------- */

export function Drills({ settings, onNavigate }: DrillsProps) {
  const [mode, setMode] = useState<'picker' | 'count' | 'flash' | 'quiz'>('picker');

  if (mode === 'count') {
    return <CountDrillView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'flash') {
    return <FlashcardsView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'quiz') {
    return <DeviationQuizView onBack={() => setMode('picker')} />;
  }

  return (
    <div className="drills-picker">
      <h1 className="drills-title">Drills</h1>
      <div className="drills-nav">
        <button type="button" className="drills-nav-btn" onClick={() => setMode('count')}>
          Count Drill
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('flash')}>
          Flashcards
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('quiz')}>
          Deviation Quiz
        </button>
      </div>
      <button type="button" className="drills-back-btn" onClick={() => onNavigate('home')}>
        Back to Home
      </button>
    </div>
  );
}
