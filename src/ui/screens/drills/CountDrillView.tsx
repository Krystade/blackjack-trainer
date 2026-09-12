import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import type { Card } from '../../../engine/cards';
import { hiLoTag } from '../../../engine/count';
import { makeCountDrill, makeCountdown, runningCountThrough } from '../../../drills/countDrill';
import type { CountDrillRound, CountdownRound } from '../../../drills/countDrill';
import { makeDistraction, isDistractionPoint } from '../../../drills/distraction';
import type { Distraction } from '../../../drills/distraction';
import {
  classifySpeed,
  formatDuration,
  rampIntervalMs,
  secondsPerDeck,
  tierStartIntervalMs,
  RAMP_FLOOR_MS,
} from '../../../drills/countSpeed';
import type { SpeedTier } from '../../../drills/countSpeed';
import { computeUnlockedTier, tierAbove, SPEED_TIER_ORDER } from '../../../drills/competenceGate';
import { loadStats, saveStats, saveSettings } from '../../../store/persist';
import { PlayingCard } from '../../components/PlayingCard';
import { cardJitter, jitterTransform } from '../../../drills/cardJitter';
import { paceMultiplier } from '../../../drills/pacePressure';
import { isCountFluent } from '../../../drills/fluencyGate';
import { NumPad } from '../../components/NumPad';
import { Segmented, Stepper } from '../Settings';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, speak, speakAsync } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import { narrateCards, narrateCountAnswer, narrateCountPrompt } from '../../../audio/narrate';
import { focusSwallowsKey } from '../../keyboardFocus';
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

/** Plain cancelable-by-caller delay -- the caller re-checks staleness after
 * the await resolves rather than this helper aborting itself. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adapts a persisted `timedCount.history` array into the minimal
 * `{ tier, correct }` shape drills/competenceGate.ts's computeUnlockedTier
 * expects -- preferring the ATTEMPTED tier (the pace the run was actually
 * paced at) over the ACHIEVED tier (`tier`, classified from the run's
 * measured elapsed speed) whenever it's present, so the gate reads real
 * demonstrated-pace signal rather than a schedule-driven ramp's incidental
 * result. Entries persisted before `attemptedTier` shipped simply fall back
 * to `tier` -- close enough for old data, and never a crash. */
