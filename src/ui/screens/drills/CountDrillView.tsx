import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import type { Card } from '../../../engine/cards';
import { hiLoTag } from '../../../engine/count';
import { makeCountDrill, makeCountdown } from '../../../drills/countDrill';
import type { CountDrillRound, CountdownRound } from '../../../drills/countDrill';
import { classifySpeed, formatDuration, rampIntervalMs, secondsPerDeck } from '../../../drills/countSpeed';
import type { SpeedTier } from '../../../drills/countSpeed';
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

// Display-only tier labels for the Timed Challenge result screen -- kept
// here rather than in drills/countSpeed.ts since that module is pure
// speed math with zero UI/display concerns.
const TIER_LABEL: Record<SpeedTier, string> = {
  learning: 'Learning',
  'table-ready': 'Table-ready',
  pro: 'Pro',
  expert: 'Expert',
};

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

  // TIMED CHALLENGE: a per-session toggle (like eyesFree/strictMode above,
  // not a persisted setting) that forces cards to auto-advance on a RAMPING
  // interval (drills/countSpeed.ts rampIntervalMs) regardless of the
  // Manual/Timed Mode segmented control, then grades speed alongside
  // correctness. Only offered for the main count drill, not Countdown mode
  // (see the `!countdownMode` guard in the setup JSX below).
  const [timedChallenge, setTimedChallenge] = useState(false);
  // Set (via performance.now(), never Date.now() at module scope -- this is
  // a live UI concern, the pure math in countSpeed.ts never touches the
  // clock) at the start of a timed run; read once the ramp finishes to
  // compute elapsed time. null when the current run isn't timed.
  const timedStartRef = useRef<number | null>(null);
  // Populated right as the ramp completes (before entering the answer
  // phase) so it survives into the result screen even though timedChallenge
  // itself could theoretically change later. Deliberately a flat
  // {elapsedMs, cardsShown} pair rather than a pre-computed tier/spd --
  // keeps the derivation (secondsPerDeck/classifySpeed) reusable by a
  // future telemetry hook without rework.
  const [timedResult, setTimedResult] = useState<{ elapsedMs: number; cardsShown: number } | null>(
    null,
  );

  // Eyes-free requires audio to be enabled; if the user disables audio
  // (e.g. via Settings) while it's checked, drop it rather than leave a
  // checked-but-disabled control.
  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  // Timed Challenge is only offered for the main count drill (see the
  // `!countdownMode` guard around its setup checkbox); drop it if the user
  // switches to Countdown mode while it's checked, same pattern as the
  // eyes-free auto-drop above.
  useEffect(() => {
    if (countdownMode) setTimedChallenge(false);
  }, [countdownMode]);

  // Decides what comes after the last card: the eyes-free honor-system
  // self-check (spoken-only), or the existing 'answering' phase (NumPad /
  // strict-mode keypad / countdown tag-guess). Defined ahead of the effects
  // below so it's a plain in-scope reference at the point they call it
  // (those calls only ever fire from a later setTimeout/tap, well after this
  // render's declarations have run) rather than a forward reference.
  const enterAnswerPhase = () => {
    // Timed Challenge always grades (never the honor-system self-check) --
    // the whole point is a scored count + a scored speed, per the "a fast
    // wrong answer is still wrong" requirement.
    setPhase(eyesFree && !strictMode && !countdownMode && !timedChallenge ? 'selfcheck' : 'answering');
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
    if (
      phase !== 'flashing' ||
      groups.length === 0 ||
      settings.drill.countManual ||
      eyesFree ||
      timedChallenge
    ) {
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
    timedChallenge,
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
      countdownMode ||
      timedChallenge
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

        await speakAsync(narrateCards(g, settings.audio.cardDetail), { rate, voiceURI });
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
  }, [phase, groups.length, eyesFree, settings.drill.countManual, countdownMode, timedChallenge]);

  // Narrate each card group as it's shown. Visual mode speaks only at
  // verbosity 'full' (existing Task 5 behavior, UNCHANGED); eyes-free MANUAL
  // mode speaks regardless of verbosity, with `interrupt: true` so a fast
  // tap cuts off whatever the previous card's narration was still saying
  // rather than letting it queue and fall behind. Eyes-free AUTO (timed)
  // mode is excluded here -- it narrates inline as part of its own
  // speech-driven loop above, so this would otherwise double-speak. Timed
  // CHALLENGE mode (timedChallenge) is an exception to that exclusion: its
  // ramp effect never speech-paces (a hard deadline can't wait on speech to
  // finish), so it falls through to this same interrupt:true narration
  // instead, same as eyes-free MANUAL.
  // Countdown mode's hidden-tag guess isn't a running-count answer, so it's
  // excluded from eyes-free entirely (see the setup section below). Reacts
  // to the existing phase/shownIndex state rather than owning a timer of its
  // own, so a fresh start() naturally re-triggers it -- nothing here can go
  // stale.
  useEffect(() => {
    if (phase !== 'flashing' || countdownMode) return;
    if (eyesFree && !settings.drill.countManual && !timedChallenge) return;
    const g = groups[shownIndex];
    if (!g) return;
    if (eyesFree) {
      speak(narrateCards(g, settings.audio.cardDetail), {
        interrupt: true,
        rate: settings.audio.rate,
        voiceURI: settings.audio.voiceURI,
      });
    } else {
      audio.sayFull(narrateCards(g, settings.audio.cardDetail));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shownIndex, countdownMode, groups, eyesFree, settings.drill.countManual, timedChallenge]);

  // TIMED CHALLENGE ramp: cards auto-advance on a geometrically SHRINKING
  // interval (drills/countSpeed.ts rampIntervalMs), regardless of the
  // Manual/Timed Mode segmented control or eyes-free's own speech-driven
  // pacing (both guarded out above via !timedChallenge) -- only one loop
  // may ever be advancing shownIndex at a time. Right as the last card's
  // interval elapses, this records elapsedMs (performance.now() minus the
  // start() timestamp in timedStartRef) into timedResult before entering
  // the answer phase, so the result screen can report speed alongside
  // correctness. Cleanup clears the pending timeout on every dep change /
  // unmount, same discipline as the plain fixed-interval effect above.
  useEffect(() => {
    if (phase !== 'flashing' || groups.length === 0 || countdownMode || !timedChallenge) {
      return undefined;
    }

    const ms = rampIntervalMs(shownIndex, settings.drill.countTimedStartMs);

    if (shownIndex >= groups.length - 1) {
      const t = setTimeout(() => {
        if (timedStartRef.current !== null) {
          setTimedResult({
            elapsedMs: performance.now() - timedStartRef.current,
            cardsShown: settings.drill.countLengthCards,
          });
        }
        enterAnswerPhase();
      }, ms);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setShownIndex((i) => i + 1), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    phase,
    shownIndex,
    groups.length,
    settings.drill.countTimedStartMs,
    settings.drill.countLengthCards,
    countdownMode,
    timedChallenge,
  ]);

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
    setTimedResult(null);
    // Read the clock here (a live UI concern), never inside drills/countSpeed.ts
    // -- that module stays pure and deterministic for unit testing.
    timedStartRef.current = timedChallenge && !countdownMode ? performance.now() : null;
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

    const stats = loadStats();

    // Timed Challenge runs are graded on speed as well as correctness, and
    // that's a materially different metric than the plain count drill's
    // intervalMs (a fixed pace, not an elapsed-time result) -- they go to
    // their own timedCount.history rather than double-counting into
    // countDrill.history alongside ordinary runs. Countdown mode always has
    // timedChallenge=false (see the effect that drops it on mode switch),
    // so this branch can only ever fire for the main count drill.
    if (timedChallenge && timedResult) {
      const spd = secondsPerDeck(timedResult.elapsedMs, timedResult.cardsShown);
      const tier = classifySpeed(spd);
      saveStats({
        ...stats,
        timedCount: {
          history: [
            ...stats.timedCount.history,
            {
              date: new Date().toISOString(),
              cards: timedResult.cardsShown,
              elapsedMs: timedResult.elapsedMs,
              secondsPerDeck: spd,
              tier,
              correct,
            },
          ],
        },
      });
      return;
    }

    const cardsInRun = countdownMode ? 52 : settings.drill.countLengthCards;
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
      // Timed Challenge: also speak the speed tier, using the same
      // direct-speak pattern (no new narration helper -- a plain templated
      // string). Queues naturally after the verdict above (no interrupt),
      // same as any other sequential eyes-free narration in this file.
      if (timedResult) {
        const spd = secondsPerDeck(timedResult.elapsedMs, timedResult.cardsShown);
        const tier = TIER_LABEL[classifySpeed(spd)];
        speak(`${formatDuration(timedResult.elapsedMs)}, ${spd.toFixed(1)} seconds per deck. ${tier}.`, {
          rate: settings.audio.rate,
          voiceURI: settings.audio.voiceURI,
        });
      }
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
                  checked={timedChallenge}
                  onChange={(e) => setTimedChallenge(e.target.checked)}
                />
                Timed challenge (speed ramp)
              </label>
              {timedChallenge && (
                <>
                  <div className="settings-row settings-note-row">
                    Auto-advances and speeds up each card, regardless of Mode above.
                  </div>
                  <Stepper
                    label="Starting pace"
                    value={settings.drill.countTimedStartMs}
                    min={300}
                    max={2000}
                    step={100}
                    format={(v) => `${v}ms`}
                    onChange={(v) => updateDrill({ countTimedStartMs: v })}
                  />
                </>
              )}
            </>
          )}

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

      {phase === 'flashing' && settings.drill.countManual && !timedChallenge && (
        <div className="manual-tap-zone" onClick={advanceManual}>
          <div className="count-flash-cards">
            {currentGroup?.map((c, i) => <PlayingCard key={i} card={c} />)}
          </div>
          <div className="manual-tap-hint">
            tap to advance &middot; {shownIndex + 1}/{groups.length}
          </div>
        </div>
      )}

      {phase === 'flashing' && (!settings.drill.countManual || timedChallenge) && (
        <div className="count-flash-area">
          <div className="count-flash-cards">
            {currentGroup?.map((c, i) => <PlayingCard key={i} card={c} />)}
          </div>
          <div className="count-flash-progress">
            {shownIndex + 1} / {groups.length}
            {timedChallenge && <span className="count-timed-badge">speeding up&hellip;</span>}
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
          {timedResult &&
            (() => {
              const spd = secondsPerDeck(timedResult.elapsedMs, timedResult.cardsShown);
              const tier = classifySpeed(spd);
              return (
                <div className="timed-result">
                  <div className="timed-result-time">{formatDuration(timedResult.elapsedMs)}</div>
                  <div className="timed-result-spd">{spd.toFixed(1)}s / deck</div>
                  <div className={`timed-result-tier timed-tier-${tier}`}>{TIER_LABEL[tier]}</div>
                  <div className="timed-result-benchmark">
                    Benchmarks: &le;30s table-ready &middot; &le;22s pro &middot; &le;12s expert
                  </div>
                </div>
              );
            })()}
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
