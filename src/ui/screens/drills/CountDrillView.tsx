import { diag } from '../../../diag/diagnosticLog';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { sayMomentAtPause } from '../../../habits/moment';
import type { Settings } from '../../../store/types';
import type { Card } from '../../../engine/cards';
import { hiLoTag } from '../../../engine/count';
import { makeCountDrill, makeCountdown, runningCountThrough } from '../../../drills/countDrill';
import type { CountDrillRound, CountdownRound } from '../../../drills/countDrill';
import { makeDistraction, isDistractionPoint } from '../../../drills/distraction';
import type { Distraction } from '../../../drills/distraction';
import {
  checkpointIndices,
  summarizeCheckpoints,
  type CheckpointResult,
  type CheckpointReport,
  type GradedCheckpoint,
} from '../../../drills/countCheckpoints';
import {
  classifySpeed,
  formatDuration,
  rampIntervalMs,
  secondsPerDeck,
  tierStartIntervalMs,
  RAMP_FLOOR_MS,
  meanTapGapMs,
} from '../../../drills/countSpeed';
import type { SpeedTier } from '../../../drills/countSpeed';
import { computeUnlockedTier, tierAbove, SPEED_TIER_ORDER } from '../../../drills/competenceGate';
import { loadStats, saveStats, saveSettings } from '../../../store/persist';
import { getActiveProfile } from '../../../store/profiles';
import { PlayingCard } from '../../components/PlayingCard';
import { cardJitter, jitterTransform } from '../../../drills/cardJitter';
import { paceMultiplier } from '../../../drills/pacePressure';
import { cardArrival } from '../../../drills/cardArrive';
import { isCountFluent } from '../../../drills/fluencyGate';
import { NumPad } from '../../components/NumPad';
import { Segmented, Stepper } from '../Settings';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, speak, speakAsync } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { answerPauseDelayMs, nextQuestionDelayMs } from '../../../audio/answerPause';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import {
  narrateCards,
  narrateCountAnswer,
  narrateCountPrompt,
  narrateCountdownVerdict,
  narrateNotATag,
  narrateReadback,
  COUNTDOWN_TAG_PROMPT,
  CHECKPOINT_PROMPT,
  NO_TAG_YET,
  NO_COUNT_YET,
  NO_COUNT_YET_CHECKPOINT,
  NO_ANSWER_YET,
  DID_YOU_HAVE_IT,
  DECLINED_ANOTHER,
  SAY_YES_AGAIN,
} from '../../../audio/narrate';
import { focusSwallowsKey } from '../../keyboardFocus';
import { enableAudioNow } from '../../audioGate';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { useWheelNumber } from '../../useWheelNumber';
import { CountRunList } from './CountRunList';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../../audio/voiceRecognition';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { affirmsProposal, parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../../audio/voiceNumber';
import { VoiceStatusBar } from '../../components/VoiceStatusBar';
import { CarStatusLine } from '../../components/CarStatusLine';
import { carMic, carScore, countPrompt, countWheelLabel, type CarStatus } from '../../carStatus';
import { RungProgressLine } from './RungProgressLine';
import { DRILL_RUNG } from './rungProgress';
import { useVoiceToggle, usePushToTalk, startPushToTalk } from '../../voiceSession';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { DrillPrimaryBar } from '../../components/DrillPrimaryBar';
import { cardsLabel, stretchLine } from '../../../drills/checkpointCopy';
import { plainNumber, signed, withMinusSigns } from '../../../drills/signed';
import './countDrillView.css';
import { makeCountTable, tableRounds, TABLE_ROUND_CHOICES } from '../../../drills/countTable';
import type { TableRound } from '../../../drills/countTable';
import './countTable.css';
import './countPause.css';
import './countLeadIn.css';
import './countTableDeal.css';
import { tableDealOf, tableHoldMs, tableRoundPlan, tableView, type TableDeal } from '../../countTableDeal';
import { DEALER_SEAT } from '../../dealSequence';
import { COUNT_AGAIN_PREFIX, COUNT_HIDE_PAUSED_LINE, COUNT_PAUSED_LINE, COUNT_RESUME_PROBE_MS, COUNT_RESUMING_LINE, isCountResumeWord } from '../../../drills/countPause';
import { EASY_FIRST_RUN, hiLoLabel, hiLoShown, offersEasyFirstRun } from '../../../drills/hiLoAid';
import './hiLoAid.css';

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
/** Wave X (item 7): the lead-in counts down from this, one beat per numeral. */
const LEAD_IN_FROM = 3;
const LEAD_IN_STEP_MS = 600;

type CountPhase =
  | 'setup'
  /**
   * Wave X (item 7): "a short countdown at the start before it begins flipping
   * through them". 3-2-1 on screen; eyes-free, one neutral chime and a beat.
   * Nothing advances here -- every advance mechanism is gated on 'flashing'.
   */
  | 'leadin'
  | 'flashing'
  | 'answering'
  | 'selfcheck'
  // Eyes-free: the answer has been spoken and the drill is asking whether you
  // had it. Exists so the driving path can produce a VERDICT and a recorded
  // result -- previously it produced neither.
  | 'selfreport'
  /**
   * Practice only: flash, ask, pause, say the answer, flash the next run.
   * No report, no grade, no history row.
   *
   * Asked for on 2026-09-16: "a no interaction mode where it just gives some
   * time to say the counts but then will [sovereignly] continue without
   * detecting an answer and state the correct answer after a pause just for
   * practice". Every other eyes-free path needs something back -- a word, a
   * zone, a wheel press -- and each of those can fail in a car, leaving the
   * drill stopped dead in a silence indistinguishable from a dead
   * microphone. This mode asks for nothing, so nothing can fail. It records
   * nothing, which is the honest name for a rep with no answer taken.
   */
  | 'practice'
  | 'distraction'
  // RT#12 (docs/BACKLOG.md): a mid-run running-count checkpoint. Shaped
  // exactly like 'distraction' -- the stream pauses, a number is taken, the
  // stream resumes where it stopped -- but the number asked for is the count
  // itself, and NOTHING is said about whether it was right. Feedback here
  // would hand back a corrected count and destroy the rest of the run's
  // measurement; the verdict waits for the result screen.
  | 'checkpoint'
  | 'result';

/**
 * D2: what Countdown asks for once the deck has been read out.
 *
 * The three answers are named because eyes-free there is no keypad to look
 * at, and "what is the tag" is not a question you can answer if nobody has
 * told you the shape of the answer.
 */

/**
 * RT#12: what a checkpoint asks. Deliberately the same question the end of
 * the run asks, because it is the same question -- "so far" is implied by the
 * cards having stopped.
 */