function mapTimedHistory(
  history: { tier: string; correct: boolean; attemptedTier?: SpeedTier }[],
): { tier: SpeedTier; correct: boolean }[] {
  return history.map((h) => ({ tier: (h.attemptedTier ?? (h.tier as SpeedTier)), correct: h.correct }));
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
// 'distraction' (D1 part 2, docs/BACKLOG.md): a mid-flash interruption --
// the card stream pauses, a distraction arithmetic challenge is posed (a
// NumPad answer, plus a live-spoken prompt in eyes-free mode), and once
// answered the stream resumes exactly where it paused. Standard count-drill
// flashing only (auto/eyes-free/manual); never entered for countdownMode or
// timedChallenge (see isDistractionPoint call sites below).
type CountPhase =
  | 'setup'
  | 'flashing'
  | 'answering'
  | 'selfcheck'
  // Eyes-free: the answer has been spoken and the drill is asking whether you
  // had it. Exists so the driving path can produce a VERDICT and a recorded
  // result -- previously it produced neither.
  | 'selfreport'
  | 'distraction'
  | 'result';

/**
 * D2: what Countdown asks for once the deck has been read out.
 *
 * The three answers are named because eyes-free there is no keypad to look
 * at, and "what is the tag" is not a question you can answer if nobody has
 * told you the shape of the answer.
 */
const COUNTDOWN_TAG_PROMPT = 'Plus one, zero, or minus one?';

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
  // V3-4 soft gate: computed once at mount (fluency doesn't change mid-session).
  const [countFluent] = useState(() => isCountFluent(loadStats().countDrill.history));
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

  // VOICE. Off until asked for, like every other microphone in the app: a
  // toggle that survived a reload would open one on page load.
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  const [voiceOn, setVoiceOn] = useState(false);
  /**
   * A spoken count, heard but not yet submitted.
   *
   * Nothing spoken is ever submitted directly. A misheard "hit" costs one
   * hand; a misheard count silently corrupts a graded run, reporting a score
   * against an answer nobody gave. So a number is a PROPOSAL, read back and
   * confirmed -- the same contract the table's count check already runs on.
   */
  const [pendingCount, setPendingCount] = useState<number | null>(null);
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

  // R2 (docs/BACKLOG.md, accuracy-gated difficulty): the effective
  // start/floor ms/card the CURRENT run's ramp effect actually uses, and the
  // tier that pace is attempting -- set once at start() (see below), read by
  // the ramp effect on every tick. Refs (not state) because they must be
  // fixed for the lifetime of a single run and reading them shouldn't
  // trigger a re-render; the ramp effect already re-reads on its own
  // shownIndex-driven schedule. `timedStartMsRef`/`timedFloorMsRef` default
  // to today's fixed-pace values so a render before the first start() (or a
  // non-adaptive run) behaves exactly as before this feature shipped.
  const attemptedTierRef = useRef<SpeedTier | null>(null);
  const timedStartMsRef = useRef<number>(settings.drill.countTimedStartMs);
  const timedFloorMsRef = useRef<number>(RAMP_FLOOR_MS);
  // Populated right alongside timedResult (in finishRun) so the result
  // screen can report whether accuracy-gated difficulty just advanced/held/
  // eased the unlocked tier. null whenever the just-finished run wasn't a
  // graded Timed Challenge run (ordinary count drill / countdown / honor
  // self-check never touch this).
  const [gateOutcome, setGateOutcome] = useState<{
    tier: SpeedTier;
    change: 'advanced' | 'held' | 'eased';
  } | null>(null);

  // D1 part 2 (docs/BACKLOG.md, distraction training): the currently-posed
  // distraction challenge, or null when not in the 'distraction' phase.
  const [distraction, setDistraction] = useState<Distraction | null>(null);
  // The seed passed to makeCountDrill/makeCountdown for the CURRENT run, set
  // once by start() -- reused (offset by the triggering card's shownIndex)
  // to seed each distraction's own makeDistraction() call, so a run is fully
  // reproducible given only its outer seed (matching the seeded idiom used
  // throughout drills/*.ts).
  const runSeedRef = useRef(0);
  // performance.now() at the moment the current distraction was posed --
  // read (never displayed) to compute its elapsedMs on answer. null when no
  // distraction is currently pending.
  const distractionShownAtRef = useRef<number | null>(null);
  // What to do once the pending distraction is answered: advance shownIndex
  // to this index, or 'finish' (the distraction was posed on the last card,
  // so resuming means entering the answer phase instead). null when no
  // distraction is pending.
  const pendingResumeRef = useRef<'finish' | number | null>(null);
  // Every distraction.history row created so far THIS run -- countKept is
  // left provisional (false) here and back-filled with the run's actual
  // final-count correctness once it's graded (finishRun below), then
  // persisted together. Cleared by start() so a run can never inherit a
  // previous run's rows (the death-race/stale-run lesson applies here too:
  // this ref, like runIdRef, must never let run N's data bleed into N+1).
  const runDistractionRowsRef = useRef<
    { date: string; kind: Distraction['kind']; answerCorrect: boolean; countKept: boolean; elapsedMs?: number }[]
  >([]);

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
  /**
   * The answer has just been spoken. Ask whether the operator had it.
   *
   * This used to jump straight to a result that said "self-check, no grade
   * recorded" -- so eyes-free drilling, i.e. the whole point of the app in a
   * car, gave no verdict and wrote nothing to Stats. Strict mode did grade,
   * but only via keypad entry, which is exactly what you cannot do while
   * driving. A spoken question plus a two-zone tap closes that gap without
   * asking anyone to look at the screen or type.
   */
  const finishSelfCheck = (actual: number) => {
    setActualValue(actual);
    setHonorCheck(true);
    setPhase('selfreport');
  };

  /** The eyes-free verdict: recorded exactly like a keypad run. */
  const handleSelfReport = (correct: boolean) => {
    speak(correct ? 'Correct.' : 'Wrong.', speechOptsFrom(settings.audio, { interrupt: true }));
    finishRun(correct, actualValue, actualValue);
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

  // D1 part 2 (docs/BACKLOG.md, distraction training): pause the flashing
  // stream and pose a distraction. Called from all three of the standard
  // count drill's advance mechanisms (the fixed-interval effect, the
  // eyes-free speech loop, and manual tap) right at the moment they would
  // otherwise advance past `idxAtTrigger` -- never from Countdown mode or
  // Timed Challenge, both out of scope for D1 v1 (see each call site's own
  // guard). `isLast` tells the resume step (handleDistractionSubmit below)
  // whether resuming means showing the next card or entering the answer
  // phase, exactly mirroring what the caller would have done had no
  // distraction fired.
  //
  // The running count fed to makeDistraction is a PRIVATE computation --
  // runningCountThrough's result is read here and passed straight into
  // makeDistraction, never assigned to any piece of state and never touched
  // by narration/JSX, so there is no code path that could accidentally
  // display or speak it (the whole point of the drill is testing whether
  // the user can keep it in their own head through the interruption).
  const triggerDistraction = (idxAtTrigger: number, isLast: boolean) => {
    const rc = runningCountThrough(groups, idxAtTrigger);
    const seed = runSeedRef.current + idxAtTrigger;
    const d = makeDistraction(rc, settings.drill.distractionMode, seed);
    setDistraction(d);
    distractionShownAtRef.current = performance.now();
    pendingResumeRef.current = isLast ? 'finish' : idxAtTrigger + 1;
    setPhase('distraction');
    if (eyesFree) {
      // Live TTS, not a clip/narration helper -- the math is dynamic per
      // trigger, so no pre-rendered clip could ever cover it.
      speak(d.prompt, speechOptsFrom(settings.audio, { interrupt: true }));
    }
  };

  // Visual-mode (non-eyes-free) fixed-interval advance -- UNCHANGED behavior
  // apart from the D1 distraction check below. Eyes-free auto mode is driven
  // by speech instead (see the effect below), so it's explicitly excluded
  // here rather than sharing this timer.
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

    const isLast = shownIndex >= groups.length - 1;
    const t = setTimeout(() => {
      // D1 part 2: countdownMode (tag-guess) is out of scope -- Timed
      // Challenge never reaches this effect at all (guarded above), so it
      // needs no separate check here. `distractionFreq: 'off'` (the
      // shipped default) makes isDistractionPoint always false, so this is
      // a pure no-op until a user opts in.
      if (!countdownMode && isDistractionPoint(shownIndex, settings.drill.distractionFreq)) {
        triggerDistraction(shownIndex, isLast);
        return;
      }
      if (isLast) enterAnswerPhase();
      else setShownIndex((i) => i + 1);
      // ET7: adversarial dealer-pace pressure -- a seeded speed-up burst shortens
      // THIS card's interval, then recovers (paceMultiplier returns 1 off-burst,
      // and always 1 when the toggle is off, so default pacing is byte-identical).
    }, settings.drill.countIntervalMs * (settings.drill.pacePressure ? paceMultiplier(runSeedRef.current, shownIndex) : 1));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    phase,
    shownIndex,
    groups.length,
    settings.drill.countIntervalMs,
    settings.drill.countManual,
    settings.drill.distractionFreq,
    settings.drill.pacePressure,
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
      timedChallenge
    ) {
      return undefined;
    }

    const runId = runIdRef.current;
    let cancelled = false;
    const gapMs = settings.drill.countIntervalMs;
    const isStale = () => cancelled || runIdRef.current !== runId;

    const run = async () => {
      let i = shownIndex;
      while (!isStale()) {
        const g = groups[i];
        if (!g) return;

        await speakAsync(narrateCards(g, settings.audio.cardDetail), speechOptsFrom(settings.audio));
        if (isStale()) return;

        const isLast = i >= groups.length - 1;

        // D1 part 2 (docs/BACKLOG.md, distraction training): pause here --
        // triggerDistraction flips `phase` away from 'flashing', which this
        // effect's own cleanup (below) reacts to (cancelled=true +
        // cancelSpeech()), tearing this loop down entirely. Resuming
        // (handleDistractionSubmit) flips `phase` back to 'flashing' with
        // shownIndex already advanced past `i`, mounting a FRESH instance of
        // this same effect that picks up exactly there. That gives the
        // "await the distraction resolution before speaking the next card"
        // guarantee for free: the next card's speakAsync literally cannot
        // start running until the distraction is answered, without needing
        // an in-closure await spanning the interruption itself.
        if (isDistractionPoint(i, settings.drill.distractionFreq)) {
          triggerDistraction(i, isLast);
          return;
        }

        if (isLast) {
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
  }, [
    phase,
    groups.length,
    eyesFree,
    settings.drill.countManual,
    settings.drill.distractionFreq,
    countdownMode,
    timedChallenge,
  ]);

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
    // D2: Countdown is no longer excluded. It was the one mode whose cards
    // were never spoken, which made it the one mode you could not run without
    // looking -- and reading fifty-one cards out is the entire drill.
    if (phase !== 'flashing') return;
    if (eyesFree && !settings.drill.countManual && !timedChallenge) return;
    const g = groups[shownIndex];
    if (!g) return;
    if (eyesFree) {
      speak(narrateCards(g, settings.audio.cardDetail), speechOptsFrom(settings.audio, { interrupt: true }));
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
  //
  // R2 (docs/BACKLOG.md, accuracy-gated difficulty): the start/floor ms fed
  // to rampIntervalMs come from timedStartMsRef/timedFloorMsRef, set once by
  // start() below -- NOT read directly from settings.drill.countTimedStartMs
  // here, so a mid-run render can't silently change a run's pace. In
  // adaptive mode those refs are both set to the SAME value
  // (tierStartIntervalMs(unlockedTier)), so the ramp is flat at exactly the
  // earned tier's pace for the whole run -- the fix for the studied bug
  // (a fixed decaying ramp inflates scores by speeding up regardless of
  // accuracy): the run never accelerates past what's actually been earned.
  // Non-adaptive mode leaves both refs at their pre-R2 defaults
  // (countTimedStartMs / RAMP_FLOOR_MS), so its ramp is byte-for-byte the
  // same schedule as before this feature shipped.
  useEffect(() => {
    if (phase !== 'flashing' || groups.length === 0 || countdownMode || !timedChallenge) {
      return undefined;
    }

    const ms = rampIntervalMs(shownIndex, timedStartMsRef.current, { floorMs: timedFloorMsRef.current });

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
      speak(narrateCountPrompt(), speechOptsFrom(settings.audio));
    } else {
      audio.sayFull(narrateCountPrompt());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdownMode, eyesFree]);

  /**
   * D2: the Countdown prompt, eyes-free.
   *
   * The running-count prompt above skips this mode because the question is a
   * different one -- not "what is the count" but "what is the one card that
   * never came out". Saying the three answers is not padding: it is how a
   * driver learns the vocabulary this prompt accepts without reading it.
   */
  useEffect(() => {
    if (phase !== 'answering' || !countdownMode || !eyesFree) return;
    speak(COUNTDOWN_TAG_PROMPT, speechOptsFrom(settings.audio));
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
    speak(narrateCountPrompt(), speechOptsFrom(settings.audio));
    const t = setTimeout(() => {
      if (runIdRef.current !== runId || !drillRound) return;
      speak(narrateCountAnswer(drillRound.finalRc), speechOptsFrom(settings.audio));
      speak('Did you have it?', speechOptsFrom(settings.audio));
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
    const isLast = shownIndex >= groups.length - 1;
    // D1 part 2: this tap zone is shared with Countdown mode's manual
    // advance (see the JSX below), which is out of scope for distractions --
    // guard it out explicitly rather than relying on distractionFreq alone.
    if (!countdownMode && isDistractionPoint(shownIndex, settings.drill.distractionFreq)) {
      triggerDistraction(shownIndex, isLast);
      return;
    }
    if (isLast) {
      enterAnswerPhase();
    } else {
      setShownIndex((i) => i + 1);
    }
  };

  // Desktop keyboard input (operator request): Space/Enter/ArrowRight
  // advance the manual-tap flash exactly like tapping the drill area --
  // calls the SAME advanceManual used by the onClick below, so pacing/
  // narration behavior can't drift between a tap and a keypress. Gated to
  // the exact phase/mode the manual-tap-zone itself renders under (see the
  // JSX below), so it's a no-op outside that state and never fights the
  // timed/auto-advance effects above. NumPad's own keydown listener (see
  // src/ui/components/NumPad.tsx) covers the running-count entry phase.
  useEffect(() => {
    if (phase !== 'flashing' || !settings.drill.countManual || timedChallenge) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advanceManual();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, settings.drill.countManual, timedChallenge, shownIndex, groups.length]);

  const start = () => {
    runIdRef.current += 1;
    // Cancel any trailing speech from the previous round (e.g. a verdict or
    // self-check answer still playing) so it can't bleed into / queue ahead
    // of the new round's narration.
    cancelSpeech();
    const seed = randomSeed();
    // D1 part 2: this run's own distraction seed base (see triggerDistraction
    // above) and its accumulated distraction.history rows -- cleared here so
    // a fresh run/Replay can never inherit a previous run's rows.
    runSeedRef.current = seed;
    runDistractionRowsRef.current = [];
    setDistraction(null);
    distractionShownAtRef.current = null;
    pendingResumeRef.current = null;
    if (countdownMode) {
      setCountdownRound(makeCountdown(seed));
      setDrillRound(null);
    } else {
      // R8/CM#1: apply the adversarial same-sign bias only to the ORDINARY
      // count drill, never a Timed Challenge run -- a biased shoe is harder in
      // the sign-traversal dimension, which would contaminate the speed-tier
      // grading the Timed Challenge feeds into R2's competence gate.
      const bias = timedChallenge ? 'none' : settings.drill.countBias;
      setDrillRound(makeCountDrill(settings.drill.countLengthCards, settings.drill.countGroup, seed, bias));
      setCountdownRound(null);
    }
    setShownIndex(0);
    setHonorCheck(false);
    setTimedResult(null);
    setGateOutcome(null);

    // R2 (docs/BACKLOG.md, accuracy-gated difficulty): decide THIS run's
    // effective ramp start/floor before it begins, so the ramp effect above
    // never has to reach into settings/stats itself. Adaptive mode derives
    // both from the competence gate's currently-unlocked tier (start==floor
    // -- see the ramp effect's comment for why); non-adaptive keeps today's
    // fixed-pace values byte-for-byte. attemptedTierRef is set the SAME way
    // regardless of mode (classified from whatever pace is actually used) so
    // every timed run -- adaptive or not -- feeds the gate real signal.
    if (timedChallenge && !countdownMode) {
      const startMs = settings.drill.timedAdaptive
        ? tierStartIntervalMs(computeUnlockedTier(mapTimedHistory(loadStats().timedCount.history)).unlockedTier)
        : settings.drill.countTimedStartMs;
      timedStartMsRef.current = startMs;
      timedFloorMsRef.current = settings.drill.timedAdaptive ? startMs : RAMP_FLOOR_MS;
      attemptedTierRef.current = classifySpeed(secondsPerDeck(startMs, 1));
    } else {
      attemptedTierRef.current = null;
    }

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

    // D1 part 2 (docs/BACKLOG.md, distraction training): countKept back-fill
    // -- every distraction posed DURING this run gets graded on whether the
    // run's FINAL count survived the interruption(s), which is only known
    // now. Empty for countdownMode/timedChallenge runs (distractions never
    // trigger there -- see each advance mechanism's guard), so this is a
    // pure no-op for them; `statsWithDistraction` is just `stats` unchanged
    // in that case (same reference, no spread needed).
    const distractionRows = runDistractionRowsRef.current.map((row) => ({ ...row, countKept: correct }));
    const statsWithDistraction =
      distractionRows.length === 0
        ? stats
        : { ...stats, distraction: { history: [...stats.distraction.history, ...distractionRows] } };

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
      const newEntry = {
        date: new Date().toISOString(),
        cards: timedResult.cardsShown,
        elapsedMs: timedResult.elapsedMs,
        secondsPerDeck: spd,
        tier,
        correct,
        // R2: the tier this run was PACED at (see start()), distinct from
        // `tier` above (the ACHIEVED tier from the run's measured speed) --
        // always set for a Timed Challenge run, adaptive or not.
        ...(attemptedTierRef.current ? { attemptedTier: attemptedTierRef.current } : {}),
      };
      saveStats({
        ...statsWithDistraction,
        timedCount: { history: [...stats.timedCount.history, newEntry] },
      });

      // R2: report whether accuracy-gated difficulty advanced/held/eased the
      // unlocked tier as a RESULT of this run -- compare the gate's verdict
      // just before vs. just after this run's entry is folded in. Computed
      // regardless of whether THIS run was paced adaptively: the gate is a
      // property of the whole history, useful feedback either way.
      const before = computeUnlockedTier(mapTimedHistory(stats.timedCount.history));
      const after = computeUnlockedTier(mapTimedHistory([...stats.timedCount.history, newEntry]));
      const beforeRank = SPEED_TIER_ORDER.indexOf(before.unlockedTier);
      const afterRank = SPEED_TIER_ORDER.indexOf(after.unlockedTier);
      setGateOutcome({
        tier: after.unlockedTier,
        change: afterRank > beforeRank ? 'advanced' : afterRank < beforeRank ? 'eased' : 'held',
      });
      return;
    }

    const cardsInRun = countdownMode ? 52 : settings.drill.countLengthCards;
    const updated = {
      ...statsWithDistraction,
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

  // D1 part 2 (docs/BACKLOG.md, distraction training): grades the posed
  // distraction's own arithmetic, records a (provisional-countKept) row into
  // this run's collector, then resumes the flashing stream exactly where it
  // paused -- either the next card (pendingResumeRef holds its shownIndex)
  // or the answer phase (pendingResumeRef === 'finish'), mirroring exactly
  // what the triggering advance mechanism would have done had no
  // distraction fired.
  const handleDistractionSubmit = (value: number) => {
    if (!distraction) return;
    const shownAt = distractionShownAtRef.current;
    const elapsedMs = shownAt !== null ? performance.now() - shownAt : undefined;
    const answerCorrect = value === distraction.answer;
    runDistractionRowsRef.current = [
      ...runDistractionRowsRef.current,
      {
        date: new Date().toISOString(),
        kind: distraction.kind,
        answerCorrect,
        // Provisional -- back-filled with the run's actual final-count
        // correctness in finishRun once the run itself is graded.
        countKept: false,
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      },
    ];

    const resume = pendingResumeRef.current;
    pendingResumeRef.current = null;
    setDistraction(null);
    distractionShownAtRef.current = null;

    if (resume === 'finish') {
      enterAnswerPhase();
    } else if (typeof resume === 'number') {
      setShownIndex(resume);
      setPhase('flashing');
    }
  };

  const handleRcSubmit = (value: number) => {
    if (!drillRound) return;
    const correct = value === drillRound.finalRc;
    finishRun(correct, drillRound.finalRc, value);
    const verdict = `${correct ? 'Correct.' : 'Wrong.'} ${narrateCountAnswer(drillRound.finalRc)}`;
    if (eyesFree) {
      // Strict eyes-free: speak the verdict regardless of verbosity -- it's
      // the primary output channel in this mode, not decoration.
      speak(verdict, speechOptsFrom(settings.audio));
      // Timed Challenge: also speak the speed tier, using the same
      // direct-speak pattern (no new narration helper -- a plain templated
      // string). Queues naturally after the verdict above (no interrupt),
      // same as any other sequential eyes-free narration in this file.
      if (timedResult) {
        const spd = secondsPerDeck(timedResult.elapsedMs, timedResult.cardsShown);
        const tier = TIER_LABEL[classifySpeed(spd)];
        speak(`${formatDuration(timedResult.elapsedMs)}, ${spd.toFixed(1)} seconds per deck. ${tier}.`, speechOptsFrom(settings.audio));
      }
    } else {
      audio.sayFull(verdict);
    }
  };

  /** What the run comes to, said out loud. */
  const countdownVerdict = (correct: boolean, hidden: Card): string =>
    `${correct ? 'Correct.' : 'Wrong.'} The card left over was ` +
    `${narrateCards([hidden], settings.audio.cardDetail)}, ` +
    `${speakableCount(hiLoTag(hidden.rank))}.`;

  const handleTagGuess = (guess: -1 | 0 | 1) => {
    if (!countdownRound) return;
    const actual = hiLoTag(countdownRound.hidden.rank);
    const correct = guess === actual;
    finishRun(correct, actual, guess);

    // D2: eyes-free, the verdict IS the output. Naming the card as well as
    // its tag is the part that teaches -- "minus one" tells you nothing about
    // which card you lost track of, and the whole run was fifty-one cards.
    if (eyesFree) {
      speak(countdownVerdict(correct, countdownRound.hidden), speechOptsFrom(settings.audio));
    }
  };

  /** Say something, unconditionally -- a voice reply IS the output channel. */
  const sayBack = (text: string, interrupt = false) => {
    speak(text, speechOptsFrom(settings.audio, interrupt ? { interrupt: true } : {}));
  };

  /** The result, said again on request -- the screen is not being looked at. */
  const resultSpeech = (): string => {
    if (countdownMode && countdownRound) {
      return `${countdownVerdict(wasCorrect, countdownRound.hidden)} Say yes to go again.`;
    }
    return honorCheck
      ? `${wasCorrect ? 'Correct.' : 'Wrong.'} The count was ${actualValue}. Say yes to go again.`
      : `${wasCorrect ? 'Correct.' : 'Wrong.'} ${narrateCountAnswer(actualValue)} Say yes to go again.`;
  };

  /**
   * First refusal on every transcript, for the one thing the command
   * vocabulary deliberately does not contain: a number.
   *
   * Only while an answer is actually due. Outside 'answering' a number is
   * someone reading a road sign, and proposing it would make the read-back a
   * trap rather than a check.
   */
  const interpretCountSpeech = (heard: string, offered: readonly string[] = [heard]): string | null => {
    if (phase !== 'answering') return null;
    const readings = offered.length > 0 ? offered : [heard];

    // Every reading is tried, best first. Over a car microphone "minus three"
    // ranks behind "minus tree" often enough to matter, and a running count
    // is harder to say twice than a hand is to play twice.
    let parsed: ReturnType<typeof parseCountSpeech> = null;
    for (const reading of readings) {
      parsed = parseCountSpeech(reading);
      if (parsed) break;
    }
    if (!parsed) return null;

    const next = parsed.kind === 'value' ? parsed.value : (pendingCount ?? 0) + parsed.delta;
    // Countdown asks for a Hi-Lo TAG, which is one of three numbers. A
    // perfectly-heard "plus four" is not a near miss there, it is a category
    // error, and proposing it would put a number on screen that the confirm
    // step could never accept.
    if (countdownMode && (next < -1 || next > 1)) {
      sayBack(`${speakableCount(next)} is not a tag. ${COUNTDOWN_TAG_PROMPT}`, true);
      return `not a tag: ${speakableCount(next)}`;
    }
    setPendingCount(next);
    sayBack(`${speakableCount(next)}. Correct?`, true);
    return `count ${speakableCount(next)}`;
  };

  /**
   * The spoken half of the drill, which is phase-shaped: the same "yes" that
   * starts a run at setup confirms a count while answering and claims the
   * self-check afterwards.
   *
   * Nothing here navigates. A misheard word inside the drill costs one "no";
   * a misheard word that left the screen would cost the run, and pressing
   * Back is a tap you can afford at the moment you have stopped driving
   * anyway.
   */
  const handleVoiceCommand = (action: VoiceAction) => {
    switch (phase) {
      case 'setup':
        if (action === 'yes') start();
        return;

      case 'answering': {
        // D2: the tag can be spoken now. It used to be a tap on the grounds
        // that a three-way choice with no read-back is one mishearing away
        // from a false verdict -- which was true of a bare guess, and is not
        // true of this: the tag goes through the same propose-and-confirm
        // gate the running count does, so nothing is graded until it has been
        // said back and agreed to.
        if (countdownMode) {
          if (action === 'yes') {
            if (pendingCount === null) {
              sayBack(`I have no tag yet. ${COUNTDOWN_TAG_PROMPT}`, true);
              return;
            }
            const tag = pendingCount as -1 | 0 | 1;
            setPendingCount(null);
            handleTagGuess(tag);
            return;
          }
          if (action === 'no') {
            setPendingCount(null);
            sayBack(COUNTDOWN_TAG_PROMPT, true);
            return;
          }
          if (action === 'repeat') {
            sayBack(
              pendingCount === null
                ? COUNTDOWN_TAG_PROMPT
                : `${speakableCount(pendingCount)}. Correct?`,
              true,
            );
          }
          return;
        }
        if (action === 'yes') {
          if (pendingCount === null) {
            sayBack('I have no count yet. What is it?', true);
            return;
          }
          const confirmed = pendingCount;
          setPendingCount(null);
          handleRcSubmit(confirmed);
          return;
        }
        if (action === 'no') {
          // A rejection clears the proposal outright rather than trying to
          // salvage it: the operator said it was wrong, not nearly right.
          setPendingCount(null);
          sayBack(narrateCountPrompt(), true);
          return;
        }
        if (action === 'repeat') {
          sayBack(
            pendingCount === null ? narrateCountPrompt() : `${speakableCount(pendingCount)}. Correct?`,
            true,
          );
        }
        return;
      }

      case 'selfreport':
        if (action === 'yes') handleSelfReport(true);
        else if (action === 'no') handleSelfReport(false);
        else if (action === 'repeat') {
          sayBack(narrateCountAnswer(actualValue), true);
          sayBack('Did you have it?');
        }
        return;

      case 'result':
        if (action === 'yes') start();
        else if (action === 'repeat') sayBack(resultSpeech(), true);
        else if (action === 'no') sayBack('Okay. Say yes when you want another.', true);
        return;

      // 'flashing', 'selfcheck' and 'distraction' are the app's turn to talk.
      // A command there has nothing to act on, and answering one would talk
      // over the cards being counted.
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
    onTranscript: interpretCountSpeech,
    // Eyes-free, a rejection is silence, and silence looks the same as a dead
    // microphone. A short cue says "say it again" without costing a sentence
    // of narration mid-drill.
    onNotUnderstood: () => audio.ding('attention'),
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    context: 'count-drill',
  });

  // A proposal belongs to one answer. Carrying it into the next run would
  // offer the last count back as an answer to a different question.
  useEffect(() => {
    setPendingCount(null);
  }, [phase]);

  // Offer the next run out loud, and take the restart gap here -- the result
  // screen is the only moment in this drill that is reliably quiet, so a
  // recogniser cycled anywhere else would be deaf over an answer.
  useEffect(() => {
    if (!voiceOn || phase !== 'result') return;
    voice.cycleIfStale();
    sayBack('Say yes to go again.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, phase]);

  const currentGroup = shownIndex < groups.length ? groups[shownIndex] : null;

  // R9 / red-team #7: render a flashed card, optionally with a small seeded
  // rotation/offset ("messy cards"). Seeded by this run's seed + the card's
  // absolute position so the jitter is stable while the card is on screen and
  // reproducible in tests, but visibly different card-to-card.
  const renderFlashCard = (c: Card, i: number) => {
    if (!settings.drill.messyCards) return <PlayingCard key={i} card={c} />;
    const jitter = jitterTransform(cardJitter(runSeedRef.current, shownIndex * 4 + i));
    return (
      <span key={i} className="messy-card" style={{ display: 'inline-block', transform: jitter }}>
        <PlayingCard card={c} />
      </span>
    );
  };

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Count Drill</div>
      </div>

      {/* Deliberately NOT the full command vocabulary. The play words --
          hit, stand, double -- do nothing in a count drill, and listing
          them would invite a driver to say something the screen has just
          promised will work. */}
      {voiceOn && (
        <VoiceStatusBar
          status={voice.status}
          hint={
            <>
              Say: yes &middot; no &middot; repeat &mdash; and the count itself,
              &ldquo;minus three&rdquo;
            </>
          }
        />
      )}

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
                  <label className="count-toggle">
                    <input
                      type="checkbox"
                      checked={settings.drill.timedAdaptive}
                      onChange={(e) => updateDrill({ timedAdaptive: e.target.checked })}
                    />
                    Adaptive difficulty
                  </label>
                  {settings.drill.timedAdaptive &&
                    (() => {
                      const gate = computeUnlockedTier(mapTimedHistory(loadStats().timedCount.history));
                      return (
                        <div className="settings-row settings-note-row">
                          Paces this run at your unlocked tier ({TIER_LABEL[gate.unlockedTier]},{' '}
                          {tierStartIntervalMs(gate.unlockedTier)}ms/card) instead of the manual pace
                          setting above -- speeds up only once accuracy holds there.
                        </div>
                      );
                    })()}
                </>
              )}
            </>
          )}

          {/* D2: offered in Countdown as well now. That mode is fifty-one
              cards read out one at a time with the count kept in your head,
              which is the whole drill and the one shape of it that works from
              a driver's seat. Strict mode stays out of it: it swaps in a
              keypad, and Countdown's answer is three words. */}
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
          {!countdownMode && eyesFree && settings.audio.enabled && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(e) => setStrictMode(e.target.checked)}
              />
              Strict mode (keypad entry, graded)
            </label>
          )}

          {/* D1 part 2 (docs/BACKLOG.md, distraction training): only meaningful
              for the standard count drill's flashing phase -- excluded for
              Countdown mode (tag-guess, not a running-count answer) and for
              Timed Challenge (its speed ramp/measurement is a separate,
              deliberately untangled concern; see the module header comment).
              Follows the same persisted-only-here-in-CountDrillView pattern
              as timedAdaptive above (not duplicated into Settings.tsx). */}
          {!countdownMode && !timedChallenge && (
            <>
              <div className="settings-row">
                <span className="settings-label">Distractions</span>
                <Segmented
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'occasional', label: 'Occasional' },
                    { value: 'relentless', label: 'Relentless' },
                  ]}
                  value={settings.drill.distractionFreq}
                  onChange={(v) => updateDrill({ distractionFreq: v })}
                />
              </div>
              {/* R2: an interruption you cannot yet absorb does not train
                  robustness, it just makes the count wrong. Soft, matching
                  pace pressure below and the picker's pressure drills. */}
              {!countFluent && settings.drill.distractionFreq !== 'off' && (
                <div className="settings-row settings-note-row">
                  Advanced — build your count fluency first (it stays available).
                </div>
              )}
              {settings.drill.distractionFreq !== 'off' && (
                <>
                  <div className="settings-row settings-note-row">
                    Pauses the count for a quick math interruption at{' '}
                    {settings.drill.distractionFreq === 'relentless' ? 'unpredictable' : 'unpredictable, sparser'}{' '}
                    moments, then resumes -- simulates table talk you can&apos;t time.
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">Distraction type</span>
                    <Segmented
                      options={[
                        { value: 'near-count', label: 'Near-count' },
                        { value: 'generic', label: 'Generic' },
                      ]}
                      value={settings.drill.distractionMode}
                      onChange={(v) => updateDrill({ distractionMode: v })}
                    />
                  </div>
                </>
              )}
            </>
          )}
          {!countdownMode && timedChallenge && settings.drill.distractionFreq !== 'off' && (
            <div className="settings-row settings-note-row">
              Distractions don&apos;t apply to Timed Challenge runs.
            </div>
          )}

          {/* R8/CM#1 (docs/BACKLOG.md): adversarial same-sign shoe bias. Same
              scope as distractions -- the ordinary count drill only; Countdown
              builds its own shoe and Timed Challenge forces 'none' so a harder
              shoe never contaminates the speed-tier grading. */}
          {!countdownMode && !timedChallenge && (
            <>
              <div className="settings-row">
                <span className="settings-label">Count bias</span>
                <Segmented
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'negative', label: 'Neg-first' },
                    { value: 'positive', label: 'Pos-first' },
                  ]}
                  value={settings.drill.countBias}
                  onChange={(v) => updateDrill({ countBias: v })}
                />
              </div>
              {settings.drill.countBias !== 'none' && (
                <div className="settings-row settings-note-row">
                  Clusters same-sign cards so the count runs{' '}
                  {settings.drill.countBias === 'negative' ? 'down then climbs back' : 'up then falls back'} —
                  extra reps counting through zero and reversing sign.
                </div>
              )}
            </>
          )}
          {!countdownMode && timedChallenge && settings.drill.countBias !== 'none' && (
            <div className="settings-row settings-note-row">
              Count bias doesn&apos;t apply to Timed Challenge runs.
            </div>
          )}

          {/* R9 / red-team #7: "messy" card presentation trains the visual-
              recognition half of counting. Applies to every count-drill mode's
              flashed cards (and the Pair Cancellation drill). */}
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={settings.drill.messyCards}
              onChange={(e) => updateDrill({ messyCards: e.target.checked })}
            />
            Messy cards (rotated / offset, like a real table)
          </label>

          {/* ET7: adversarial dealer-pace pressure. Only meaningful for the
              ordinary auto-flash count drill (Timed Challenge owns its own
              pacing; manual/eyes-free are self-paced), so it's noted as such. */}
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={settings.drill.pacePressure}
              onChange={(e) => updateDrill({ pacePressure: e.target.checked })}
            />
            Pace pressure (sudden fast bursts, like a rushing dealer)
          </label>
          {!countFluent && settings.drill.pacePressure && (
            <div className="settings-row settings-note-row">
              Advanced — build your count fluency first (it stays available).
            </div>
          )}
          {settings.drill.pacePressure && (settings.drill.countManual || timedChallenge) && (
            <div className="settings-row settings-note-row">
              Pace pressure applies to the auto-flash drill — not manual or Timed Challenge runs.
            </div>
          )}

          {/* Voice. Offered next to Start because that is where it has to be
              turned on: the microphone needs a tap, and the whole point is
              that it is the LAST tap of the session. */}
          {voiceSupported && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={voiceOn}
                onChange={(e) => {
                  // Answering out loud is worthless without hearing the
                  // reply, so this turns audio on the way Eyes-free does
                  // rather than sitting dead when audio happens to be off.
                  if (e.target.checked && !settings.audio.enabled) {
                    enableAudioNow(settings, onSettingsChange);
                  }
                  setVoiceOn(e.target.checked);
                }}
              />
              Voice answers (say the count, and &ldquo;yes&rdquo; to start)
            </label>
          )}

          <button type="button" className="drill-start-btn" onClick={start}>
            Start
          </button>
        </div>
      )}

      {phase === 'flashing' && settings.drill.countManual && !timedChallenge && (
        <div className="manual-tap-zone" onClick={advanceManual}>
          <div className="count-flash-cards">
            {currentGroup?.map(renderFlashCard)}
          </div>
          <div className="manual-tap-hint">
            tap to advance &middot; {shownIndex + 1}/{groups.length}
          </div>
        </div>
      )}

      {phase === 'flashing' && (!settings.drill.countManual || timedChallenge) && (
        <div className="count-flash-area">
          <div className="count-flash-cards">
            {currentGroup?.map(renderFlashCard)}
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

      {/*
        Eyes-free verdict. Two zones splitting the whole area so either can be
        hit without looking -- the same reasoning as the ZonePad, and the
        reason this is not a pair of ordinary buttons.
      */}
      {phase === 'selfreport' && (
        <div className="selfreport-area">
          <div className="selfreport-question">The count was {actualValue}. Did you have it?</div>
          {voiceOn && (
            <div className="selfreport-voice-hint">
              or say &ldquo;yes&rdquo; / &ldquo;no&rdquo;
            </div>
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

      {phase === 'distraction' && distraction && (
        <div className="distraction-area">
          <div className="distraction-label">Quick -- what&apos;s this?</div>
          <div className="distraction-prompt">{distraction.prompt}</div>
          <NumPad label="Answer" onSubmit={handleDistractionSubmit} />
        </div>
      )}

      {/* The spoken proposal, shown as well as said. A passenger should be
          able to correct it by tapping instead of talking, and the keypad
          stays for a refused microphone or a browser that cannot listen. */}
      {phase === 'answering' && !countdownMode && voiceOn && (
        <div className="count-voice" data-pending={pendingCount !== null}>
          {pendingCount === null ? (
            <span className="count-voice-hint">
              Say the count &mdash; &ldquo;minus three&rdquo;. Then &ldquo;plus&rdquo; or
              &ldquo;minus&rdquo; to nudge it by one, &ldquo;yes&rdquo; to submit.
            </span>
          ) : (
            <>
              <span className="count-voice-value">
                {pendingCount >= 0 ? `+${pendingCount}` : pendingCount}
              </span>
              <span className="count-voice-hint">
                &ldquo;yes&rdquo; to submit &middot; &ldquo;no&rdquo; to start over &middot;
                &ldquo;plus&rdquo;/&ldquo;minus&rdquo; to nudge
              </span>
            </>
          )}
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
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-detail">
            The count was {actualValue} &mdash; self-reported, and recorded
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
                  {gateOutcome &&
                    (() => {
                      const next = tierAbove(gateOutcome.tier);
                      return (
                        <div className={`timed-result-gate gate-outcome-${gateOutcome.change}`}>
                          Unlocked: {TIER_LABEL[gateOutcome.tier]}
                          {next ? ` — hold accuracy to reach ${TIER_LABEL[next]}` : ' — top tier'}
                          {gateOutcome.change === 'advanced' && ' (advanced!)'}
                          {gateOutcome.change === 'eased' && ' (eased back)'}
                        </div>
                      );
                    })()}
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
