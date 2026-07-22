import { useState } from 'react';
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

  const start = () => {
    const q = makeDeckEstimationQuestion(randomSeed(), { totalDecks });
    setQuestion(q);
    setPhase('answering');
  };

  const handleGuess = (value: number) => {
    if (!question) return;
    const { correct, errorDecks: err } = gradeDeckEstimate(value, question.decksRemaining);
    setGuessValue(value);
    setWasCorrect(correct);
    setErrorDecks(err);
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
          </div>
          <div className="deck-guess-grid">
            {halfDeckOptions(question.totalDecks).map((v) => (
              <button
                key={v}
                type="button"
                className="deck-guess-btn"
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
