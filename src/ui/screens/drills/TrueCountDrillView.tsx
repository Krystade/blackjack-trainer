import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import { makeTrueCountQuestion } from '../../../drills/trueCountDrill';
import type { TrueCountQuestion } from '../../../drills/trueCountDrill';
import { NumPad } from '../../components/NumPad';
import { Stepper } from '../Settings';
import { useAudio } from '../../../audio/useAudio';
import { speak } from '../../../audio/speech';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import { narrateTc } from '../../../audio/narrate';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function formatDecks(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const DECK_WORDS: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Speak decks-remaining: "half a deck remaining" / "two decks remaining" /
 * "two and a half decks remaining". Local to this view -- narrate.ts is
 * owned by another agent right now, so this doesn't touch it.
 */
function narrateDecksRemaining(decks: number): string {
  const whole = Math.floor(decks);
  const isHalf = decks % 1 !== 0;
  const wholeWord = DECK_WORDS[whole] ?? String(whole);
  if (whole === 0 && isHalf) return 'half a deck remaining';
  if (isHalf) return `${wholeWord} and a half decks remaining`;
  return `${wholeWord} ${whole === 1 ? 'deck' : 'decks'} remaining`;
}

function narrateTcQuestion(q: TrueCountQuestion): string {
  return `Running count ${narrateTc(q.runningCount)}. ${capitalize(narrateDecksRemaining(q.decksRemaining))}`;
}

function narrateTcAnswer(correctTc: number): string {
  return `True count ${narrateTc(correctTc)}.`;
}

// 'selfcheck' is the eyes-free honor-system self-check: prompt spoken, a
// pause, then the answer spoken -- no keypad, no grading (mirrors
// CountDrillView's precedent). 'answering' still shows the NumPad (visual
// flow AND eyes-free "strict mode").
type TcPhase = 'setup' | 'answering' | 'selfcheck' | 'result';

export function TrueCountDrillView({
  settings,
  onBack,
}: {
  settings: Settings;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<TcPhase>('setup');
  const [question, setQuestion] = useState<TrueCountQuestion | null>(null);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [enteredValue, setEnteredValue] = useState(0);
  const [maxDecks, setMaxDecks] = useState(6);
  const audio = useAudio(settings.audio);

  // Eyes-free audio: local UI state, not persisted -- per-session choices
  // scoped to this drill screen, matching CountDrillView's precedent.
  const [eyesFree, setEyesFree] = useState(false);
  const [strictMode, setStrictMode] = useState(false);
  // True when the just-finished 'result' came from the honor-system
  // self-check path (spoken answer, no keypad) rather than a graded entry.
  const [honorCheck, setHonorCheck] = useState(false);
  // Bumped on every start() so a stale setTimeout from a previous run can
  // recognize itself as stale and no-op even though the effect's own
  // cleanup already clears its timer on teardown -- belt-and-suspenders
  // per the timer-discipline lesson (CountDrillView precedent).
  const runIdRef = useRef(0);

  // Eyes-free requires audio to be enabled; if the user disables audio
  // (e.g. via Settings) while it's checked, drop it rather than leave a
  // checked-but-disabled control.
  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  // Announce the question when entering 'answering' (visual mode: only at
  // verbosity 'full'; eyes-free "strict mode", which also lands on
  // 'answering', always hears it). The eyes-free honor-system path never
  // reaches 'answering' -- it has its own prompt+pause+answer effect below.
  useEffect(() => {
    if (phase !== 'answering' || !question) return;
    if (eyesFree) {
      speak(narrateTcQuestion(question), { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });
    } else {
      audio.sayFull(narrateTcQuestion(question));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, eyesFree]);

  // Eyes-free honor-system self-check: speak the prompt, wait the
  // configured pause, then speak the answer -- no keypad, no grading.
  // Guards against a stale timer two ways: the effect's own cleanup (fires
  // automatically when `phase` changes away from 'selfcheck', e.g. a fast
  // Next) AND a runId comparison inside the callback.
  useEffect(() => {
    if (phase !== 'selfcheck' || !question) return undefined;
    const runId = runIdRef.current;
    const rate = settings.audio.rate;
    const voiceURI = settings.audio.voiceURI;
    speak(narrateTcQuestion(question), { rate, voiceURI });
    const t = setTimeout(() => {
      if (runIdRef.current !== runId) return;
      speak(narrateTcAnswer(question.correctTc), { rate, voiceURI });
      setHonorCheck(true);
      setPhase('result');
    }, settings.audio.answerPauseMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Release the wake lock as soon as the drill ends (result reached), and
  // unconditionally on unmount -- releaseWakeLock() is a safe no-op when no
  // lock is held.
  useEffect(() => {
    if (phase === 'result') {
      void releaseWakeLock();
    }
  }, [phase]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, []);

  const start = () => {
    runIdRef.current += 1;
    const q = makeTrueCountQuestion(randomSeed(), { maxDecks });
    setQuestion(q);
    setHonorCheck(false);
    setPhase(eyesFree && !strictMode ? 'selfcheck' : 'answering');
    if (eyesFree) {
      void requestWakeLock();
    }
  };

  const handleBack = () => {
    void releaseWakeLock();
    onBack();
  };

  const handleSubmit = (value: number) => {
    if (!question) return;
    const correct = value === question.correctTc;
    setWasCorrect(correct);
    setEnteredValue(value);
    setHonorCheck(false);
    setPhase('result');

    const verdict = `${correct ? 'Correct.' : 'Wrong.'} ${narrateTcAnswer(question.correctTc)}`;
    if (eyesFree) {
      speak(verdict, { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });
    } else {
      audio.sayFull(verdict);
    }
  };

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">True Count Drill</div>
      </div>

      {phase === 'setup' && (
        <div className="count-setup">
          <Stepper
            label="Max decks remaining"
            value={maxDecks}
            min={1}
            max={8}
            step={1}
            format={(v) => `${v} decks`}
            onChange={setMaxDecks}
          />

          <label className="count-toggle">
            <input
              type="checkbox"
              checked={eyesFree}
              disabled={!settings.audio.enabled}
              onChange={(e) => setEyesFree(e.target.checked)}
            />
            Eyes-free audio
          </label>
          {!settings.audio.enabled && (
            <div className="settings-row settings-note-row">
              Enable audio in Settings to use eyes-free mode.
            </div>
          )}
          {eyesFree && settings.audio.enabled && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(e) => setStrictMode(e.target.checked)}
              />
              Strict mode (keypad entry, graded)
            </label>
          )}

          <button type="button" className="drill-start-btn" onClick={start}>
            Start
          </button>
        </div>
      )}

      {phase === 'selfcheck' && (
        <div className="count-flash-area">
          <div className="count-flash-progress">Listen for the running count and decks remaining&hellip;</div>
        </div>
      )}

      {phase === 'answering' && question && (
        <>
          <div className="count-flash-area">
            <div className="quiz-tc">Running count {formatSigned(question.runningCount)}</div>
            <div className="tag-guess-label">Decks remaining {formatDecks(question.decksRemaining)}</div>
          </div>
          <NumPad label="Enter the true count" onSubmit={handleSubmit} />
        </>
      )}

      {phase === 'result' && honorCheck && question && (
        <div className="drill-result">
          <div className="result-correct">True count announced</div>
          <div className="result-detail">
            The true count was {formatSigned(question.correctTc)} &mdash; self-check, no grade recorded
          </div>
          <button type="button" className="drill-replay-btn" onClick={start}>
            Next
          </button>
          <button type="button" className="drill-back-btn" onClick={handleBack}>
            Back to Drills
          </button>
        </div>
      )}

      {phase === 'result' && !honorCheck && question && (
        <div className="drill-result">
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-detail">
            You entered {formatSigned(enteredValue)}, actual was {formatSigned(question.correctTc)}
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
