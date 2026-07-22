import { useEffect, useState } from 'react';
import type { Settings } from '../../../store/types';
import { makeDeckEstimationQuestion, gradeDeckEstimate } from '../../../drills/deckEstimation';
import type { DeckEstimationQuestion } from '../../../drills/deckEstimation';
import { Stepper } from '../Settings';
import { loadStats, saveStats } from '../../../store/persist';

// This drill is deliberately visual-only (judging a physical card stack) --
// unlike the other drills it has NO eyes-free/audio mode. See
// docs/research/2026-07-21-priority-list.md item 7.

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

// The exact actual value (shown only in the result, for calibration) --
// two decimal places is enough precision to explain the grading without
// implying the player should have counted individual cards.
function formatExact(n: number): string {
  return n.toFixed(2);
}

// Guesses only ever come from the half-deck button grid, so they're always
// an exact multiple of 0.5 -- one decimal place is enough and never shows
// float noise.
function formatGuess(n: number): string {
  return n.toFixed(1);
}

/**
 * Half-deck-stepped guess options from 0.5 up to totalDecks inclusive.
 *
 * WHY a button grid instead of NumPad: NumPad (src/ui/components/NumPad.tsx)
 * is integer-only -- it has no decimal key -- and the whole point of this
 * drill is training half-deck granularity (that's the real-world precision
 * a counter needs for true-count conversion; see gradeDeckEstimate's default
 * tolerance). A fixed grid of the actual legal half-deck answers is also
 * faster to tap than typing "3.5" digit by digit, and it matches the
 * existing button-grid idiom already used for bounded-choice answers in
 * this app (NumPad's own digit grid, and the tag-guess-btn row in the count
 * drill) rather than inventing a new numeric-entry pattern.
 */
function halfDeckOptions(totalDecks: number): number[] {
  const steps = Math.round(totalDecks * 2);
  const out: number[] = [];
  for (let i = 1; i <= steps; i++) out.push(i * 0.5);
  return out;
}

/**
 * Desktop keyboard input (operator request): typed-digit entry for this
 * button-grid drill. Chose the "type the value" approach over arrow-key
 * grid navigation (the spec's offered alternative) because it's the most
 * direct match for "pressing numbers" -- digits build the whole-deck part,
 * '.' starts the half, and '5' completes it, mirroring how the values are
 * actually labeled ("2", "2.5", ...). Only a COMPLETE typed string (a bare
 * integer, or integer + ".5") resolves to a value; "2." is deliberately
 * mid-entry and resolves to null so the grid doesn't highlight a
 * non-existent option while the user is still typing the half.
 */
function typedToValue(typed: string): number | null {
  if (/^\d+$/.test(typed)) return Number(typed);
  if (/^\d+\.5$/.test(typed)) return Number(typed);
  return null;
}

type Phase = 'setup' | 'answering' | 'result';