export function CountDrillView({
  settings,
  autoStart = false,
  onBack,
  onSettingsChange,
  onMidRun,
}: {
  settings: Settings;
  /** C-R3: opened by Home's Drive tap -- skip the setup screen and go. */
  autoStart?: boolean;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
  /**
   * Wave L (guided session): told at every phase change whether a run is in
   * progress (cards being dealt, or its answer being taken) -- true -- or the
   * drill is between runs (setup, the result) -- false. A guided time
   * segment only ends, or idles, between runs.
   */
  onMidRun?: (midRun: boolean) => void;
}) {
  const [countdownMode, setCountdownMode] = useState(false);
  // V3-4 soft gate: computed once at mount (fluency doesn't change mid-session).
  const [countFluent] = useState(() => isCountFluent(loadStats().countDrill.history));
  // G1 (L-1): offered only before any count run is on record. Read at mount:
  // the setup screen is only ever shown on the way in.
  const [easyOffered] = useState(() => offersEasyFirstRun(loadStats()));
  // G1: Easy first run writes its settings, then starts on the render that
  // carries them -- start() reads settings from props.
  const [easyStartPending, setEasyStartPending] = useState(false);
  const [phase, setPhaseState] = useState<CountPhase>('setup');
  /**
   * The phase, readable SYNCHRONOUSLY.
   *
   * The steering wheel needs this and React's render state cannot give it.
   * A press arrives from `navigator.mediaSession`, outside React, and two
   * presses can land in the same tick -- a double-press on the wheel, which
   * is an ordinary human thing to do. The second one would then be handled
   * by the closure from the render BEFORE the first press changed anything,
   * so a press meant as "plus one" was read against the setup screen and
   * silently restarted the drill with a new question. Eyes-free that is
   * invisible: the count you were entering is gone and the question you are
   * answering is not the one you heard.
   *
   * Writing the ref in the setter rather than in an effect is the whole
   * point -- an effect does not run between two presses in the same tick.
   */
  const phaseRef = useRef<CountPhase>('setup');
  /**
   * Abandon a standing proposal, synchronously, whenever the phase moves.
   *
   * Called from `setPhase` rather than from an effect on `phase`, which is
   * where it was and which the wheel exposed as wrong: an effect runs after
   * React commits, so presses made in the NEW phase in the meantime were
   * wiped by a reset belonging to the old one.
   */
  const wheelResetRef = useRef<() => void>(() => {});
  const onMidRunRef = useRef(onMidRun);
  onMidRunRef.current = onMidRun;
  const setPhase = (next: CountPhase): void => {
    phaseRef.current = next;
    wheelResetRef.current();
    setPendingCount(null);
    setPhaseState(next);
    onMidRunRef.current?.(next !== 'setup' && next !== 'result');
  };
  // Wave X (item 7): the lead-in's numeral (3, 2, 1), or 0 for the eyes-free chime.
  const [leadInStep, setLeadInStep] = useState(LEAD_IN_FROM);
  const [drillRound, setDrillRound] = useState<CountDrillRound | null>(null);
  const [countdownRound, setCountdownRound] = useState<CountdownRound | null>(null);
  // #47: the run's table layout when it was dealt in Table mode, else null.
  // Each round is one entry of `groups` too, so pacing, checkpoints and
  // grading run unchanged on rounds.
  const [tableRun, setTableRun] = useState<TableRound[] | null>(null);
  const [shownIndex, setShownIndex] = useState(0);
  // Wave X (item 8): how many of the table round's steps (countTableDeal.ts)
  // are on the felt. Tagged with the run and round it belongs to, so a new
  // round starts from its own first step without a reset at every advance.
  const [tableAt, setTableAt] = useState<{ run: TableRound[]; index: number; shown: number } | null>(null);
  // F7: this session's graded runs, for the car status line.
  const [runScore, setRunScore] = useState({ right: 0, total: 0 });
  const [wasCorrect, setWasCorrect] = useState(false);
  const [actualValue, setActualValue] = useState(0);
  const [enteredValue, setEnteredValue] = useState(0);
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 7): toggles are local UI state, not persisted
  // settings -- they're per-session choices scoped to this drill screen.
  const [eyesFree, setEyesFree] = useEyesFreeToggle('count-drill');
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
  /** Practice only -- see the 'practice' phase. Off by default: a mode that
   * records nothing should never be entered by accident. */
  const [practice, setPractice] = useState(false);

  // VOICE. Off until asked for, like every other microphone in the app: a
  // toggle that survived a reload would open one on page load.
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  // Remembered for the life of the page load, not the life of this screen:
  // a toggle forgotten on every navigation is indistinguishable, in a car,
  // from a microphone that failed. See ui/voiceSession.ts.
  const [voiceOn, setVoiceOn] = useVoiceToggle('count-drill');
  const pushToTalkOpen = usePushToTalk();
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
  // RT#12: the group indices THIS run stops at, chosen once by start(). A
  // ref rather than state because nothing renders from it -- reading it
  // during an advance must never depend on a re-render having landed.
  const checkpointStopsRef = useRef<number[]>([]);
  // Answered checkpoints for this run, in order. Cleared by start() for the
  // same reason the distraction rows are: run N's data must never bleed into
  // run N+1.
  const checkpointRowsRef = useRef<CheckpointResult[]>([]);
  // Which group the pending checkpoint was posed at, and where to resume --
  // the same two questions triggerDistraction answers, kept separate so a
  // checkpoint and a distraction can never overwrite each other's resume.
  const checkpointAtRef = useRef<number | null>(null);
  const checkpointResumeRef = useRef<'finish' | number | null>(null);
  // The read-back shown on the result screen. null when the run had no
  // checkpoints, which is not the same as a run that got them all right.
  const [checkpointReport, setCheckpointReport] = useState<CheckpointReport | null>(null);
  // The seed passed to makeCountDrill/makeCountdown for the CURRENT run, set
  // once by start() -- reused (offset by the triggering card's shownIndex)
  // to seed each distraction's own makeDistraction() call, so a run is fully
  // reproducible given only its outer seed (matching the seeded idiom used
  // throughout drills/*.ts).
  const runSeedRef = useRef(0);
  // #20: a manual run's own pace. Whether THIS run is self-paced is fixed at
  // start(); each tap that moves to the next card adds the time the previous
  // card was up. A checkpoint or distraction clears `lastCardAtRef`, so the
  // time spent answering one is never counted as a gap between cards.
  const runManualRef = useRef(false);
  const tapGapsRef = useRef<number[]>([]);
  const lastCardAtRef = useRef<number | null>(null);
  /**
   * C-R2 (W11): the run is paused. Back on the wheel (or the Pause button)
   * while the cards are flashing stops every advance mechanism -- each one
   * checks `paused` -- and forward (or Resume) goes on from the NEXT card.
   * `pausedAtRef` is when, so the paused stretch can be taken out of the
   * run's timing. Only an explicit resume ends a pause: nothing resumes on
   * its own, however long it lasts (the car's automatic play/pause never
   * reach a drill, see audio/mediaSession.ts).
   */
  const [paused, setPaused] = useState(false);
  const pausedAtRef = useRef<number | null>(null);
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
  }, [settings.audio.enabled, setEyesFree]);

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
    if (eyesFree && !strictMode && !countdownMode && !timedChallenge) {
      setPhase(practice ? 'practice' : 'selfcheck');
      return;
    }
    setPhase('answering');
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
    // No number was given, so there is no last stretch to grade (#46).
    finishRun(correct, actualValue, actualValue, false);
    // Wave N: the result now waits for the next run -- the natural pause. A
    // goal this run met is said here, queued behind the verdict.
    sayMomentAtPause(settings.audio);
  };

  const updateDrill = (patch: Partial<Settings['drill']>) => {
    const next: Settings = { ...settings, drill: { ...settings.drill, ...patch } };
    saveSettings(next);
    onSettingsChange(next);
  };

  // #47: Table mode is visual-only (no spoken table), and neither Countdown
  // nor a Timed Challenge is a run of rounds, so it is offered only outside
  // all three; a stored "Table" under any of them deals ordinary cards.
  const tableChoosable = !countdownMode && !eyesFree && !timedChallenge;
  // G1: Hi-Lo values under the flashed cards -- screen only, never eyes-free.
  const showHiLo = hiLoShown(settings.drill, eyesFree);
  const tableOn = tableChoosable && settings.drill.countTableMode === true;

  const groups: Card[][] = countdownMode
    ? countdownRound
      ? countdownRound.shown.map((c) => [c])
      : []
    : drillRound
      ? drillRound.groups
      : [];

  // Wave X (item 8): the table round on the felt, dealt, paid and collected
  // step by step (countTableDeal.ts). Its own clock below drives a table run
  // in place of the one-timer-per-round advance.
  const roundOnFelt = tableRun && shownIndex < tableRun.length ? tableRun[shownIndex] : null;
  const tableManual = settings.drill.countManual && !timedChallenge;
  const tableDeal = tableDealOf(settings.drill.countTableDeal);
  const tablePlan = useMemo(
    () => (roundOnFelt ? tableRoundPlan(roundOnFelt, settings.drill.countIntervalMs, tableDeal, tableManual) : null),
    [roundOnFelt, settings.drill.countIntervalMs, tableDeal, tableManual],
  );
  const tableShown =
    tablePlan === null
      ? 0
      : tableAt !== null && tableAt.run === tableRun && tableAt.index === shownIndex
        ? tableAt.shown
        : tablePlan.first;
  const showTableSteps = (shown: number) => {
    if (tableRun) setTableAt({ run: tableRun, index: shownIndex, shown });
  };

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
    lastCardAtRef.current = null;
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

  /**
   * RT#12: pause the stream and ask for the running count so far.
   *
   * Called from the same three advance mechanisms as triggerDistraction and
   * given precedence over it at a shared index: two interruptions cannot be
   * posed at once, and between a measurement and a distraction the
   * measurement wins.
   *
   * The true count is captured HERE, at the moment the stream stopped, rather
   * than recomputed on submit -- the answer must be graded against the cards
   * that had actually been shown, not against wherever the run got to.
   */
  const triggerCheckpoint = (idxAtTrigger: number, isLast: boolean) => {
    lastCardAtRef.current = null;
    checkpointAtRef.current = idxAtTrigger;
    checkpointResumeRef.current = isLast ? 'finish' : idxAtTrigger + 1;
    setPhase('checkpoint');
    if (eyesFree) {
      speak(CHECKPOINT_PROMPT, speechOptsFrom(settings.audio, { interrupt: true }));
    }
  };

  /** Is `idx` one of this run's checkpoint stops? */
  const isCheckpoint = (idx: number) => checkpointStopsRef.current.includes(idx);

  /**
   * Does the advance from `idx` stop for a distraction? Wave A (s04): seeded by
   * THIS run, so the stops move from run to run instead of landing on the
   * same cards every time. One helper for all three advance mechanisms.
   */
  const distractionAt = (idx: number) =>
    isDistractionPoint(idx, settings.drill.distractionFreq, runSeedRef.current);

  /** The step past card/round `i`: a checkpoint, a distraction, the answer, or the next. */
  const advanceFrom = (i: number) => {
    const isLast = i >= groups.length - 1;
    if (isCheckpoint(i)) {
      triggerCheckpoint(i, isLast);
      return;
    }
    if (!countdownMode && distractionAt(i)) {
      triggerDistraction(i, isLast);
      return;
    }
    if (isLast) enterAnswerPhase();
    else setShownIndex(i + 1);
  };

  // Wave X (item 8): Table mode's own clock. Each step holds its beat -- a
  // card the time per card, the payout its set beat, a collect a quick one --
  // and once the dealer's own cards are taken, the round moves on. On tap,
  // the payout waits for the tap that collects it (advanceManual).
  useEffect(() => {
    if (phase !== 'flashing' || paused || tablePlan === null) return undefined;
    const hold = tableHoldMs(tablePlan, tableShown);
    if (hold === null) return undefined;
    const t = setTimeout(() => {
      if (tableShown < tablePlan.steps.length) showTableSteps(tableShown + 1);
      else advanceFrom(shownIndex);
    }, hold);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, tablePlan, tableShown, shownIndex]);

  // Visual-mode (non-eyes-free) fixed-interval advance -- UNCHANGED behavior
  // apart from the D1 distraction check below. Eyes-free auto mode is driven
  // by speech instead (see the effect below), so it's explicitly excluded
  // here rather than sharing this timer.
  useEffect(() => {
    if (
      phase !== 'flashing' ||
      paused ||
      groups.length === 0 ||
      settings.drill.countManual ||
      eyesFree ||
      timedChallenge ||
      // Wave X (item 8): a table round runs on the table's own clock above.
      tablePlan !== null
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
      // RT#12 first: a checkpoint and a distraction can land on the same
      // card, and only one interruption can be posed.
      if (isCheckpoint(shownIndex)) {
        triggerCheckpoint(shownIndex, isLast);
        return;
      }
      if (!countdownMode && distractionAt(shownIndex)) {
        triggerDistraction(shownIndex, isLast);
        return;
      }
      if (isLast) enterAnswerPhase();
      else setShownIndex((i) => i + 1);
      // ET7: adversarial dealer-pace pressure -- a seeded speed-up burst shortens
      // THIS card's interval, then recovers (paceMultiplier returns 1 off-burst,
      // and always 1 when the toggle is off, so default pacing is byte-identical).
    }, settings.drill.countIntervalMs *
      // #47: a table round stays up for the time its cards would take.
      (tableRun ? (groups[shownIndex]?.length ?? 1) : 1) *
      (settings.drill.pacePressure ? paceMultiplier(runSeedRef.current, shownIndex) : 1));
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
    tableRun,
    tablePlan,
    paused,
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
      paused ||
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
      // Review of A12: the first card after an unheard hold is said "Again:",
      // so a card Jack may already have heard is never counted twice.
      let again = replayNextRef.current;
      replayNextRef.current = false;
      while (!isStale()) {
        const g = groups[i];
        if (!g) return;

        const cards = narrateCards(g, 'rank');
        const outcome = await speakAsync(again ? `${COUNT_AGAIN_PREFIX} ${cards}` : cards, speechOptsFrom(settings.audio));
        again = false;
        if (isStale()) return;
        // A12: a card nobody heard (a call, Siri, a dead route: the clip and
        // the live fallback both failed) is not dealt past. Hold the run on
        // it; resuming says it again instead of moving on.
        if (outcome === 'unheard') {
          diag('life', 'count-paused-unheard', { index: i });
          replayOnResumeRef.current = true;
          setUnheardHold(true);
          pauseRun();
          return;
        }

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
        // RT#12 rides the same teardown-and-remount trick described above:
        // flipping phase away from 'flashing' kills this loop, and answering
        // the checkpoint remounts it at the resumed index.
        if (isCheckpoint(i)) {
          triggerCheckpoint(i, isLast);
          return;
        }

        if (distractionAt(i)) {
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
    paused,
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
    if (phase !== 'flashing' || paused) return;
    if (eyesFree && !settings.drill.countManual && !timedChallenge) return;
    const g = groups[shownIndex];
    if (!g) return;
    if (eyesFree) {
      speak(narrateCards(g, 'rank'), speechOptsFrom(settings.audio, { interrupt: true }));
    } else {
      // D21: interrupt here too. Queued, a 0.7s rank clip per flip fell a
      // card further behind every two flips at a fast pace, and was still
      // naming cards over the keypad. The card on screen is the one to name.
      audio.sayFull(narrateCards(g, 'rank'), { interrupt: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shownIndex, countdownMode, groups, eyesFree, settings.drill.countManual, timedChallenge, paused]);

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
    if (phase !== 'flashing' || paused || groups.length === 0 || countdownMode || !timedChallenge) {
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
    paused,
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
      // D21: and the question cuts off the last card rather than waiting
      // behind it; the keypad is already up.
      audio.sayFull(narrateCountPrompt(), { interrupt: true });
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
    const asked = narrateCountPrompt();
    speak(asked, speechOptsFrom(settings.audio));
    const t = setTimeout(() => {
      if (runIdRef.current !== runId || !drillRound) return;
      speak(narrateCountAnswer(drillRound.finalRc), speechOptsFrom(settings.audio));
      speak('Did you have it?', speechOptsFrom(settings.audio));
      finishSelfCheck(drillRound.finalRc);
    // The pause starts when the QUESTION STOPS, not when it starts -- see
      // audio/answerPause.ts.
    }, answerPauseDelayMs(asked, settings.audio));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * The practice loop: ask, pause, answer, gap, next run.
   *
   * One effect and two timers rather than a phase per beat -- the whole loop
   * is one stretch of the app talking and the operator thinking, with no
   * state in between that anything else needs to see. Guarded by runId AND
   * by the effect's own cleanup, like every other timer in this file.
   */
  useEffect(() => {
    if (phase !== 'practice') return undefined;
    const runId = runIdRef.current;
    const asked = narrateCountPrompt();
    speak(asked, speechOptsFrom(settings.audio));

    let nextTimer: number | undefined;
    const answerTimer = window.setTimeout(() => {
      if (runIdRef.current !== runId || !drillRound) return;
      const answer = narrateCountAnswer(drillRound.finalRc);
      speak(answer, speechOptsFrom(settings.audio));
      nextTimer = window.setTimeout(() => {
        if (runIdRef.current !== runId) return;
        start();
      }, nextQuestionDelayMs(answer, settings.audio));
    }, answerPauseDelayMs(asked, settings.audio));

    return () => {
      clearTimeout(answerTimer);
      if (nextTimer !== undefined) clearTimeout(nextTimer);
    };
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
    if (pausedAtRef.current !== null) return;
    if (tablePlan !== null) {
      // Wave X (item 8): a tap mid-deal lays the rest of the round down; at
      // the payout it collects, and the round moves on once that is done.
      const payout = tablePlan.payoutAt + 1;
      if (tableShown < payout) {
        showTableSteps(payout);
        return;
      }
      if (tableShown > payout) return;
      const now = performance.now();
      if (lastCardAtRef.current !== null) tapGapsRef.current.push(now - lastCardAtRef.current);
      lastCardAtRef.current = now;
      showTableSteps(payout + 1);
      return;
    }
    const isLast = shownIndex >= groups.length - 1;
    // #20: the gap this tap closes. Read before any interruption is posed --
    // the card was up until now whatever happens next.
    const now = performance.now();
    if (lastCardAtRef.current !== null) tapGapsRef.current.push(now - lastCardAtRef.current);
    lastCardAtRef.current = now;
    // D1 part 2: this tap zone is shared with Countdown mode's manual
    // advance (see the JSX below), which is out of scope for distractions --
    // guard it out explicitly rather than relying on distractionFreq alone.
    if (isCheckpoint(shownIndex)) {
      triggerCheckpoint(shownIndex, isLast);
      return;
    }
    if (!countdownMode && distractionAt(shownIndex)) {
      triggerDistraction(shownIndex, isLast);
      return;
    }
    if (isLast) {
      enterAnswerPhase();
    } else {
      setShownIndex((i) => i + 1);
    }
  };

  /** A12: the run is held on a card that went unheard, so resuming replays it. */
  const replayOnResumeRef = useRef(false);
  /** The same hold, as state, for the probe effect below. */
  const [unheardHold, setUnheardHold] = useState(false);
  /** Set by a replaying resume: the loop's first card is said "Again:". */
  const replayNextRef = useRef(false);

  /** C-R2: stop the run where it is. Only while the cards are flashing. */
  const pauseRun = () => {
    if (phaseRef.current !== 'flashing' || pausedAtRef.current !== null) return;
    pausedAtRef.current = performance.now();
    cancelSpeech();
    setPaused(true);
  };

  /**
   * C-R2: go on from the NEXT card, at once, with the paused stretch taken
   * out of the run's clock (a timed run's elapsed time, a manual run's tap
   * gap). The step past the held card is the one its own advance would have
   * taken: a checkpoint or distraction due there is still posed.
   */
  const resumeRun = () => {
    const pausedAt = pausedAtRef.current;
    if (pausedAt === null || phaseRef.current !== 'flashing') return;
    const pausedMs = performance.now() - pausedAt;
    pausedAtRef.current = null;
    if (timedStartRef.current !== null) timedStartRef.current += pausedMs;
    if (lastCardAtRef.current !== null) lastCardAtRef.current += pausedMs;
    setPaused(false);
    // A12: held on a card that was never heard: the loop remounts on it and
    // says it again, rather than skipping a card Jack must count.
    if (replayOnResumeRef.current) {
      replayOnResumeRef.current = false;
      replayNextRef.current = true;
      setUnheardHold(false);
      diag('life', 'count-unheard-replayed', { index: shownIndex });
      return;
    }
    // Wave X (item 8): a table round picks up where it stopped -- skipping on
    // would take away cards still to be dealt.
    if (tablePlan !== null) return;
    const i = shownIndex;
    const isLast = i >= groups.length - 1;
    if (isCheckpoint(i)) {
      triggerCheckpoint(i, isLast);
      return;
    }
    if (!countdownMode && !timedChallenge && distractionAt(i)) {
      triggerDistraction(i, isLast);
      return;
    }
    if (isLast) {
      if (timedChallenge && timedStartRef.current !== null) {
        setTimedResult({
          elapsedMs: performance.now() - timedStartRef.current,
          cardsShown: settings.drill.countLengthCards,
        });
      }
      enterAnswerPhase();
      return;
    }
    setShownIndex(i + 1);
  };

  // "Paused", said once the pause has torn the narration down -- an effect,
  // so it runs AFTER the cleanup that cancels the card being spoken.
  // Review R4: a pause the hidden page caused never lifts by itself, so with
  // the microphone open it names the word that continues the run.
  const pausedByHideRef = useRef(false);
  const pausedLine = () => (pausedByHideRef.current && voiceOn ? COUNT_HIDE_PAUSED_LINE : COUNT_PAUSED_LINE);
  useEffect(() => {
    if (!paused) {
      pausedByHideRef.current = false;
      return;
    }
    if (eyesFree || voiceOn) speak(pausedLine(), speechOptsFrom(settings.audio, { interrupt: true }));
    else audio.sayFull(pausedLine());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  /*
   * Review of A12: a hold on an unheard card lifts by itself once audio is
   * confirmed playing again. Every COUNT_RESUME_PROBE_MS a short "Resuming."
   * is tried; the first one actually heard resumes the run, which says the
   * held card again, marked. Silent attempts during a call cost nothing.
   */
  const resumeRunRef = useRef(resumeRun);
  resumeRunRef.current = resumeRun;
  useEffect(() => {
    if (!paused || !unheardHold) return undefined;
    let stopped = false;
    let timer = 0;
    const probe = async () => {
      if (stopped) return;
      const outcome = await speakAsync(COUNT_RESUMING_LINE, speechOptsFrom(settings.audio));
      if (stopped) return;
      diag('life', 'count-resume-probe', { outcome });
      if (outcome === 'spoken') resumeRunRef.current();
      else timer = window.setTimeout(() => void probe(), COUNT_RESUME_PROBE_MS);
    };
    timer = window.setTimeout(() => void probe(), COUNT_RESUME_PROBE_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, unheardHold]);

  /*
   * A12: a run that loses the page is paused, not dealt on into nothing. A
   * call, a Siri or Maps prompt or a screen lock took the audio while the
   * loop kept dealing -- speakAsync resolves on its watchdog either way -- so
   * cards Jack never heard were counted and graded. Runs hold a wake lock, so
   * a hidden page mid-run is never how a run is meant to be practised. On
   * return "Paused." is said again, because the one said at the pause went
   * out while the page was hidden.
   */
  const hideHandlersRef = useRef({ pauseRun, sayPaused: () => {} });
  hideHandlersRef.current = {
    pauseRun,
    sayPaused: () => {
      if (eyesFree || voiceOn) speak(pausedLine(), speechOptsFrom(settings.audio, { interrupt: true }));
      else audio.sayFull(pausedLine());
    },
  };
  useEffect(() => {
    let pausedByHide = false;
    const onHide = () => {
      if (phaseRef.current !== 'flashing' || pausedAtRef.current !== null) return;
      pausedByHide = true;
      diag('life', 'count-paused-on-hide', {});
      pausedByHideRef.current = true;
      hideHandlersRef.current.pauseRun();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        onHide();
        return;
      }
      if (!pausedByHide) return;
      pausedByHide = false;
      if (pausedAtRef.current !== null) hideHandlersRef.current.sayPaused();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

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
    // RT#12: clear last run's checkpoints before the new round is built --
    // the stops themselves are chosen below, once the round exists and its
    // group count is known.
    checkpointRowsRef.current = [];
    checkpointStopsRef.current = [];
    checkpointAtRef.current = null;
    checkpointResumeRef.current = null;
    setCheckpointReport(null);
    if (countdownMode) {
      setCountdownRound(makeCountdown(seed));
      setDrillRound(null);
      setTableRun(null);
    } else {
      // R8/CM#1: apply the adversarial same-sign bias only to the ORDINARY
      // count drill, never a Timed Challenge run -- a biased shoe is harder in
      // the sign-traversal dimension, which would contaminate the speed-tier
      // grading the Timed Challenge feeds into R2's competence gate.
      const bias = timedChallenge ? 'none' : settings.drill.countBias;
      // Wave X review: the table's hands are played, the dealer to this profile's rules.
      const table = tableOn ? makeCountTable(tableRounds(settings.drill.countTableRounds), seed, getActiveProfile().rules) : null;
      const round = table
        ? { groups: table.groups, finalRc: table.finalRc }
        : makeCountDrill(settings.drill.countLengthCards, settings.drill.countGroup, seed, bias);
      setDrillRound(round);
      setTableRun(table ? table.rounds : null);
      setCountdownRound(null);
      // RT#12: same scope as distractions -- the ordinary count drill only.
      // Countdown asks for a tag rather than a running count, and a Timed
      // Challenge run is measuring elapsed time, which an interruption you
      // have to answer would corrupt.
      if (!timedChallenge) {
        checkpointStopsRef.current = checkpointIndices(
          round.groups.length,
          settings.drill.countCheckpoints,
          seed,
        );
      }
    }
    setShownIndex(0);
    pausedAtRef.current = null;
    replayOnResumeRef.current = false;
    replayNextRef.current = false;
    setUnheardHold(false);
    setPaused(false);
    // #20: Timed Challenge ignores Next card, so it is never a manual run.
    runManualRef.current = settings.drill.countManual && !timedChallenge;
    tapGapsRef.current = [];
    lastCardAtRef.current = runManualRef.current ? performance.now() : null;
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

    timedStartRef.current = null;
    // Wave X (item 7): the lead-in first; the first card goes up when it ends.
    setLeadInStep(eyesFree ? 0 : LEAD_IN_FROM);
    setPhase('leadin');
    if (eyesFree) {
      void requestWakeLock();
    }
  };

  /** The lead-in is over: the first card goes up now. */
  const beginFlashing = () => {
    // Read the clock here (a live UI concern), never inside drills/countSpeed.ts
    // -- that module stays pure and deterministic for unit testing. Read when
    // the first card shows, not at Start: the lead-in is not the run's time.
    timedStartRef.current = timedChallenge && !countdownMode ? performance.now() : null;
    lastCardAtRef.current = runManualRef.current ? performance.now() : null;
    setPhase('flashing');
  };

  /**
   * Wave X (item 7): run the lead-in. On screen it counts 3, 2, 1, a beat
   * each. Eyes-free there is nothing to look at, so it is one neutral chime
   * and the same beat -- no words, so the car hears nothing it did not
   * before but a ding.
   */
  useEffect(() => {
    if (phase !== 'leadin') return undefined;
    if (leadInStep === 0) {
      audio.ding('attention');
      const t = setTimeout(beginFlashing, LEAD_IN_STEP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (leadInStep > 1) setLeadInStep(leadInStep - 1);
      else beginFlashing();
    }, LEAD_IN_STEP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, leadInStep]);

  /** G1: one deck, slow, values shown -- then go. */
  const startEasyFirstRun = () => {
    setCountdownMode(false);
    setTimedChallenge(false);
    setPractice(false);
    updateDrill(EASY_FIRST_RUN);
    setEasyStartPending(true);
  };
  useEffect(() => {
    if (!easyStartPending) return;
    setEasyStartPending(false);
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [easyStartPending]);

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

  /**
   * `answered` is false for the eyes-free self-report, which takes a verdict
   * but no number: `entered` there is a stand-in, not something the user said.
   */
  const finishRun = (correct: boolean, actual: number, entered: number, answered = true) => {
    // RT#12: read the checkpoints back now that the final verdict exists --
    // "cancelled" is only meaningful against it. Empty on a run with
    // checkpoints off, which reports as null rather than as a clean sweep.
    // #46: the final answer goes in too, so the last stretch is graded from
    // the last checkpoint the same way each checkpoint is graded from the one
    // before. The run's own verdict (`correct`) stays absolute.
    const checkpointRows = checkpointRowsRef.current;
    const totalCards = groups.reduce((n, g) => n + g.length, 0);
    const report =
      checkpointRows.length > 0
        ? summarizeCheckpoints(
            checkpointRows,
            correct,
            answered ? { cardsShown: totalCards, actual, answer: entered } : undefined,
          )
        : null;
    setCheckpointReport(report);
    setWasCorrect(correct);
    setRunScore((r) => ({ right: r.right + (correct ? 1 : 0), total: r.total + 1 }));
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

    // #47: a table run's length is whatever its rounds dealt.
    const cardsInRun = countdownMode ? 52 : tableRun ? totalCards : settings.drill.countLengthCards;
    // #20/#30: a manual run was never dealt at the auto interval, so it records
    // the pace the user actually kept -- the mean tap gap, idle gaps left out
    // -- and says it was manual. `intervalMs` is required by the stored shape;
    // on a manual row it carries the same measured mean (0 if none), and
    // readers rank manual runs by `meanTapMs` only (countSpeed.ts).
    const manual = runManualRef.current;
    const meanTapMs = manual ? meanTapGapMs(tapGapsRef.current) : undefined;
    const updated = {
      ...statsWithDistraction,
      countDrill: {
        history: [
          ...stats.countDrill.history,
          {
            date: new Date().toISOString(),
            cards: cardsInRun,
            intervalMs: manual ? (meanTapMs ?? 0) : settings.drill.countIntervalMs,
            correct,
            ...(manual ? { manual: true, ...(meanTapMs !== undefined ? { meanTapMs } : {}) } : {}),
            // RT#12: omitted entirely when the run had no checkpoints, so a
            // reader can tell "not measured" from "got none right".
            ...(report ? { checkpointsCorrect: report.correct, checkpointsTotal: report.total } : {}),
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
      // #20: the resumed card goes up now; the pause is not a tap gap.
      lastCardAtRef.current = performance.now();
      setShownIndex(resume);
      setPhase('flashing');
    }
  };

  /**
   * RT#12: record the checkpoint and resume, saying nothing about it.
   *
   * The silence is the design. A verdict here would tell the operator the
   * true count mid-run, which resets the very thing being measured -- the
   * rest of the run would then be graded from a number the drill handed
   * over. The read-back waits for the result screen, where it can say which
   * SEGMENT the drift entered in.
   */
  const handleCheckpointSubmit = (value: number) => {
    const at = checkpointAtRef.current;
    if (at === null) return;
    checkpointRowsRef.current = [
      ...checkpointRowsRef.current,
      {
        atGroup: at,
        // Cards through this group inclusive -- what the result screen counts
        // in, since a learner remembers cards seen and not group indices.
        cardsShown: groups.slice(0, at + 1).reduce((n, g) => n + g.length, 0),
        actual: runningCountThrough(groups, at),
        answer: value,
      },
    ];

    const resume = checkpointResumeRef.current;
    checkpointAtRef.current = null;
    checkpointResumeRef.current = null;

    if (resume === 'finish') {
      enterAnswerPhase();
    } else if (typeof resume === 'number') {
      // #20: the resumed card goes up now; the pause is not a tap gap.
      lastCardAtRef.current = performance.now();
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
    narrateCountdownVerdict(correct, hidden, hiLoTag(hidden.rank));

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
    return `${wasCorrect ? 'Correct.' : 'Wrong.'} ${narrateCountAnswer(actualValue)} Say yes to go again.`;
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
    // RT#12: a checkpoint takes a running count too, and eyes-free it must be
    // sayable -- a checkpoint you can only answer by typing would make the
    // whole feature unavailable in the car, which is the case it matters in.
    // 'distraction' too: it asks for a number out loud and then waits for
    // one. Refusing the transcript here was half of what made that phase
    // answerable only by typing.
    // Review of A12: a paused run resumes by voice. In Drive the wheel
    // belongs to hands-free mode while the microphone is open.
    if (phase === 'flashing' && pausedAtRef.current !== null && isCountResumeWord(offered.length > 0 ? offered : [heard])) {
      resumeRun();
      return 'resume';
    }
    if (phase !== 'answering' && phase !== 'checkpoint' && phase !== 'distraction') return null;
    const readings = offered.length > 0 ? offered : [heard];
    // A7: "yes, minus three" after the readback confirms; it is not a new proposal.
    if (affirmsProposal(readings, pendingCount)) {
      handleVoiceCommand('yes');
      return `confirmed ${speakableCount(pendingCount!)}`;
    }

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
    if (countdownMode && phase === 'answering' && (next < -1 || next > 1)) {
      sayBack(narrateNotATag(next), true);
      return `not a tag: ${speakableCount(next)}`;
    }
    // Review of A1: the standing value said again (or a fragment of its own
    // readback heard back) is not proposed and read out a second time.
    if (next === pendingCount) return `count ${speakableCount(next)} again`;
    setPendingCount(next);
    sayBack(narrateReadback(next), true);
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
              sayBack(NO_TAG_YET, true);
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
                : narrateReadback(pendingCount),
              true,
            );
          }
          return;
        }
        if (action === 'yes') {
          if (pendingCount === null) {
            sayBack(NO_COUNT_YET, true);
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
            pendingCount === null ? narrateCountPrompt() : narrateReadback(pendingCount),
            true,
          );
        }
        return;
      }

      // RT#12: the same propose-and-confirm gate the final count uses. A
      // misheard checkpoint would otherwise record a drift that never
      // happened and send the operator back to re-count a clean segment.
      case 'checkpoint':
        if (action === 'yes') {
          if (pendingCount === null) {
            sayBack(NO_COUNT_YET_CHECKPOINT, true);
            return;
          }
          const confirmed = pendingCount;
          setPendingCount(null);
          handleCheckpointSubmit(confirmed);
          return;
        }
        if (action === 'no') {
          setPendingCount(null);
          sayBack(CHECKPOINT_PROMPT, true);
          return;
        }
        if (action === 'repeat') {
          sayBack(
            pendingCount === null ? CHECKPOINT_PROMPT : narrateReadback(pendingCount),
            true,
          );
        }
        return;

      // Practice: nothing is being graded, so the only two useful things to
      // say are "get on with it" and "say that again".
      case 'practice':
        if (action === 'yes') start();
        else if (action === 'repeat') sayBack(narrateCountPrompt(), true);
        return;

      case 'selfreport':
        if (action === 'yes') handleSelfReport(true);
        else if (action === 'no') handleSelfReport(false);
        else if (action === 'repeat') {
          sayBack(narrateCountAnswer(actualValue), true);
          sayBack(DID_YOU_HAVE_IT);
        }
        return;

      case 'result':
        if (action === 'yes') start();
        else if (action === 'repeat') sayBack(resultSpeech(), true);
        else if (action === 'no') sayBack(DECLINED_ANOTHER, true);
        return;

      /*
       * 'distraction': the same propose-and-confirm gate the count uses.
       *
       * This phase used to sit in the default case below, under a comment
       * calling it "the app's turn to talk". It is the opposite: the stream
       * is PAUSED and an arithmetic question has been asked out loud. With
       * the transcript refused as well (see interpretCountSpeech), the only
       * way to answer was the NumPad -- so the distraction drill, whose
       * whole point is rehearsing the count under interruption while
       * driving, could not be completed without looking at the phone.
       */
      case 'distraction':
        if (action === 'yes') {
          if (pendingCount === null) {
            sayBack(NO_ANSWER_YET, true);
            return;
          }
          const confirmed = pendingCount;
          setPendingCount(null);
          handleDistractionSubmit(confirmed);
          return;
        }
        if (action === 'no') {
          setPendingCount(null);
          if (distraction) sayBack(distraction.prompt, true);
          return;
        }
        if (action === 'repeat') {
          sayBack(
            pendingCount === null
              ? (distraction?.prompt ?? '')
              : narrateReadback(pendingCount),
            true,
          );
        }
        return;

      // 'flashing' and 'selfcheck' really are the app's turn to talk. A
      // command there has nothing to act on, and answering one would talk
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
  /**
   * Entering the count from the wheel: forward is plus one, back is minus
   * one, quiet submits. See audio/wheelNumber.ts for why silence stands in
   * for the confirmation the voice path gets from the word "yes".
   *
   * It writes through to `pendingCount` so the SCREEN shows what is standing
   * too -- the wheel is for driving, but the drill is also used at a desk, and
   * a proposal that existed only inside a timer would be invisible there.
   */
  const wheelNumber = useWheelNumber({
    readback: (value) => sayBack(narrateReadback(value), true),
    commit: (value) => {
      setPendingCount(null);
      if (phaseRef.current === 'checkpoint') handleCheckpointSubmit(value);
      // A DISTRACTION IS A QUESTION. The stream is paused, the arithmetic
      // has been said out loud, and nothing moves until a number arrives --
      // and the only input that could supply one was the on-screen NumPad.
      // In the car that means picking the phone up mid-run, in the drill
      // whose entire subject is holding a count while interrupted.
      else if (phaseRef.current === 'distraction') handleDistractionSubmit(value);
      else if (countdownMode) handleTagGuess(Math.max(-1, Math.min(1, value)) as -1 | 0 | 1);
      else handleRcSubmit(value);
    },
    // A countdown answer is a tag, not a count: three legal values and no
    // others, so the readback must never offer a fourth.
    ...(countdownMode ? { clamp: (v: number) => Math.max(-1, Math.min(1, v)) } : {}),
    // Wave E E4 (L-4): the FINAL running count starts from the count given at
    // the run's last checkpoint -- the end of a long run is usually a few
    // presses from there and eight or more from zero. Checkpoints themselves,
    // distraction answers and Countdown's tag all start from 0.
    origin: () =>
      phaseRef.current === 'answering' && !countdownMode ? (checkpointRowsRef.current.at(-1)?.answer ?? 0) : 0,
  });

  /**
   * The wheel, in the only vocabulary it has: two directions.
   *
   * Each phase decides what a direction means, rather than every press meaning
   * the same word. Where the drill wants a NUMBER the buttons walk one; where
   * it wants a verdict they are the two verdicts; everywhere else forward goes
   * on and back says it again.
   */
  useWheelCommand((command) => {
    // C-R2: while the cards flash, back pauses them and forward resumes from
    // the next card -- in either wheel mode, since there is nothing to say
    // to a run that is still dealing.
    if (phaseRef.current === 'flashing') {
      if (command === 'back') {
        pauseRun();
        return;
      }
      if (pausedAtRef.current !== null) {
        resumeRun();
        return;
      }
    }
    // Push-to-talk mode: forward OPENS THE MICROPHONE instead of answering.
    // A mode rather than an extra gesture -- there are two buttons and three
    // things to say with them (see DrillSettings.wheelMode). Back still
    // repeats, which is the one meaning worth keeping in every mode.
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('count-drill');
        // A cue, because the window is invisible and the Bluetooth route
        // takes a moment to flip: without it there is no way to tell
        // "listening now" from "pressed nothing".
        audio.ding('attention');
      } else {
        handleVoiceCommand('repeat');
      }
      return;
    }
    switch (phaseRef.current) {
      case 'answering':
      case 'checkpoint':
      // The arithmetic answer is a number like any other, so it is walked
      // and committed by the same entry -- see wheelNumber's commit.
      case 'distraction':
        setPendingCount(wheelNumber.press(command));
        return;
      // "Did you have it?" -- two outcomes, two buttons, and no ambiguity
      // about which is which.
      case 'selfreport':
        handleVoiceCommand(command === 'forward' ? 'yes' : 'no');
        return;
      default:
        handleVoiceCommand(command === 'forward' ? 'yes' : 'repeat');
    }
  });

  // C-R3: Home's Drive tap opened this drill -- start it, once, on mount.
  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voice = useVoiceControl({
    // The push-to-talk window opens the microphone exactly as the toggle
    // does; the only difference is that something closes it again.
    enabled: voiceOn || pushToTalkOpen,
    onAction: handleVoiceCommand,
    onTranscript: interpretCountSpeech,
    // Eyes-free, a rejection is silence, and silence looks the same as a dead
    // microphone. A short cue says "say it again" without costing a sentence
    // of narration mid-drill.
    onNotUnderstood: () => audio.ding('again'),
    // C-R4: second miss on this question repeats it; later misses alternate tone and re-ask.
    escalation: {
      promptKey: [phase, drillRound, countdownRound, tableRun],
      reask: () => handleVoiceCommand('repeat'),
    },
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    onListening: () => audio.dingWhenQuiet('ready'),
    context: 'count-drill',
  });

  // A proposal belongs to one answer: carrying it into the next run would
  // offer the last count back as an answer to a different question. Done in
  // `setPhase` above rather than in an effect -- see `wheelResetRef`.
  wheelResetRef.current = wheelNumber.reset;

  // F7: the eyes-free car line -- the prompt, what the wheel does now (the
  // same branches as the wheel handler above), the mic, and the runs so far.
  const carStatus: CarStatus = {
    hand: countPrompt(phase, Math.min(shownIndex + 1, groups.length), groups.length),
    wheel: countWheelLabel(settings.drill.wheelMode, phase, paused),
    mic: carMic(voice.status.state),
    score: carScore(runScore.right, runScore.total),
  };

  // Offer the next run out loud, and take the restart gap here -- the result
  // screen is the only moment in this drill that is reliably quiet, so a
  // recogniser cycled anywhere else would be deaf over an answer.
  useEffect(() => {
    if (!voiceOn || phase !== 'result') return;
    voice.cycleIfStale();
    sayBack(SAY_YES_AGAIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, phase]);

  const currentGroup = shownIndex < groups.length ? groups[shownIndex] : null;

  /** G1: the card with its Hi-Lo value printed under it, when the aid is on. */
  function withHiLo(node: ReactNode, c: Card, key: string, faceDown = false): ReactNode {
    if (!showHiLo) return node;
    return (
      <span key={key} className="hilo-card">
        {node}
        {/* Wave X: a face-down card keeps its slot but not its value. */}
        {faceDown ? (
          <span className="hilo-value" aria-hidden="true" style={{ visibility: 'hidden' }}>
            0
          </span>
        ) : (
          <span className="hilo-value" data-testid="hilo-value" data-rank={c.rank}>
            {hiLoLabel(c)}
          </span>
        )}
      </span>
    );
  }
  /**
   * #47: the round laid out like Play -- dealer on top, seats below, read-only.
   * Wave X (item 8): only the steps dealt so far; the hole card face down
   * until the dealer turns it; a seat's cards gone once collected. Keyed by
   * round, so every round's cards are dealt in fresh. A card still to come
   * holds its place unseen, so the felt never reflows as the round is dealt
   * and each card lands where it stays.
   */
  const tableFelt = roundOnFelt && tablePlan ? tableView(tablePlan, roundOnFelt.players.length, tableShown) : null;
  const tableCard = (c: Card, key: string, dealt: boolean, opts: { compact?: boolean; down?: boolean } = {}): ReactNode => {
    const size = opts.compact ? 'compact' : undefined;
    if (!dealt) {
      return (
        <span key={`${key}-pending`} className="count-table-pending" aria-hidden="true">
          {withHiLo(<PlayingCard card={c} faceDown={opts.down} size={size} />, c, key, true)}
        </span>
      );
    }
    return withHiLo(<PlayingCard key={key} card={c} faceDown={opts.down} size={size} />, c, key, opts.down);
  };
  const tableLayout = roundOnFelt && tableFelt && (
    <div className="count-table" data-testid="count-table" data-stage={tableFelt.stage} key={shownIndex}>
      <div className={`dealer-area count-table-dealer${tableFelt.collected.has(DEALER_SEAT) ? ' is-collected' : ''}`}>
        {roundOnFelt.dealer.map((c, i) =>
          tableCard(c, `d${i}`, i < tableFelt.dealerCards, { down: i === 1 && tableFelt.holeDown }),
        )}
      </div>
      <div className="bot-seats-row count-table-seats">
        {roundOnFelt.players.map((hand, seat) => (
          <div key={seat} className={`bot-seat${tableFelt.collected.has(seat) ? ' is-collected' : ''}`}>
            <div className="bot-seat-label">P{seat + 1}</div>
            <div className="bot-hand">
              <div className="bot-hand-cards">
                {hand.map((c, j) => tableCard(c, `p${j}`, j < (tableFelt.seatCards[seat] ?? 0), { compact: true }))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // R9 / red-team #7: render a flashed card, optionally with a small seeded
  // rotation/offset ("messy cards"). Seeded by this run's seed + the card's
  // absolute position so the jitter is stable while the card is on screen and
  // reproducible in tests, but visibly different card-to-card.
  //
  // Wave A (s04): keyed by ABSOLUTE position, not by slot. Keyed by slot the
  // element was reused card to card, so card-deal-in played once per run and
  // an identical card dealt next to itself (about 40% of 52-card runs from
  // the 2-deck shoe) changed nothing on screen: a new counter missed it and
  // was told "Wrong" with no idea why. Now every card remounts and visibly
  // arrives.
  // Wave A review (s04): the arrival is scaled to this card's time on screen
  // (drills/cardArrive.ts), so a fast card is not still fading in as it is
  // replaced, and under reduced motion a short blank marks every new card.
  const cardOnScreenMs = (): number => {
    if (timedChallenge) return rampIntervalMs(shownIndex, timedStartMsRef.current, { floorMs: timedFloorMsRef.current });
    if (settings.drill.countManual) return Infinity;
    return (
      settings.drill.countIntervalMs *
      (settings.drill.pacePressure ? paceMultiplier(runSeedRef.current, shownIndex) : 1)
    );
  };
  const arrival = cardArrival(cardOnScreenMs());
  const arrivalStyle = {
    '--count-arrive-ms': `${arrival.arriveMs}ms`,
    '--count-blank-ms': `${arrival.blankMs}ms`,
  } as CSSProperties;

  const renderFlashCard = (c: Card, i: number) => {
    const key = `${shownIndex}-${i}`;
    if (!settings.drill.messyCards) return withHiLo(<PlayingCard key={key} card={c} />, c, key);
    const jitter = jitterTransform(cardJitter(runSeedRef.current, shownIndex * 4 + i));
    // G1: the value sits outside the tilt, so it reads level under a messy card.
    return withHiLo(
      <span key={key} className="messy-card" style={{ display: 'inline-block', transform: jitter }}>
        <PlayingCard card={c} />
      </span>,
      c,
      key,
    );
  };

  /**
   * RT#12's whole point, rendered.
   *
   * The headline is the cancellation case: a run that ended on the right
   * number after drifting is the one the old grading called perfect, and it
   * is the one worth saying out loud. Everything else is localization --
   * which stretch of cards the count went wrong in, counted in cards seen
   * rather than group indices, because that is the unit a run is replayed in.
   *
   * null on a run with no checkpoints. An empty block would read as a clean
   * sweep of nothing.
   */
  /**
   * #46 / Wave A (s04): a stop's row, as a verdict on its stretch.
   *
   * It used to print the absolute "you said 1, it was 1" beside the ADJUSTED
   * grade, so matching numbers showed in red; now the words lead with the
   * same verdict the colour gives ("off by −2" / "right") and say why in the
   * same terms. See drills/checkpointCopy.ts.
   */
  const stretchRow = (g: GradedCheckpoint, lead?: string): ReactNode => {
    const line = stretchLine(g);
    const cards = cardsLabel(line);
    return (
      <>
        <span className="checkpoint-verdict">
          {lead ? `${lead} (${cards})` : cards.charAt(0).toUpperCase() + cards.slice(1)}: {line.verdict}.
        </span>{' '}
        <span className="checkpoint-detail">{line.detail}</span>
      </>
    );
  };

  const checkpointBlock = checkpointReport && (
    <div className="checkpoint-result">
      <div className="checkpoint-result-score">
        Checkpoints: {checkpointReport.correct}/{checkpointReport.total}
      </div>
      {checkpointReport.cancelled && (
        <div className="checkpoint-result-cancelled">
          Right at the end, but not all the way through &mdash; two errors cancelled out.
        </div>
      )}
      {checkpointReport.firstDriftSegment && (
        <div className="checkpoint-result-segment">
          The count first went wrong between cards {checkpointReport.firstDriftSegment.fromCard} and{' '}
          {checkpointReport.firstDriftSegment.toCard}.
        </div>
      )}
      <ul className="checkpoint-result-list">
        {checkpointReport.results.map((r) => (
          <li key={r.atGroup} className={r.correct ? 'checkpoint-hit' : 'checkpoint-miss'}>
            {stretchRow(r)}
          </li>
        ))}
      </ul>
      {/* #46: the last stretch, graded from the last checkpoint. The verdict
          above stays absolute; this says whether the cards after the last
          stop were counted right, whatever the count was coming into them. */}
      {checkpointReport.finalStretch && (
        <div
          className={`checkpoint-result-final ${
            checkpointReport.finalStretch.correct ? 'checkpoint-hit' : 'checkpoint-miss'
          }`}
        >
          {stretchRow(checkpointReport.finalStretch, 'Last stretch')}
        </div>
      )}
    </div>
  );

  /** E5 (W2-8): the dealt run, closed under "Show the run". */
  const runList = (
    <CountRunList
      groups={groups}
      checkpoints={checkpointReport?.results}
      {...(countdownMode && countdownRound ? { hidden: countdownRound.hidden } : {})}
      defaultOpen={showHiLo}
    />
  );

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Count drill</div>
      </div>

      {/* Deliberately NOT the full command vocabulary. The play words --
          hit, stand, double -- do nothing in a count drill, and listing
          them would invite a driver to say something the screen has just
          promised will work. */}
      {eyesFree && !voiceOn && (
        <div className="car-status-gutter">
          <CarStatusLine {...carStatus} />
        </div>
      )}
      {voiceOn && (
        <VoiceStatusBar
          car={eyesFree ? carStatus : undefined}
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
          {tableChoosable && (
            <div className="settings-row">
              <span className="settings-label">Deal</span>
              <Segmented
                options={[
                  { value: 'cards', label: 'Cards' },
                  { value: 'table', label: 'Table' },
                ]}
                value={tableOn ? 'table' : 'cards'}
                onChange={(v) => updateDrill({ countTableMode: v === 'table' })}
              />
            </div>
          )}
          {tableOn && (
            <div className="settings-row">
              <span className="settings-label">Length (rounds)</span>
              <Segmented
                options={TABLE_ROUND_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
                value={String(tableRounds(settings.drill.countTableRounds))}
                onChange={(v) => updateDrill({ countTableRounds: Number(v) })}
              />
            </div>
          )}
          {tableOn && (
            <div className="settings-row">
              {/* Wave X (item 8): dealt at the time per card, or all at once. */}
              <span className="settings-label">Dealing</span>
              <Segmented<TableDeal>
                options={[
                  { value: 'dealt', label: 'Card by card' },
                  { value: 'instant', label: 'Instant' },
                ]}
                value={tableDeal}
                onChange={(v) => updateDrill({ countTableDeal: v })}
              />
            </div>
          )}
          {!countdownMode && !tableOn && (
              <Stepper
                label="Length"
                value={settings.drill.countLengthCards}
                min={13}
                max={312}
                step={13}
                format={(v) => `${v} cards`}
                onChange={(v) => updateDrill({ countLengthCards: v })}
              />
          )}

          <div className="drill-mode-row">
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
          </div>

          <details className="drill-options">
            <summary>Options</summary>
            <div className="drill-options-body">
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={countdownMode}
              onChange={(e) => setCountdownMode(e.target.checked)}
            />
            Countdown (one deck with a card held back: name its tag)
          </label>

          {!countdownMode && !tableOn && (
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
          )}

          <Stepper
            label="Time per card"
            value={settings.drill.countIntervalMs}
            min={300}
            max={3000}
            step={100}
            format={(v) => `${v}ms`}
            onChange={(v) => updateDrill({ countIntervalMs: v })}
          />

          <div className="settings-row">
            <span className="settings-label">Next card</span>
            <Segmented
              options={[
                { value: 'timed', label: 'Auto' },
                { value: 'manual', label: 'On tap' },
              ]}
              value={settings.drill.countManual ? 'manual' : 'timed'}
              onChange={(v) => updateDrill({ countManual: v === 'manual' })}
            />
          </div>

          {!countdownMode && !tableOn && (
            <>
              <label className="count-toggle">
                <input
                  type="checkbox"
                  checked={timedChallenge}
                  onChange={(e) => setTimedChallenge(e.target.checked)}
                />
                Timed challenge (gets faster every card)
              </label>
              {timedChallenge && (
                <>
                  <div className="settings-row settings-note-row">
                    Cards advance on their own and speed up, whatever Next card is set to.
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
                          {tierStartIntervalMs(gate.unlockedTier)}ms a card) instead of the pace you set
                          above, and moves up a tier only once your accuracy holds there.
                        </div>
                      );
                    })()}
                </>
              )}
            </>
          )}

          {!countdownMode && eyesFree && settings.audio.enabled && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(e) => setStrictMode(e.target.checked)}
              />
              Strict mode (enter the answer; graded)
            </label>
          )}
          {!countdownMode && !timedChallenge && eyesFree && settings.audio.enabled && !strictMode && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={practice}
                onChange={(e) => setPractice(e.target.checked)}
              />
              Practice only (no answer needed, nothing recorded)
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
                  Advanced — get fluent at the plain count drill first. It still works.
                </div>
              )}
              {settings.drill.distractionFreq !== 'off' && (
                <>
                  <div className="settings-row settings-note-row">
                    Stops the cards at unpredictable moments
                    {settings.drill.distractionFreq === 'relentless' ? '' : ' (now and then)'} for a quick
                    question, then carries on, like table talk you can&apos;t time.
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
              Distractions are off in a timed challenge.
            </div>
          )}

          {/* RT#12 (docs/BACKLOG.md): mid-run count checkpoints. Same scope as
              distractions above -- the ordinary count drill only. */}
          {!countdownMode && !timedChallenge && (
            <>
              <div className="settings-row">
                <span className="settings-label">Checkpoints</span>
                <Segmented
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'one', label: 'One' },
                    { value: 'few', label: 'Two' },
                  ]}
                  value={settings.drill.countCheckpoints}
                  onChange={(v) => updateDrill({ countCheckpoints: v })}
                />
              </div>
              {settings.drill.countCheckpoints !== 'off' && (
                <div className="settings-row settings-note-row">
                  Stops mid-run to ask the count so far, and says nothing about it until
                  the end &mdash; so a right final count can&apos;t hide two errors that
                  cancelled, and a wrong one tells you where it went.
                </div>
              )}
            </>
          )}
          {!countdownMode && timedChallenge && settings.drill.countCheckpoints !== 'off' && (
            <div className="settings-row settings-note-row">
              Checkpoints are off in a timed challenge.
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
                  Leans the {settings.drill.countBias === 'negative' ? 'high' : 'low'} cards toward the start, so the
                  count tends to run {settings.drill.countBias === 'negative' ? 'down' : 'up'} early. It can end up,
                  down or level, a third each.
                </div>
              )}
            </>
          )}
          {!countdownMode && timedChallenge && settings.drill.countBias !== 'none' && (
            <div className="settings-row settings-note-row">
              Count bias is off in a timed challenge.
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
            Messy cards (tilted and offset, as on a real table)
          </label>

          {/* G1 (L-1): a beginner aid, screen only. Not offered eyes-free,
              where nothing on screen is being read. */}
          {!eyesFree && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={settings.drill.countShowHiLo === true}
                onChange={(e) => updateDrill({ countShowHiLo: e.target.checked })}
              />
              Show Hi-Lo values (+1, 0 or &minus;1 under each card, and the count after each card at the end)
            </label>
          )}

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
              Advanced — get fluent at the plain count drill first. It still works.
            </div>
          )}
          {settings.drill.pacePressure && (settings.drill.countManual || timedChallenge) && (
            <div className="settings-row settings-note-row">
              Pace pressure only works with Next card on Auto, and is off in a timed challenge.
            </div>
          )}

            </div>
          </details>

          {/* G1: a first run made easy, offered until any count run is recorded. */}
          {easyOffered && !eyesFree && (
            <div className="settings-row settings-note-row easy-first-note" data-testid="easy-first-note">
              New to counting? Easy first run deals one deck, slowly, with each card&apos;s Hi-Lo value shown.
            </div>
          )}
          <DrillPrimaryBar
            label="Start"
            variant="start"
            onPrimary={start}
            {...(easyOffered && !eyesFree
              ? { secondaryLabel: 'Easy first run', onSecondary: startEasyFirstRun }
              : {})}
          />
        </div>
      )}

      {phase === 'leadin' && (
        <div className="count-flash-area count-leadin" data-testid="count-leadin">
          {leadInStep > 0 ? (
            <div className="count-leadin-num" key={leadInStep} aria-live="polite">
              {leadInStep}
            </div>
          ) : (
            <div className="count-leadin-ready" aria-live="polite">
              Ready&hellip;
            </div>
          )}
        </div>
      )}

      {phase === 'flashing' && settings.drill.countManual && !timedChallenge && (
        <div className="manual-tap-zone" onClick={advanceManual}>
          {tableLayout || (
            <div className="count-flash-cards" style={arrivalStyle}>
              {currentGroup?.map(renderFlashCard)}
            </div>
          )}
          <div className="manual-tap-hint">
            Tap for the next {tableRun ? 'round' : 'card'} &middot; {shownIndex + 1}/{groups.length}
          </div>
        </div>
      )}

      {phase === 'flashing' && (!settings.drill.countManual || timedChallenge) && (
        <div className="count-flash-area">
          {tableLayout || (
            <div className="count-flash-cards" style={arrivalStyle}>
              {currentGroup?.map(renderFlashCard)}
            </div>
          )}
          <div className="count-flash-progress">
            {tableRun ? 'Round ' : ''}
            {shownIndex + 1} / {groups.length}
            {timedChallenge && <span className="count-timed-badge">speeding up&hellip;</span>}
          </div>
        </div>
      )}

      {phase === 'flashing' && (
        <div className="count-pause-row">
          {paused && (
            <div className="count-paused" role="status">
              Paused
            </div>
          )}
          <button
            type="button"
            className="count-pause-btn"
            aria-pressed={paused}
            onClick={paused ? resumeRun : pauseRun}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
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
      {/* Practice: said out loud, and on screen too -- "nothing is being
          recorded" is worth confirming with a glance before setting off. */}
      {phase === 'practice' && (
        <div className="selfreport-area" data-testid="count-practice">
          <div className="selfreport-question">What&apos;s the running count?</div>
          <div className="selfreport-voice-hint">
            Practice only &mdash; say it out loud; nothing is recorded.
          </div>
        </div>
      )}

      {phase === 'selfreport' && (
        <div className="selfreport-area">
          <div className="selfreport-question">The running count was {plainNumber(actualValue)}. Did you have it?</div>
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

      {/* RT#12. No verdict, no running tally, nothing about the previous
          checkpoint -- the screen must not leak the count it is asking for. */}
      {phase === 'checkpoint' && (
        <div className="checkpoint-area">
          <div className="checkpoint-label">Checkpoint</div>
          <div className="checkpoint-prompt">Running count so far?</div>
          <NumPad label="Count" onSubmit={handleCheckpointSubmit} />
          {voiceOn && (
            <div className="count-voice" data-pending={pendingCount !== null}>
              {pendingCount === null ? (
                <span className="count-voice-hint">Say the count</span>
              ) : (
                <span className="count-voice-pending">
                  {speakableCount(pendingCount)} &mdash; say &ldquo;yes&rdquo; to confirm
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {phase === 'distraction' && distraction && (
        <div className="distraction-area">
          <div className="distraction-label">Quick: what&apos;s this?</div>
          {/* Wave A: shown with real minus signs; the prompt itself stays ASCII for speech. */}
          <div className="distraction-prompt">{withMinusSigns(distraction.prompt)}</div>
          <NumPad label="Answer" onSubmit={handleDistractionSubmit} />
        </div>
      )}

      {/* The spoken proposal, shown as well as said. A passenger should be
          able to correct it by tapping instead of talking, and the keypad
          stays for a refused microphone or a browser that cannot listen. */}
      {/* D11: the hint and the keypad in one dock at the FOOT of the screen,
          under the thumb, as True count, Produce TC and Play's count check
          have it. It sat at the top with the lower half of the screen empty. */}
      {phase === 'answering' && (
        <div className="count-answer-dock" data-testid="count-answer-dock">
          {!countdownMode && voiceOn && (
            <div className="count-voice" data-pending={pendingCount !== null}>
              {pendingCount === null ? (
                <span className="count-voice-hint">
                  Say the count &mdash; &ldquo;minus three&rdquo;. Then &ldquo;plus&rdquo; or
                  &ldquo;minus&rdquo; to nudge it by one, &ldquo;yes&rdquo; to submit.
                </span>
              ) : (
                <>
                  <span className="count-voice-value">
                    {signed(pendingCount, { plusZero: true })}
                  </span>
                  <span className="count-voice-hint">
                    &ldquo;yes&rdquo; to submit &middot; &ldquo;no&rdquo; to start over &middot;
                    &ldquo;plus&rdquo;/&ldquo;minus&rdquo; to nudge
                  </span>
                </>
              )}
            </div>
          )}

          {!countdownMode && (
            <NumPad label="Enter the running count" onSubmit={handleRcSubmit} />
          )}

          {countdownMode && (
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
        </div>
      )}

      {phase === 'result' && honorCheck && (
        <div className="drill-result">
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-detail">
            The running count was {plainNumber(actualValue)}. Self-reported, and recorded.
          </div>
          {/* L-3: the Home ladder rung this drill feeds. */}
          <RungProgressLine rung={DRILL_RUNG.count} />
          {checkpointBlock}
          {runList}
          {/* E5: one exit. The top bar's Back is it; a second "Back to
              Drills" here did the same thing. */}
          <DrillPrimaryBar label="New run" onPrimary={start} />
        </div>
      )}

      {phase === 'result' && !honorCheck && (
        <div className="drill-result">
          <div className={wasCorrect ? 'result-correct' : 'result-wrong'}>
            {wasCorrect ? 'Correct!' : 'Wrong'}
          </div>
          <div className="result-detail">
            You entered {plainNumber(enteredValue)}; the running count was {plainNumber(actualValue)}.
          </div>
          {/* L-3: the Home ladder rung this drill feeds. */}
          <RungProgressLine rung={DRILL_RUNG.count} />
          {checkpointBlock}
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
          {runList}
          {/* E5: one exit. The top bar's Back is it; a second "Back to
              Drills" here did the same thing. */}
          <DrillPrimaryBar label="New run" onPrimary={start} />
        </div>
      )}
    </div>
  );
}
