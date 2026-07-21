import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import type { Card } from '../../../engine/cards';
import { hiLoTag } from '../../../engine/count';
import { makeCountDrill, makeCountdown } from '../../../drills/countDrill';
import type { CountDrillRound, CountdownRound } from '../../../drills/countDrill';
import { loadStats, saveStats, saveSettings } from '../../../store/persist';
import { PlayingCard } from '../../components/PlayingCard';
import { NumPad } from '../../components/NumPad';
import { Segmented, Stepper } from '../Settings';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, speak, speakAsync } from '../../../audio/speech';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import { narrateCards, narrateCountAnswer, narrateCountPrompt } from '../../../audio/narrate';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Plain cancelable-by-caller delay -- the caller re-checks staleness after
 * the await resolves rather than this helper aborting itself. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 'selfcheck' is the eyes-free honor-system self-check: prompt spoken, a
// pause, then the answer spoken -- no keypad, no grading (see Task 7 in the
// cycle-3 plan). Distinct from 'answering', which still shows the NumPad
// (used by the visual flow AND by eyes-free "strict mode").
type CountPhase = 'setup' | 'flashing' | 'answering' | 'selfcheck' | 'result';

export function CountDrillView({
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
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 7): toggles are local UI state, not persisted
  // settings -- they're per-session choices scoped to this drill screen.
  const [eyesFree, setEyesFree] = useState(false);
  const [strictMode, setStrictMode] = useState(false);
  // True when the just-finished 'result' came from the honor-system
  // self-check path (spoken answer, no keypad) rather than a graded entry --
  // the result screen renders a different message and skips the stats write
  // for that path (no explicit answer was ever taken, so nothing to grade).
  const [honorCheck, setHonorCheck] = useState(false);
  // Bumped on every start() so a stale setTimeout from a previous run (see
  // the 'selfcheck' effect below) can recognize itself as stale and no-op,
  // even though the effect's own cleanup already clears its timer on
  // teardown -- belt-and-suspenders per the cycle-2 timer-discipline lesson.
  const runIdRef = useRef(0);

  // Eyes-free requires audio to be enabled; if the user disables audio
  // (e.g. via Settings) while it's checked, drop it rather than leave a
  // checked-but-disabled control.
  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  // Decides what comes after the last card: the eyes-free honor-system
  // self-check (spoken-only), or the existing 'answering' phase (NumPad /
  // strict-mode keypad / countdown tag-guess). Defined ahead of the effects
  // below so it's a plain in-scope reference at the point they call it
  // (those calls only ever fire from a later setTimeout/tap, well after this
  // render's declarations have run) rather than a forward reference.
  const enterAnswerPhase = () => {
    setPhase(eyesFree && !strictMode && !countdownMode ? 'selfcheck' : 'answering');
  };

  // Completes the honor-system self-check: no keypad entry was ever taken,
  // so there is nothing to grade -- just record the spoken answer for the
  // result screen and stop. See the "eyes-free strictly additive" note in
  // the cycle-3 plan's Global Constraints: grading/stats stay exactly as
  // they were before this task for every OTHER path; this path simply never
  // had a graded entry to begin with.
  const finishSelfCheck = (actual: number) => {
    setActualValue(actual);
    setHonorCheck(true);
    setPhase('result');
  };

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

  // Visual-mode (non-eyes-free) fixed-interval advance -- UNCHANGED behavior.
  // Eyes-free auto mode is driven by speech instead (see the effect below),
  // so it's explicitly excluded here rather than sharing this timer.
  useEffect(() => {
    if (phase !== 'flashing' || groups.length === 0 || settings.drill.countManual || eyesFree) {
      return undefined;
    }

    if (shownIndex >= groups.length - 1) {
      const t = setTimeout(() => enterAnswerPhase(), settings.drill.countIntervalMs);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setShownIndex((i) => i + 1), settings.drill.countIntervalMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    phase,
    shownIndex,
    groups.length,
    settings.drill.countIntervalMs,
    settings.drill.countManual,
    eyesFree,
    strictMode,
    countdownMode,
  ]);

  // Eyes-free AUTO (timed) mode: speech drives the pace instead of a fixed
  // timer. The old bug -- a fixed setTimeout kept advancing shownIndex while
  // window.speechSynthesis.speak() silently QUEUED each utterance -- meant
  // speech fell further behind the display with every card and could never
  // catch up. Here we instead: speak the current group, `await` it actually
  // finishing (speakAsync resolves on onend/onerror/watchdog), wait the
  // configured inter-card gap (countIntervalMs repurposed as a gap rather
  // than a cadence), then advance. The display only moves once its narration
  // is done, so the two can never drift.
  //
  // Manual mode and visual mode are untouched by this effect (guarded out
  // below) -- manual advance narrates via the shownIndex-reactive effect
  // beneath this one; visual auto advance is the timer effect above.
  //
  // Async/unmount safety: `runId` is captured once, up front, from the same
  // `runIdRef` bumped by start()/handleBack()/unmount so any of those make
  // every future staleness check fail immediately -- no reliance on effect
  // cleanup ordering relative to the resumed await. `cancelled` is set by
  // this effect's own cleanup (phase change, unmount, or a dep change) and
  // is checked together with runId via `isStale()` after every await, so an
  // await that resumes into a torn-down run bails before touching state.
  // Because React always runs this cleanup before starting a new instance of
  // this effect, and the cleanup force-resolves any in-flight speakAsync via
  // cancelSpeech(), at most one loop can ever be advancing state at a time.
  useEffect(() => {
    if (
      phase !== 'flashing' ||
      groups.length === 0 ||
      !eyesFree ||
      settings.drill.countManual ||
      countdownMode
    ) {
      return undefined;
    }

    const runId = runIdRef.current;
    let cancelled = false;
    const rate = settings.audio.rate;
    const voiceURI = settings.audio.voiceURI;
    const gapMs = settings.drill.countIntervalMs;
    const isStale = () => cancelled || runIdRef.current !== runId;

    const run = async () => {
      let i = shownIndex;
      while (!isStale()) {
        const g = groups[i];
        if (!g) return;

        await speakAsync(narrateCards(g), { rate, voiceURI });
        if (isStale()) return;

        if (i >= groups.length - 1) {
          enterAnswerPhase();
          return;
        }

        if (gapMs > 0) {
          await delay(gapMs);
          if (isStale()) return;
        }

        i += 1;
        setShownIndex(i);
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, groups.length, eyesFree, settings.drill.countManual, countdownMode]);

  // Narrate each card group as it's shown. Visual mode speaks only at
  // verbosity 'full' (existing Task 5 behavior, UNCHANGED); eyes-free MANUAL
  // mode speaks regardless of verbosity, with `interrupt: true` so a fast
  // tap cuts off whatever the previous card's narration was still saying
  // rather than letting it queue and fall behind. Eyes-free AUTO (timed)
  // mode is excluded here -- it narrates inline as part of its own
  // speech-driven loop above, so this would otherwise double-speak.
  // Countdown mode's hidden-tag guess isn't a running-count answer, so it's
  // excluded from eyes-free entirely (see the setup section below). Reacts
  // to the existing phase/shownIndex state rather than owning a timer of its
  // own, so a fresh start() naturally re-triggers it -- nothing here can go
  // stale.
  useEffect(() => {
    if (phase !== 'flashing' || countdownMode) return;
    if (eyesFree && !settings.drill.countManual) return;
    const g = groups[shownIndex];
    if (!g) return;
    if (eyesFree) {
      speak(narrateCards(g), {
        interrupt: true,
        rate: settings.audio.rate,
        voiceURI: settings.audio.voiceURI,
      });
    } else {
      audio.sayFull(narrateCards(g));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shownIndex, countdownMode, groups, eyesFree, settings.drill.countManual]);

  // Announce the running-count prompt once the flash sequence completes and
  // the NumPad phase is reached (visual mode: only at verbosity 'full';
  // eyes-free "strict mode", which also lands on 'answering', always hears
  // it). The eyes-free honor-system path never reaches 'answering' -- it has
  // its own prompt+pause+answer effect below.
  useEffect(() => {
    if (phase !== 'answering' || countdownMode) return;
    if (eyesFree) {
      speak(narrateCountPrompt(), { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });
    } else {
      audio.sayFull(narrateCountPrompt());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdownMode, eyesFree]);

  // Eyes-free honor-system self-check: speak the prompt, wait the
  // configured pause, then speak the answer -- no keypad, no grading. Guards
  // against a stale timer two ways: the effect's own cleanup (fires
  // automatically when `phase` changes away from 'selfcheck', e.g. a fast
  // Replay) AND a runId comparison inside the callback, per the cycle-2
  // timer-discipline lesson.
  useEffect(() => {
    if (phase !== 'selfcheck') return undefined;
    const runId = runIdRef.current;
    const rate = settings.audio.rate;
    const voiceURI = settings.audio.voiceURI;
    speak(narrateCountPrompt(), { rate, voiceURI });
    const t = setTimeout(() => {
      if (runIdRef.current !== runId || !drillRound) return;
      speak(narrateCountAnswer(drillRound.finalRc), { rate, voiceURI });
      finishSelfCheck(drillRound.finalRc);
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
      // Safety net for unmounts that don't go through handleBack (e.g. a
      // parent-level navigation) -- same runId-bump + cancelSpeech pattern so
      // any in-flight speech-driven loop dies immediately rather than
      // resuming into a torn-down component.
      runIdRef.current += 1;
      cancelSpeech();
      void releaseWakeLock();
    };
  }, []);

  const advanceManual = () => {
    if (shownIndex >= groups.length - 1) {
      enterAnswerPhase();
    } else {
      setShownIndex((i) => i + 1);
    }
  };

  const start = () => {
    runIdRef.current += 1;
    // Cancel any trailing speech from the previous round (e.g. a verdict or
    // self-check answer still playing) so it can't bleed into / queue ahead
    // of the new round's narration.
    cancelSpeech();
    const seed = randomSeed();
    if (countdownMode) {
      setCountdownRound(makeCountdown(seed));
      setDrillRound(null);
    } else {
      setDrillRound(makeCountDrill(settings.drill.countLengthCards, settings.drill.countGroup, seed));
      setCountdownRound(null);
    }
    setShownIndex(0);
    setHonorCheck(false);
    setPhase('flashing');
    if (eyesFree) {
      void requestWakeLock();
    }
  };

  const handleBack = () => {
    // Bump runId synchronously (before onBack triggers any unmount) so any
    // in-flight speech-driven loop's next staleness check fails immediately,
    // regardless of exactly when React runs this component's own unmount
    // cleanup relative to a resumed await. cancelSpeech() then force-resolves
    // whatever speakAsync call is currently pending so that check runs soon.
    runIdRef.current += 1;
    cancelSpeech();
    void releaseWakeLock();
    onBack();
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
    const correct = value === drillRound.finalRc;
    finishRun(correct, drillRound.finalRc, value);
    const verdict = `${correct ? 'Correct.' : 'Wrong.'} ${narrateCountAnswer(drillRound.finalRc)}`;
    if (eyesFree) {
      // Strict eyes-free: speak the verdict regardless of verbosity -- it's
      // the primary output channel in this mode, not decoration.
      speak(verdict, { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });
    } else {
      audio.sayFull(verdict);
    }
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
        <button type="button" className="drill-back-btn" onClick={handleBack}>
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

          {!countdownMode && (
            <>
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
            </>
          )}

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

      {phase === 'selfcheck' && (
        <div className="count-flash-area">
          <div className="count-flash-progress">Listen for the running count&hellip;</div>
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

      {phase === 'result' && honorCheck && (
        <div className="drill-result">
          <div className="result-correct">Count announced</div>
          <div className="result-detail">
            The count was {actualValue} &mdash; self-check, no grade recorded
          </div>
          <button type="button" className="drill-replay-btn" onClick={start}>
            Replay
          </button>
          <button type="button" className="drill-back-btn" onClick={handleBack}>
            Back to Drills
          </button>
        </div>
      )}

      {phase === 'result' && !honorCheck && (
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
          <button type="button" className="drill-back-btn" onClick={handleBack}>
            Back to Drills
          </button>
        </div>
      )}
    </div>
  );
}