export function DeckEstimationView({
  settings: _settings,
  onBack,
}: {
  settings: Settings;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [totalDecks, setTotalDecks] = useState(6);
  const [question, setQuestion] = useState<DeckEstimationQuestion | null>(null);
  const [guessValue, setGuessValue] = useState(0);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [errorDecks, setErrorDecks] = useState(0);
  // The in-progress keyboard-typed guess ("2", "2.5", ...) -- see
  // typedToValue above for the exact grammar. Reset whenever a new
  // question starts or a guess (typed or tapped) is submitted.
  const [typed, setTyped] = useState('');

  const start = () => {
    const q = makeDeckEstimationQuestion(randomSeed(), { totalDecks });
    setQuestion(q);
    setTyped('');
    setPhase('answering');
  };

  const handleGuess = (value: number) => {
    if (!question) return;
    const { correct, errorDecks: err } = gradeDeckEstimate(value, question.decksRemaining);
    setGuessValue(value);
    setWasCorrect(correct);
    setErrorDecks(err);
    setTyped('');
    setPhase('result');

    // Record telemetry -- this drill previously wrote nothing at all, so a
    // user had no way to see whether their deck-estimation eye was
    // improving. Mirrors CountDrillView's finishRun precedent: loadStats ->
    // append -> saveStats.
    const stats = loadStats();
    saveStats({
      ...stats,
      deckEstimation: {
        history: [
          ...stats.deckEstimation.history,
          {
            date: new Date().toISOString(),
            actualDecks: question.decksRemaining,
            guess: value,
            errorDecks: err,
            correct,
          },
        ],
      },
    });
  };

  const handleBack = () => {
    onBack();
  };

  // Desktop keyboard input (operator request): digits/'.'/Backspace build
  // `typed` (see typedToValue above); Enter submits by calling the SAME
  // handleGuess the grid buttons call whenever `typed` resolves to a
  // complete, legal value -- no parallel grading path. Gated to the
  // 'answering' phase (the only time the grid is shown) and skipped when a
  // native input/select/textarea has focus.
  useEffect(() => {
    if (phase !== 'answering' || !question) return undefined;
    const options = halfDeckOptions(question.totalDecks);

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setTyped((t) => {
          if (t.includes('.')) {
            // Only '5' immediately after the dot completes a half; anything
            // else once the half slot is already filled is a no-op.
            return t.endsWith('.') && e.key === '5' ? t + '5' : t;
          }
          return t + e.key;
        });
      } else if (e.key === '.') {
        e.preventDefault();
        setTyped((t) => (t !== '' && !t.includes('.') ? t + '.' : t));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setTyped((t) => t.slice(0, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const value = typedToValue(typed);
        if (value !== null && options.includes(value)) {
          handleGuess(value);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, typed]);

  const typedValue = typedToValue(typed);

  const fraction = question ? question.cardsDealt / (question.totalDecks * 52) : 0;
  // Keep a small sliver visible even at the low end so the tray never reads
  // as literally empty; cap comfortably under 100% so the frame's rim stays
  // visible at the high end.
  const fillPct = Math.min(96, Math.max(4, fraction * 100));

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Deck Estimation Drill</div>
      </div>

      {phase === 'setup' && (
        <div className="count-setup">
          <Stepper
            label="Shoe size"
            value={totalDecks}
            min={1}
            max={8}
            step={1}
            format={(v) => `${v} decks`}
            onChange={setTotalDecks}
          />
          <div className="settings-row settings-note-row">
            Judge the discard tray by eye and estimate how many decks remain in the shoe. This
            drill is visual only -- no audio mode.
          </div>
          <button type="button" className="drill-start-btn" onClick={start}>
            Start
          </button>
        </div>
      )}

      {phase === 'answering' && question && (
        <>
          <div className="deck-estimation-area">
            <div className="deck-tray-context">{question.totalDecks}-deck shoe</div>
            <div className="deck-tray-frame">
              <div className="deck-tray-fill" style={{ height: `${fillPct}%` }} />
            </div>
            <div className="deck-guess-question">How many decks remain?</div>
            {typed !== '' && (
              <div className="deck-typed-display">
                Typed: {typed}
                {typedValue === null ? '…' : ''}
              </div>
            )}
          </div>
          <div className="deck-guess-grid">
            {halfDeckOptions(question.totalDecks).map((v) => (
              <button
                key={v}
                type="button"
                className={`deck-guess-btn${typedValue === v ? ' deck-guess-btn-typed' : ''}`}
                onClick={() => handleGuess(v)}
              >
                {formatGuess(v)}
              </button>
            ))}
          </div>
        </>
      )}

      {phase === 'result' && question && (
        <div className="drill-result">
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-detail">
            You guessed {formatGuess(guessValue)} decks &mdash; actual was{' '}
            {formatExact(question.decksRemaining)} decks (off by {formatExact(errorDecks)})
          </div>
          <div className="result-detail">
            {question.cardsDealt} cards were dealt from the {question.totalDecks}-deck (
            {question.totalDecks * 52}-card) shoe
          </div>
          <button type="button" className="drill-replay-btn" onClick={start}>
            Next
          </button>
          <button type="button" className="drill-back-btn" onClick={handleBack}>
            Back to Drills
          </button>
        </div>
      )}
    </div>
  );
}
