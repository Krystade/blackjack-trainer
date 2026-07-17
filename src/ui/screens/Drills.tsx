import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Card } from '../../engine/cards';
import type { Action, DeviationId } from '../../engine/deviations';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17 } from '../../engine/deviations';
import type { GradedEvent } from '../../engine/grade';
import { classifyAction, actionCategory, classifyInsurance } from '../../engine/grade';
import type { PlayContext } from '../../engine/strategy';
import { correctPlay, basicPlay } from '../../engine/strategy';
import type { RuleSet } from '../../engine/ruleset';
import { hiLoTag } from '../../engine/count';
import { makeCountDrill, makeCountdown } from '../../drills/countDrill';
import type { CountDrillRound, CountdownRound } from '../../drills/countDrill';
import { drawFlashcard } from '../../drills/flashcards';
import type { Flashcard } from '../../drills/flashcards';
import { drawQuizItem } from '../../drills/deviationQuiz';
import type { QuizItem } from '../../drills/deviationQuiz';
import { loadStats, saveStats, saveSettings } from '../../store/persist';
import { applyEvents } from '../../store/stats';
import { PlayingCard } from '../components/PlayingCard';
import { NumPad } from '../components/NumPad';
import { ActionBar } from '../components/ActionBar';
import { Segmented, Stepper } from './Settings';

interface DrillsProps {
  settings: Settings;
  activeProfile: Profile;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: Settings) => void;
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

