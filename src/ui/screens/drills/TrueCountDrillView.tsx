import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { makeTrueCountQuestion } from '../../../drills/trueCountDrill';
import { tcConversionAccepted } from '../../../engine/count';
import type { TrueCountQuestion } from '../../../drills/trueCountDrill';
import { NumPad } from '../../components/NumPad';
import { Stepper } from '../Settings';
import { useAudio } from '../../../audio/useAudio';
import { speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import { narrateTc } from '../../../audio/narrate';
import { loadStats, saveStats } from '../../../store/persist';
import { enableAudioNow } from '../../audioGate';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../../audio/voiceRecognition';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../../audio/voiceNumber';
import { VoiceStatusBar } from '../../components/VoiceStatusBar';

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
type TcPhase =
  | 'setup'
  | 'answering'
  | 'selfcheck'
  /**
   * The answer has been spoken and the drill is asking whether you had it.
   *
   * Without this the eyes-free path ended on "self-check, no grade
   * recorded": it spoke a true count into the car and then recorded
   * nothing, so the one mode built for driving was the one mode that never
   * told you whether you were right. Same gap, and same fix, as the count
   * drill.
   */
  | 'selfreport'
  | 'result';

/**
 * V4-3 (docs/BACKLOG.md): the deck range opens on the ACTIVE PROFILE's shoe.
 *
 * The Stepper stays a deliberate override -- practising a range wider than
 * your own shoe is useful -- but it used to open on 6 for everyone, so a
 * double-deck player's default rep was a divisor they never meet.
 */
export function TrueCountDrillView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  // Needed so the eyes-free toggle can enable audio itself rather than
  // sitting disabled and pointing at another screen -- see ui/audioGate.ts.
  onSettingsChange: (settings: Settings) => void;
}) {
  const [phase, setPhase] = useState<TcPhase>('setup');
  const [question, setQuestion] = useState<TrueCountQuestion | null>(null);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [enteredValue, setEnteredValue] = useState(0);
  const [maxDecks, setMaxDecks] = useState<number>(activeProfile.rules.decks);
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

  // VOICE. Off until asked for: a toggle that survived a reload would open a
  // microphone on page load.
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  const [voiceOn, setVoiceOn] = useState(false);
  /**
   * A spoken true count, heard but not yet submitted.
   *
   * Nothing spoken is submitted directly. A misheard digit here would score
   * the attempt against an answer nobody gave, so a number is a PROPOSAL,
   * read back and confirmed -- the same contract the table's count check and
   * the count drill both run on.
   */
  const [pendingTc, setPendingTc] = useState<number | null>(null);

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
      speak(narrateTcQuestion(question), speechOptsFrom(settings.audio));
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
    speak(narrateTcQuestion(question), speechOptsFrom(settings.audio));
    const t = setTimeout(() => {
      if (runIdRef.current !== runId) return;
      speak(narrateTcAnswer(question.correctTc), speechOptsFrom(settings.audio));
      speak('Did you have it?', speechOptsFrom(settings.audio));
      setHonorCheck(true);
      setPhase('selfreport');
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
    // The depth is STATED here, so there is no estimation slack to forgive --
    // but the leftover still has no single right convention, and marking "+3"
    // wrong on a quotient of 2.8 grades a preference rather than the division
    // (engine/count.ts's `tcConversionAccepted`).
    const correct = tcConversionAccepted(value, question.runningCount, question.decksRemaining);
    setWasCorrect(correct);
    setEnteredValue(value);
    setHonorCheck(false);
    setPhase('result');

    // Graded attempt (unlike the honor-system self-check path above, which
    // never reaches here) -- record telemetry so Stats can show accuracy
    // and the too-high/too-low error breakdown. Mirrors CountDrillView's
    // finishRun precedent: loadStats -> append -> saveStats.
    const stats = loadStats();
    saveStats({
      ...stats,
      trueCount: {
        history: [
          ...stats.trueCount.history,
          {
            date: new Date().toISOString(),
            runningCount: question.runningCount,
            decksRemaining: question.decksRemaining,
            guess: value,
            correctTc: question.correctTc,
            correct,
          },
        ],
      },
    });

    const verdict = `${correct ? 'Correct.' : 'Wrong.'} ${narrateTcAnswer(question.correctTc)}`;
    if (eyesFree) {
      speak(verdict, speechOptsFrom(settings.audio));
    } else {
      audio.sayFull(verdict);
    }
  };

  /**
   * The eyes-free verdict, recorded like a keypad run -- with one deliberate
   * difference: no `guess` is written. The operator said whether they had
   * it, never what they had, and putting the right answer in that field
   * would report every admitted miss as an exact hit in Stats.
   */
  const handleSelfReport = (correct: boolean) => {
    if (!question) return;
    speak(correct ? 'Correct.' : 'Wrong.', speechOptsFrom(settings.audio, { interrupt: true }));
    setWasCorrect(correct);
    setPhase('result');

    const stats = loadStats();
    saveStats({
      ...stats,
      trueCount: {
        history: [
          ...stats.trueCount.history,
          {
            date: new Date().toISOString(),
            runningCount: question.runningCount,
            decksRemaining: question.decksRemaining,
            correctTc: question.correctTc,
            correct,
          },
        ],
      },
    });
  };

  /** Say something, unconditionally -- a voice reply IS the output channel. */
  const sayBack = (text: string, interrupt = false) => {
    speak(text, speechOptsFrom(settings.audio, interrupt ? { interrupt: true } : {}));
  };

  /** The result, said again on request -- the screen is not being looked at. */
  const resultSpeech = (): string =>
    question === null
      ? ''
      : `${wasCorrect ? 'Correct.' : 'Wrong.'} ${narrateTcAnswer(question.correctTc)} Say yes for the next one.`;

  /**
   * First refusal on every transcript, for the thing the command vocabulary
   * deliberately does not contain: a number. Only while an answer is due --
   * outside 'answering' a number is someone reading a road sign.
   */
  const interpretTcSpeech = (heard: string, offered: readonly string[] = [heard]): string | null => {
    if (phase !== 'answering') return null;
    const readings = offered.length > 0 ? offered : [heard];

    // Every reading is tried, best first: over a car microphone the count
    // often ranks second, and this is a question that is tedious to repeat.
    let parsed: ReturnType<typeof parseCountSpeech> = null;
    for (const reading of readings) {
      parsed = parseCountSpeech(reading);
      if (parsed) break;
    }
    if (!parsed) return null;

    const next = parsed.kind === 'value' ? parsed.value : (pendingTc ?? 0) + parsed.delta;
    setPendingTc(next);
    sayBack(`${speakableCount(next)}. Correct?`, true);
    return `true count ${speakableCount(next)}`;
  };

  /**
   * Phase-shaped, like the count drill's: the same "yes" starts a question,
   * confirms a proposal, and claims the self-check. Nothing here navigates
   * -- a misheard word costs one "no", never the run.
   */
  const handleVoiceCommand = (action: VoiceAction) => {
    switch (phase) {
      case 'setup':
        if (action === 'yes') start();
        return;

      case 'answering': {
        if (action === 'yes') {
          if (pendingTc === null) {
            sayBack('I have no true count yet. What is it?', true);
            return;
          }
          const confirmed = pendingTc;
          setPendingTc(null);
          handleSubmit(confirmed);
          return;
        }
        if (action === 'no') {
          setPendingTc(null);
          if (question) sayBack(narrateTcQuestion(question), true);
          return;
        }
        if (action === 'repeat') {
          sayBack(
            pendingTc === null
              ? question
                ? narrateTcQuestion(question)
                : ''
              : `${speakableCount(pendingTc)}. Correct?`,
            true,
          );
        }
        return;
      }

      case 'selfreport':
        if (action === 'yes') handleSelfReport(true);
        else if (action === 'no') handleSelfReport(false);
        else if (action === 'repeat') {
          if (question) sayBack(narrateTcAnswer(question.correctTc), true);
          sayBack('Did you have it?');
        }
        return;

      case 'result':
        if (action === 'yes') start();
        else if (action === 'repeat') sayBack(resultSpeech(), true);
        else if (action === 'no') sayBack('Okay. Say yes when you want the next one.', true);
        return;

      // 'selfcheck' is the app's turn to talk: the question has been asked
      // and the answer is still coming.
      default:
        return;
    }
  };


  // The steering wheel, mapped onto the same affirmative the microphone uses.
  // Deliberately NOT gated on `voiceOn`: the wheel only reaches this app when
  // the microphone is OFF (an open mic switches the car to its hands-free call
  // route and the wheel's buttons go to that call), so gating it on voice would
  // arm it in exactly the state where it cannot work. See audio/wheelCommands.ts.
  useWheelCommand(() => handleVoiceCommand('yes'));

  const voice = useVoiceControl({
    enabled: voiceOn,
    onAction: handleVoiceCommand,
    onTranscript: interpretTcSpeech,
    // Eyes-free, a rejection is silence, and silence looks the same as a dead
    // microphone. A short cue says "say it again".
    onNotUnderstood: () => audio.ding('attention'),
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    context: 'true-count-drill',
  });

  // A proposal belongs to one question.
  useEffect(() => {
    setPendingTc(null);
  }, [phase]);

  // Offer the next question out loud, and take the restart gap here -- the
  // result screen is the only reliably quiet moment in this drill.
  useEffect(() => {
    if (!voiceOn || phase !== 'result') return;
    voice.cycleIfStale();
    sayBack('Say yes for the next one.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, phase]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">True Count Drill</div>
      </div>

      {/* Deliberately NOT the full command vocabulary: the play words do
          nothing here, and listing them would invite a driver to say
          something the screen has just promised will work. */}
      {voiceOn && (
        <VoiceStatusBar
          status={voice.status}
          hint={
            <>
              Say: yes &middot; no &middot; repeat &mdash; and the true count itself,
              &ldquo;minus two&rdquo;
            </>
          }
        />
      )}

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
              onChange={(e) => {
                // Tapping this IS a request for audio, so honour it rather
                // than refusing. The control used to sit disabled whenever
                // `audio.enabled` was false -- the shipped default -- which
                // made the app's driving mode a dead checkbox curable only
                // from another screen. See ui/audioGate.ts.
                if (e.target.checked && !settings.audio.enabled) {
                  enableAudioNow(settings, onSettingsChange);
                }
                setEyesFree(e.target.checked);
              }}
            />
            Eyes-free audio
          </label>
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

          {voiceSupported && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={voiceOn}
                onChange={(e) => {
                  // Answering out loud is worthless without hearing the
                  // reply, so this turns audio on the way Eyes-free does.
                  if (e.target.checked && !settings.audio.enabled) {
                    enableAudioNow(settings, onSettingsChange);
                  }
                  setVoiceOn(e.target.checked);
                }}
              />
              Voice answers (say the true count, and &ldquo;yes&rdquo; to start)
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
          {/* The spoken proposal, shown as well as said. The keypad stays:
              voice is an addition, not a replacement, and has to survive a
              refused microphone and a passenger. */}
          {voiceOn && (
            <div className="count-voice" data-pending={pendingTc !== null}>
              {pendingTc === null ? (
                <span className="count-voice-hint">
                  Say the true count &mdash; &ldquo;minus two&rdquo;. Then &ldquo;plus&rdquo; or
                  &ldquo;minus&rdquo; to nudge it, &ldquo;yes&rdquo; to submit.
                </span>
              ) : (
                <>
                  <span className="count-voice-value">{formatSigned(pendingTc)}</span>
                  <span className="count-voice-hint">
                    &ldquo;yes&rdquo; to submit &middot; &ldquo;no&rdquo; to start over
                  </span>
                </>
              )}
            </div>
          )}
          <NumPad label="Enter the true count" onSubmit={handleSubmit} />
        </>
      )}

      {/*
        Eyes-free verdict. Two zones splitting the whole area so either can
        be hit without looking -- the same reasoning as the count drill's,
        and the reason these are not a pair of ordinary buttons.
      */}
      {phase === 'selfreport' && question && (
        <div className="selfreport-area">
          <div className="selfreport-question">
            The true count was {formatSigned(question.correctTc)}. Did you have it?
          </div>
          {voiceOn && (
            <div className="selfreport-voice-hint">or say &ldquo;yes&rdquo; / &ldquo;no&rdquo;</div>
          )}
          <button
            type="button"
            className="selfreport-zone selfreport-yes"
            onClick={() => handleSelfReport(true)}
          >
            I had it
          </button>
          <button
            type="button"
            className="selfreport-zone selfreport-no"
            onClick={() => handleSelfReport(false)}
          >
            I missed it
          </button>
        </div>
      )}

      {phase === 'result' && honorCheck && question && (
        <div className="drill-result">
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-question">
            Running count {formatSigned(question.runningCount)} &middot;{' '}
            {question.decksRemaining} {question.decksRemaining === 1 ? 'deck' : 'decks'} remaining
          </div>
          <div className="result-detail">
            The true count was {formatSigned(question.correctTc)} &mdash; self-reported, and recorded
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
          <div className="result-question">
            Running count {formatSigned(question.runningCount)} &middot;{' '}
            {question.decksRemaining} {question.decksRemaining === 1 ? 'deck' : 'decks'} remaining
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
