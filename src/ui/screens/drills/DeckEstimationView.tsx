import { useEffect, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { makeDeckEstimationQuestion, gradeDeckEstimate } from '../../../drills/deckEstimation';
import type { DeckEstimationQuestion } from '../../../drills/deckEstimation';
import { Stepper, Segmented } from '../Settings';
import {
  depthOptions,
  depthTolerance,
  isLastDeckTightened,
  formatDepthSlack,
} from '../../../drills/depthResolution';
import type { DepthResolution } from '../../../drills/depthResolution';
import { loadStats, saveStats, saveSettings } from '../../../store/persist';
import { focusSwallowsKey } from '../../keyboardFocus';

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

// Guesses only ever come from the grid, so they are always an exact multiple
// of a quarter (V5-5) -- two decimals at most, and never float noise. Trailing
// zeroes are trimmed so the half-deck grid still reads "2.5" and not "2.50",
// which is what it looked like before quarter resolution existed.
function formatGuess(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/*
 * WHY a button grid instead of NumPad: NumPad (src/ui/components/NumPad.tsx)
 * is integer-only -- it has no decimal key -- and the whole point of this
 * drill is training sub-deck granularity (that's the real-world precision
 * a counter needs for true-count conversion; see gradeDeckEstimate's
 * tolerance). A fixed grid of the actual legal answers is also faster to tap
 * than typing "3.5" digit by digit, and it matches the existing button-grid
 * idiom already used for bounded-choice answers in this app (NumPad's own
 * digit grid, and the tag-guess-btn row in the count drill) rather than
 * inventing a new numeric-entry pattern.
 *
 * V5-5: the step is no longer hardcoded to half a deck. `depthOptions` in
 * drills/depthResolution.ts builds the grid from the chosen resolution, and
 * the grading tolerance is the step at that depth -- the two have to move
 * together or there are depths no button on screen can answer.
 */

/**
 * Desktop keyboard input (operator request): typed-digit entry for this
 * button-grid drill. Chose the "type the value" approach over arrow-key
 * grid navigation (the spec's offered alternative) because it's the most
 * direct match for "pressing numbers" -- digits build the whole-deck part,
 * '.' starts the fraction, mirroring how the values are actually labeled
 * ("2", "2.5", ...). Only a COMPLETE typed string resolves to a value; "2."
 * is deliberately mid-entry and resolves to null so the grid doesn't
 * highlight a non-existent option while the user is still typing.
 *
 * V5-5 widened this from the old integer-or-".5" grammar to any one- or
 * two-digit fraction. It does NOT need to know which fractions are legal:
 * the caller already checks membership in the live options list, so ".75"
 * simply finds nothing to submit at half resolution. Encoding the legal set
 * here as well would be a second copy of the grid, free to drift from it.
 */
function typedToValue(typed: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(typed)) return null;
  return Number(typed);
}

type Phase = 'setup' | 'answering' | 'result';

/**
 * V4-3 (docs/BACKLOG.md): the shoe size OPENS on the ACTIVE PROFILE's shoe.
 *
 * The Stepper stays -- estimating a shoe you do not normally play is worth
 * practising, and this drill is about eyeballing a physical stack rather than
 * about your own game. But it used to open on 6 for everyone, so a
 * double-deck player's default rep was a tray they never see.
 */
export function DeckEstimationView({
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
  const resolution = settings.drill.depthResolution;
  // CountDrillView's precedent: a drill-local control edits the same persisted
  // setting the Settings screen does, and has to write BOTH -- onSettingsChange
  // is App's React state only.
  const setResolution = (depthResolution: DepthResolution) => {
    const next: Settings = { ...settings, drill: { ...settings.drill, depthResolution } };
    saveSettings(next);
    onSettingsChange(next);
  };
  const [phase, setPhase] = useState<Phase>('setup');
  const [totalDecks, setTotalDecks] = useState<number>(activeProfile.rules.decks);
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
    const tolerance = depthTolerance(question.decksRemaining, resolution);
    const { correct, errorDecks: err } = gradeDeckEstimate(
      value,
      question.decksRemaining,
      tolerance,
    );
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
            toleranceDecks: tolerance,
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
    const options = depthOptions(question.totalDecks, resolution);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setTyped((t) => {
          // Two fraction digits at most -- "0.25" and "0.75" are the longest
          // legal answers, and letting a third through would only ever build a
          // value no button carries.
          const dot = t.indexOf('.');
          if (dot !== -1 && t.length - dot > 2) return t;
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
  }, [phase, question, typed, resolution]);

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
          <div className="settings-row">
            <span className="settings-label">Resolution</span>
            <Segmented
              options={[
                { value: 'half', label: 'Half' },
                { value: 'last-deck', label: 'Last deck' },
                { value: 'quarter', label: 'Quarter' },
              ]}
              value={resolution}
              onChange={setResolution}
            />
          </div>
          <div className="settings-row settings-note-row">
            Judge the discard tray by eye and estimate how many decks remain in the shoe. This
            drill is visual only -- no audio mode.
            {resolution === 'last-deck' && (
              <> Halves through the shoe, quarters once you are inside the last deck.</>
            )}
            {resolution === 'quarter' && <> Quarters throughout &mdash; hard mode.</>}
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
            {depthOptions(question.totalDecks, resolution).map((v) => (
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
          {/* V5-5: the tolerance is a setting now, so a grade that does not
              state it looks arbitrary -- and the last-deck rule tightens it
              without the player having touched anything since the question
              appeared. */}
          <div className="result-detail">
            Anything within{' '}
            {formatDepthSlack(depthTolerance(question.decksRemaining, resolution))} counts.
            {isLastDeckTightened(question.decksRemaining, resolution) && (
              <> Tighter than usual: you were inside the last deck.</>
            )}
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