function CountDrillView({
  settings,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [countdownMode, setCountdownMode] = useState(false);
  const [phase, setPhase] = useState<CountPhase>('setup');
  const [drillRound, setDrillRound] = useState<CountDrillRound | null>(null);
  const [countdownRound, setCountdownRound] = useState<CountdownRound | null>(null);
  const [shownIndex, setShownIndex] = useState(0);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [actualValue, setActualValue] = useState(0);
  const [enteredValue, setEnteredValue] = useState(0);

  const updateDrill = (patch: Partial<Settings['drill']>) => {
    const next: Settings = { ...settings, drill: { ...settings.drill, ...patch } };
    saveSettings(next);
    onSettingsChange(next);
  };

  const groups: Card[][] = countdownMode
    ? countdownRound
      ? countdownRound.shown.map((c) => [c])
      : []
    : drillRound
      ? drillRound.groups
      : [];

  useEffect(() => {
    if (phase !== 'flashing' || groups.length === 0 || settings.drill.countManual) return undefined;

    if (shownIndex >= groups.length - 1) {
      const t = setTimeout(() => setPhase('answering'), settings.drill.countIntervalMs);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setShownIndex((i) => i + 1), settings.drill.countIntervalMs);
    return () => clearTimeout(t);
  }, [phase, shownIndex, groups.length, settings.drill.countIntervalMs, settings.drill.countManual]);

  const advanceManual = () => {
    if (shownIndex >= groups.length - 1) {
      setPhase('answering');
    } else {
      setShownIndex((i) => i + 1);
    }
  };

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
            <>
              <Stepper
                label="Length"
                value={settings.drill.countLengthCards}
                min={13}
                max={312}
                step={13}
                format={(v) => `${v} cards`}
                onChange={(v) => updateDrill({ countLengthCards: v })}
              />
              <div className="settings-row">
                <span className="settings-label">Group size</span>
                <Segmented
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3', label: '3' },
                  ]}
                  value={String(settings.drill.countGroup)}
                  onChange={(v) => updateDrill({ countGroup: Number(v) as 1 | 2 | 3 })}
                />
              </div>
            </>
          )}

          <Stepper
            label="Speed"
            value={settings.drill.countIntervalMs}
            min={300}
            max={3000}
            step={100}
            format={(v) => `${v}ms`}
            onChange={(v) => updateDrill({ countIntervalMs: v })}
          />

          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <Segmented
              options={[
                { value: 'timed', label: 'Timed' },
                { value: 'manual', label: 'Manual' },
              ]}
              value={settings.drill.countManual ? 'manual' : 'timed'}
              onChange={(v) => updateDrill({ countManual: v === 'manual' })}
            />
          </div>

          <button type="button" className="drill-start-btn" onClick={start}>
            Start
          </button>
        </div>
      )}

      {phase === 'flashing' && settings.drill.countManual && (
        <div className="manual-tap-zone" onClick={advanceManual}>
          <div className="count-flash-cards">
            {currentGroup?.map((c, i) => <PlayingCard key={i} card={c} />)}
          </div>
          <div className="manual-tap-hint">
            tap to advance &middot; {shownIndex + 1}/{groups.length}
          </div>
        </div>
      )}

      {phase === 'flashing' && !settings.drill.countManual && (
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

function FlashcardsView({
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
  const weightsRef = useRef<Record<string, number>>(loadFlashWeights());
  const [card, setCard] = useState<Flashcard>(() =>
    drawFlashcard(settings.drill.flashCategory, weightsRef.current, randomSeed(), activeProfile.rules),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction: Action } | null>(null);

  const next = (category: Settings['drill']['flashCategory'] = settings.drill.flashCategory) => {
    setCard(drawFlashcard(category, weightsRef.current, randomSeed(), activeProfile.rules));
    setFeedback(null);
  };

  const changeCategory = (category: Settings['drill']['flashCategory']) => {
    const nextSettings: Settings = { ...settings, drill: { ...settings.drill, flashCategory: category } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
    next(category);
  };

  const handleAction = (taken: Action) => {
    const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
    const withCount = correctPlay(card.cards, card.up, 0, ctx, activeProfile.rules);
    const basicOnly = basicPlay(card.cards, card.up, ctx, activeProfile.rules);
    const { classification, correct } = classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0, activeProfile.rules);

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

      <div className="drill-inline-controls">
        <div className="settings-row">
          <span className="settings-label">Category</span>
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pairs', label: 'Pairs' },
            ]}
            value={settings.drill.flashCategory}
            onChange={changeCategory}
          />
        </div>
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
          <button type="button" className="drill-next-btn" onClick={() => next()}>
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

function buildQuizEvent(item: QuizItem, taken: string, rules: RuleSet): GradedEvent {
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
  const withCount = correctPlay(item.cards, item.up, item.tc, ctx, rules);
  const basicOnly = basicPlay(item.cards, item.up, ctx, rules);
  const { classification, correct } = classifyAction(taken as Action, withCount, basicOnly, item.cards, item.up, item.tc, rules);

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

function quizFilterArg(quizIndex: DeviationId | 'all'): DeviationId | undefined {
  return quizIndex === 'all' ? undefined : quizIndex;
}

function DeviationQuizView({
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
  const [item, setItem] = useState<QuizItem>(() =>
    drawQuizItem(randomSeed(), quizFilterArg(settings.drill.quizIndex), activeProfile.rules),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);

  const next = (filter: DeviationId | 'all' = settings.drill.quizIndex) => {
    setItem(drawQuizItem(randomSeed(), quizFilterArg(filter), activeProfile.rules));
    setFeedback(null);
  };

  const changeIndex = (quizIndex: DeviationId | 'all') => {
    const nextSettings: Settings = { ...settings, drill: { ...settings.drill, quizIndex } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
    next(quizIndex);
  };

  const handleAnswer = (taken: string) => {
    const event = buildQuizEvent(item, taken, activeProfile.rules);
    saveStats(applyEvents(loadStats(), [event]));
    setFeedback({ correct: event.correct });
  };

  const indexList = activeProfile.rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18;

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Deviation Quiz</div>
      </div>

      <div className="drill-inline-controls">
        <label className="settings-row">
          <span className="settings-label">Index</span>
          <select
            className="quiz-index-select"
            value={settings.drill.quizIndex}
            onChange={(e) => changeIndex(e.target.value as DeviationId | 'all')}
          >
            <option value="all">All indices</option>
            {indexList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
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
          <button type="button" className="drill-next-btn" onClick={() => next()}>
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

export function Drills({ settings, activeProfile, onNavigate, onSettingsChange }: DrillsProps) {
  const [mode, setMode] = useState<'picker' | 'count' | 'flash' | 'quiz'>('picker');

  if (mode === 'count') {
    return (
      <CountDrillView
        settings={settings}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'flash') {
    return (
      <FlashcardsView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'quiz') {
    return (
      <DeviationQuizView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
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
