import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { takeDrillLaunch, takeFlashHandOver, takeReviewIndexes, type FlashHandOver } from '../drillLaunch';
import { SpeedDrillView } from './drills/SpeedDrillView';
import { TabSettingsButton } from '../components/TabSettingsButton';
import { strategyRulesFor } from '../../store/profiles';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Action, DeviationId } from '../../engine/deviations';
import { isIndexActive, indexSetFor } from '../../engine/deviations';
import type { GradedEvent } from '../../engine/grade';
import { drawFlashcard, flashCtx } from '../../drills/flashcards';
import { flashOptionsFor } from '../../drills/flashOptions';
import { indexLine, indexPickerText } from '../../drills/withCount';
import { DealToggles } from './drills/DealToggles';
import { plainCellLabel } from '../../drills/cellLabel';
import { formatReviewPlain } from '../../drills/srStatus';
import { drillLegalActions, rulesChipLabels } from '../../drills/legalActions';
import { INSURANCE_HINT, playHint } from '../../audio/misheardLadder';
import { gateDrillAnswer, gateQuizAnswer } from '../../drills/answerGate';
import type { Flashcard } from '../../drills/flashcards';
import { drawQuizItem, quizIndexSet, quizLegalActions, quizRulesChip, redundantForChart, tableMaskNote } from '../../drills/deviationQuiz';
import type { QuizItem } from '../../drills/deviationQuiz';
// R4 (docs/BACKLOG.md, interleaved mixed-session mode): the ONE shared grade
// path -- gradeFlashcardAnswer/gradeQuizAnswer back the standalone
// FlashcardsView/DeviationQuizView AND the mixed-session view, so the two
// contexts cannot drift (same engine graders, same R3 weights, same R1
// latency, same GradedEvent + Stats write). See src/drills/gradeAnswer.ts.
import {
  gradeFlashcardAnswer as gradeFlashcard,
  gradeQuizAnswer as gradeQuiz,
  loadFlashSr,
  loadQuizSr,
  saveFlashSr,
  saveQuizSr,
  TIMEOUT_ANSWER,
  SELF_REPORT_HAD,
  SELF_REPORT_MISSED } from '../../drills/gradeAnswer';
import type { DrillAnswer } from '../../drills/gradeAnswer';
import {
  answeredUnderShotClock,
  answerElapsedMs,
  expiryVerdict,
  readGraceMs,
  shotClockExpired,
  shotClockOn,
  shotClockSuspended,
} from '../../drills/shotClock';
import type { SrCard, SrDeck } from '../../drills/spacedRepetition';
import { restoreSrCard } from '../../drills/spacedRepetition';
import { pickMixedType } from '../../drills/mixedSession';
import type { MixedItemType } from '../../drills/mixedSession';
import { saveSettings, loadStats } from '../../store/persist';
import { isCountFluent } from '../../drills/fluencyGate';
import { PlayingCard } from '../components/PlayingCard';
import { ActionBar } from '../components/ActionBar';
import { ZonePad } from '../components/ZonePad';
import { MistakeCard } from '../components/MistakeCard';
import { ShotClockBar } from '../components/ShotClockBar';
import { StudyChartOverlay } from '../components/StudyChartOverlay';
import { HandResultStrip } from '../components/HandResultStrip';
import { RulesChip } from '../components/RulesChip';
import { releaseAnswerFocus, snapshotResult, type HandResult } from '../handResult';
import { withMissDetail, type DrillHandResult } from './drills/drillMiss';
import { MissHistoryLine } from './drills/MissHistoryLine';
import { withdrawAnswer, wrongTapOffered, type WrongTapRecord } from '../wrongTap';
import type { CellTally } from '../../store/cellStats';
import { answerTooSoon } from '../answerBounce';
import type { Card, Rank } from '../../engine/cards';
import { Segmented } from './Settings';
import { useAudio } from '../../audio/useAudio';
import { narrateSelfCheckReveal, narrateCorrection, narrateFlashcardPrompt, narrateQuizPrompt,
  narrateAnswerEcho,
  DID_YOU_HAVE_IT,
} from '../../audio/narrate';
import { useVoiceControl } from '../useVoiceControl';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../drills/answerPause';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../audio/voiceRecognition';
import { BLIND_TAP_CHANNEL, SCREEN_CHANNEL, VOICE_CHANNEL } from '../../drills/spacedRepetition';
import type { AnswerChannel } from '../../drills/spacedRepetition';
import { DrillModeControls } from './drills/DrillModeControls';
import { QuizAskSwitch } from './drills/QuizAskSwitch';
import { IndexTestView } from './drills/IndexTestView';
import type { VoiceAction } from '../../audio/voiceRecognition';
import { cancelSpeech, isE2eAudioMode, speak } from '../../audio/speech';
import { speechOptsFrom } from '../../audio/speechOpts';
import { requestWakeLock, releaseWakeLock } from '../../audio/wakeLock';
import { ZONE_LABEL } from '../../audio/zones';
import type { ZoneId } from '../../audio/zones';
import { CountDrillView } from './drills/CountDrillView';
import { TrueCountDrillView } from './drills/TrueCountDrillView';
import { ProduceTcDrillView } from './drills/ProduceTcDrillView';
import { PairCancelView } from './drills/PairCancelView';
import { BetSizingView } from './drills/BetSizingView';
import { BET_SIZING_DRILL, BET_SIZING_PICKER } from './drills/betSizingCopy';
import { RulesDiffView } from './drills/RulesDiffView';
import { DeckEstimationView } from './drills/DeckEstimationView';
import { MasteryChallengeView } from './drills/MasteryChallengeView';
import { HandDeckControls } from './drills/HandDeckControls';
import { scopesFrom } from '../../drills/handScope';
import { HandDeckGate } from './drills/HandDeckGate';
import { handDeckFor } from './drills/handDeckFor';
import { settingsForCustomStart } from '../../drills/deckSource';
import { CustomDrillEditor } from '../components/CustomDrillEditor';
import { MarkableHand } from '../components/MarkableHand';
import { focusSwallowsKey, blurAfterChange } from '../keyboardFocus';
import { useVoiceToggle, usePushToTalk, startPushToTalk, isVoiceOn } from '../voiceSession';
import { useEyesFreeToggle, isEyesFreeOn } from '../eyesFreeSession';
import { recordDrive, takeDriveAutoStart } from '../driveLaunch';
import { useWheelCommand } from '../useWheelCommand';
import { signed } from '../../drills/signed';
import { ChartIntro } from './drills/ChartIntro';
import { chartIntroDue, loadChartIntroSeen, saveChartIntroSeen } from '../../drills/chartIntro';
import './drills/drillTiming.css';
import './drills/drillActionBar.css';
import './drills/flashProgress.css';
import { flashProgressLine, goalMetLine, goalsCrossed } from './drills/flashProgress';
import { reviewDoneLine, reviewHeading, reviewStatus, useReviewSession } from './drills/reviewSession';
import './drills/reviewSession.css';

interface DrillsProps {
  settings: Settings;
  activeProfile: Profile;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: Settings) => void;
}

// Desktop keyboard input (operator request): number keys map onto the
// action-zone layout so a keypress grades identically to tapping the
// matching ActionBar button / ZonePad zone. Shared by FlashcardsView and
// DeviationQuizView's action items -- the insurance quiz variant uses its
// own 1=Take/2=Decline mapping instead (see DeviationQuizView's handler).
export const KEY_TO_ACTION: Record<string, Action> = {
  '1': 'hit',
  '2': 'stand',
  '3': 'double',
  '4': 'split',
  '5': 'surrender' };

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Wave A: a real minus sign (U+2212); 0 reads "+0" here, as before. */
function formatSigned(n: number): string {
  return signed(n, { plusZero: true });
}

/* ---------------------------------------------------------------- */
/* Eyes-free (Task 9): shared zone-label echo for both drills.       */
/* ZONE_LABEL (src/audio/zones.ts) only covers the five action zones;*/
/* the insurance quiz's two-zone 'take'/'decline' variant isn't a    */
/* ZoneId, so this widens the lookup rather than editing zones.ts    */
/* (which is T8's file, already committed).                          */
/* ---------------------------------------------------------------- */

const INSURANCE_ZONE_LABEL: Record<'take' | 'decline', string> = {
  take: 'Take',
  decline: 'Decline' };

function zoneLabel(zone: ZoneId | 'take' | 'decline'): string {
  if (zone === 'take' || zone === 'decline') return INSURANCE_ZONE_LABEL[zone];
  return ZONE_LABEL[zone];
}

/* ---------------------------------------------------------------- */
/* Eyes-free ZonePad layout (T0-BUG1, docs/BACKLOG.md).             */
/* The eyes-free ZonePad is a fixed, opaque, full-viewport overlay. */
/* Left at inset:0 it covers the drill's top control strip -- and   */
/* the "Dim screen"/"Eyes-free" toggles that live there -- so a     */
/* real tap on those toggles is intercepted by the pad. We measure  */
/* the control strip's bottom edge and publish it as the            */
/* `--zone-pad-top` CSS var on `.drill-screen`; `.zone-pad` starts  */
/* there instead of top:0, leaving the strip uncovered and tappable */
/* while the pad still covers the whole card/dealer area below it.   */
/* The strip's height is dynamic (category/index rows, an optional  */
/* note), so it's measured live via ResizeObserver rather than      */
/* hardcoded to a magic pixel value. hitTestZone stays correct      */
/* because ZonePad reads its OWN bounding rect -- the five zones     */
/* just re-fit the smaller area beneath the strip.                  */
/* ---------------------------------------------------------------- */
function useControlStripBottom() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBottom(el.getBoundingClientRect().bottom);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return [ref, bottom] as const;
}

function drillScreenStyle(padTop: number): CSSProperties {
  return { ['--zone-pad-top']: `${padTop}px` } as CSSProperties;
}

/* ---------------------------------------------------------------- */
/* B1 fast advance (#8, #10, #14, #17), shared by the three views.   */
/* ---------------------------------------------------------------- */

/** What the study chart is opened on: always a FROZEN hand, never the live
 *  card prop, so it cannot follow the drill onto the next hand (#10). */
interface ChartTarget {
  cards: Card[] | null;
  up: Rank;
  graded?: { expected?: string; reason?: string; tc?: number };
}

function chartTargetFrom(result: HandResult): ChartTarget {
  return {
    cards: result.cards,
    up: result.up,
    graded: { expected: result.expected, reason: result.reason, tc: result.tc ?? 0 },
  };
}

/**
 * The last answered hand's result and the chart it can open.
 *
 * In visual mode an answer no longer waits on a Next tap: the view grades,
 * freezes the result here, and draws the next hand in the same handler. The
 * strip shows the frozen result; "Show on chart" opens that frozen hand.
 * Eyes-free, voice and the wheel keep their timed auto-advance and the
 * full correction panel -- nobody is looking at a strip while driving.
 */
function useHandResult() {
  const [lastResult, setLastResult] = useState<DrillHandResult | null>(null);
  const [chartTarget, setChartTarget] = useState<ChartTarget | null>(null);
  // #22: the miss now on the strip, while it can still be withdrawn. Cleared
  // by every graded answer (`clearWrongTap`), on every channel, so the link
  // never outlives the next answer.
  const [wrongTap, setWrongTap] = useState<WrongTapRecord | null>(null);
  const idRef = useRef(0);
  const nextResultId = () => {
    idRef.current += 1;
    return idRef.current;
  };
  /** Freeze an answered hand into the strip, offering "Wrong tap" on a miss. */
  const showResult = (
    result: DrillHandResult,
    event: GradedEvent,
    revert: () => void,
    cellBefore: CellTally | null | undefined,
  ) => {
    setLastResult(result);
    setWrongTap(wrongTapOffered(event) ? { resultId: result.id, event, revert, cellBefore } : null);
  };
  const clearWrongTap = () => setWrongTap(null);
  /** The strip's onWrongTap for `result`, or undefined when not offered. */
  const wrongTapFor = (result: HandResult): (() => void) | undefined => {
    if (!wrongTap || wrongTap.resultId !== result.id) return undefined;
    return () => {
      withdrawAnswer(wrongTap);
      setWrongTap(null);
      setLastResult((r) => (r && r.id === wrongTap.resultId ? { ...r, undone: true } : r));
    };
  };
  return {
    lastResult,
    chartTarget,
    setChartTarget,
    nextResultId,
    showResult,
    clearWrongTap,
    wrongTapFor,
  };
}


/* ---------------------------------------------------------------- */
/* Flashcards                                                        */
/* ---------------------------------------------------------------- */

function FlashcardsView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
  handOver = null,
  onHome }: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
  /** R7 / R5: a review or session deck handed over in memory (Drills takes it). */
  handOver?: FlashHandOver | null;
  /** The review's end state offers Home. */
  onHome?: () => void;
}) {
  const srDeckRef = useRef<SrDeck>(loadFlashSr());
  // V5-1: the cell just answered, which the next draw biases toward the cells
  // most confusable with. A REF and not the `card` state because next() is
  // also reachable from the auto-advance timer, where a captured `card` would
  // be a render behind -- and a stale previous cell silently boosts the wrong
  // neighbours, which no test would catch.
  const lastCellRef = useRef<string | null>(null);
  // Wave A F4b: the index the last answer was reviewed under, when the card's
  // expected play came from an index (gradeAnswer.ts) -- for "Wrong tap".
  const indexReviewRef = useRef<{ key: string; prev: SrCard | undefined } | null>(null);
  // Eyes-free audio (Task 9): a per-session choice, shared across screens for
  // the life of this page load (ui/eyesFreeSession.ts) rather than owned by
  // each drill -- it used to reset on every navigation, which in a car reads
  // as the app having gone silent for no reason.
  const [eyesFree, setEyesFree] = useEyesFreeToggle('flashcards');
  // B7: progress to the basic-strategy goal. `progressStats` is the snapshot
  // taken at the previous answer (or at mount); a goal crossed between two
  // snapshots shows a confirmation until the next answer.
  const [progressStats, setProgressStats] = useState(() => loadStats());
  const [goalMet, setGoalMet] = useState<string | null>(null);
  // A ref as well: a grade can arrive from a timer or voice callback holding
  // an older render's closure, and a stale `before` would re-announce a goal.
  const progressStatsRef = useRef(progressStats);
  // B2: a card from the deck `drill` describes (scope and deck source), or
  // null when that deck is empty -- HandDeckGate then replaces this view.
  // B2 "Review N due" (Lane H, controller ruling): a review deck Home handed
  // over replaces the saved deck for this session only -- every hand type,
  // only the due cells, nothing written to Settings or the Custom deck.
  // Wave B2 R7 (#42): finite -- a cell leaves once answered right, the one
  // just answered is not dealt straight back, and the session ends when none
  // are left. R5 (#46): the session report's missed cells come the same way.
  const review = useReviewSession(handOver?.ids ?? null);
  const reviewSource = handOver?.source ?? 'review';
  const reviewDeckFor = (previous: string | null) => {
    const ids = review.pool(previous);
    return { scopes: 'all' as const, ids, weights: new Map(ids.map((id) => [id, 1])) };
  };
  const drawFrom = (drill: Settings['drill'], previous: string | null): Flashcard | null => {
    const deck = review.active ? reviewDeckFor(previous) : handDeckFor(drill, activeProfile);
    if (deck.ids.length === 0) return null;
    return drawFlashcard(
      deck.scopes,
      srDeckRef.current,
      Date.now(),
      randomSeed(),
      activeProfile.rules,
      drill.flashByConfusability,
      previous,
      deck.weights,
      // A review asks the cell itself: no count (an index answer would be
      // reviewed in the quiz deck and leave the cell due), no fallback deal.
      review.active ? { fallbacks: false, withCount: false } : flashOptionsFor(drill, eyesFree),
    );
  };
  const [card, setCard] = useState<Flashcard>(
    // The gate only mounts this view on a non-empty deck; the chart draw is
    // a backstop, never the expected path.
    () => drawFrom(settings.drill, null) ?? drawFlashcard('all', srDeckRef.current, Date.now(), randomSeed(), activeProfile.rules),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction: Action; event: GradedEvent } | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  // B1: the last answered card, frozen, and the hand the chart opens on.
  const { lastResult, chartTarget, setChartTarget, nextResultId, showResult, clearWrongTap, wrongTapFor } =
    useHandResult();
  const audio = useAudio(settings.audio);

  // Voice input. Per-session like eyes-free, and deliberately NOT persisted:
  // a setting that survives a reload would open the microphone on load, which
  // browsers refuse without a gesture anyway and which nobody should have to
  // discover after the fact.
  // Remembered for the life of the page load, not the life of this screen:
  // a toggle forgotten on every navigation is indistinguishable, in a car,
  // from a microphone that failed. See ui/voiceSession.ts.
  const [voiceOn, setVoiceOn] = useVoiceToggle('flashcards');
  // The wheel's open-mic window (ui/voiceSession.ts). While it is open the
  // recogniser runs even with the Voice answers toggle off, which is the whole
  // point of push-to-talk: no permanently-open microphone, and therefore a
  // wheel that still reaches the app the rest of the time.
  const pushToTalkOpen = usePushToTalk();
  // Detected once. The toggle is hidden rather than disabled where there is
  // no API at all: an inert control invites the operator to keep tapping it.
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  // Bumped every time a new card is drawn so a stale auto-advance timer
  // from a previous card can recognize itself as stale and no-op, even
  // though its own effect cleanup already clears it on unmount/early exit.
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  // R1 (docs/BACKLOG.md, decision-latency telemetry): performance.now() at
  // the moment the CURRENT card was drawn -- read in gradeFlashcardAnswer
  // (the shared grade site) to compute elapsedMs. Written in the exact same
  // place as `runIdRef.current += 1` below (both `next()` and this initial
  // value), so it can never point at a stale, already-answered card: there
  // is no async gap between drawing a card and this ref being updated for
  // it, unlike the auto-advance timer runIdRef guards against.
  // `performance.now()`, never `Date.now()` -- monotonic, immune to
  // wall-clock adjustments, and matches the elapsedMs contract on
  // GradedEvent.
  const promptShownAtRef = useRef(performance.now());
  // Wave A F3: where the ANSWER clock starts. The draw time in visual mode;
  // moved to the measured end of the spoken prompt when the card is read out
  // (eyes-free or voice), because the seconds the question takes to say are
  // not answer time. Kept apart from promptShownAtRef, which the bounce guard
  // keys on and which must stay at the draw.
  const answerClockRef = useRef(performance.now());
  // Review fix (b): set when a spoken correction is still playing as the next
  // card is dealt, so that card's prompt queues behind it.
  const promptQueuesRef = useRef(false);
  // Spoken "Correct." is only wanted once per drill session -- after that,
  // correct answers still chime but skip the spoken text. `useRef(false)`
  // is fresh on every mount, and this view is unmounted/remounted each time
  // it's (re)entered from the picker (see the Drills switch below), so a
  // new session always starts with this false; no extra reset effect needed.
  const spokenCorrectOnceRef = useRef(false);
  // The wheel self-check: is the right play currently revealed and waiting to
  // be reported on? State for the banner, a REF for the handler, because two
  // wheel presses can land in the same tick and the second would otherwise be
  // handled by the closure from the render BEFORE the first -- the same bug
  // the count drills' `phaseRef` exists for.
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const wheelPhaseRef = useRef<'asking' | 'reporting' | 'feedback'>('asking');
  // The correction on screen, for the same reason: the second of two presses
  // in one tick arrives before React has re-rendered with it.
  const feedbackRef = useRef<{ correct: boolean; correctAction: Action; event: GradedEvent } | null>(null);
  // T0-BUG1: measure the control strip so the eyes-free ZonePad overlay can
  // start BELOW it (keeping its Dim-screen/Eyes-free toggles tappable).
  const [controlsRef, padTop] = useControlStripBottom();

  // R1's shot clock. The timer is a plain setTimeout rather than anything
  // derived from the countdown bar: the bar is a CSS animation with no callback
  // and no JS state, so the deadline has to be kept separately. Both are keyed
  // to the same runId, which is what stops a timer from a previous card grading
  // the one now on screen.
  const shotClockMs = settings.drill.shotClockMs;
  const shotClockTimerRef = useRef<number | null>(null);
  // Wave A F3: no clock eyes-free or by voice.
  const clockSuspended = shotClockSuspended(eyesFree, voiceOn);
  // Wave A (s09): expiries in a row, and whether the clock has stopped
  // because nobody is answering. Any answer resets both.
  const consecutiveTimeoutsRef = useRef(0);
  const [clockIdle, setClockIdle] = useState(false);
  // Wave A (s09): reading time before THIS card's clock starts -- set after a
  // miss in visual mode, when the next card is dealt under the correction.
  const clockGraceRef = useRef(0);

  const clearShotClock = () => {
    if (shotClockTimerRef.current !== null) {
      window.clearTimeout(shotClockTimerRef.current);
      shotClockTimerRef.current = null;
    }
  };

  /**
   * Show a graded answer. The ONE place `feedback` is set to a result, so the
   * wheel's phase ref cannot fall out of step with what is on screen -- there
   * are four grade sites (button, zone, shot clock, self-report) and a missed
   * one would leave the wheel still offering "I had it" over a correction.
   */
  const showFeedback = (result: { correct: boolean; correctAction: Action; event: GradedEvent }) => {
    wheelPhaseRef.current = 'feedback';
    feedbackRef.current = result;
    setSelfCheckOpen(false);
    setFeedback(result);
  };

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };

  // Clear any pending auto-advance timer on unmount.
  useEffect(() => clearAdvanceTimer, []);

  // Eyes-free requires audio to be enabled; drop it if audio gets disabled
  // (e.g. via Settings) while checked, rather than leaving a checked-but-
  // disabled control.
  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  // Wake lock lifecycle: held for as long as eyes-free is active, released
  // the moment it's turned off (and unconditionally on unmount below).
  useEffect(() => {
    if (eyesFree) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }
  }, [eyesFree]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, []);

  // Speak the scenario whenever a new card is drawn, or the instant
  // eyes-free is switched on for the current card. Unlike Phase-A's
  // verbosity-gated narration, eyes-free speaks regardless of verbosity --
  // it IS the primary output channel in this mode, not decoration (same
  // precedent as CountDrillView's flashing-card narration).
  useEffect(() => {
    // Review fix (b): a tap answer deals the next card at once, while its
    // correction is still being spoken. That prompt queues behind the
    // correction instead of cutting it off; every other prompt interrupts.
    const interrupt = !promptQueuesRef.current;
    promptQueuesRef.current = false;
    // Voice counts as eyes-free whether or not the ZonePad is up: someone
    // answering out loud is not watching the screen, and an unspoken prompt
    // would leave them waiting for a question that never comes.
    if (!eyesFree && !voiceOn) return;
    // #27 / #53: eyes-free switched on over a card dealt with a count or as a
    // fallback. The prompt says neither, so deal a plain card instead of
    // grading at a count the listener never heard.
    if (eyesFree && !feedbackRef.current && (card.tc !== undefined || card.ctx)) {
      next();
      return;
    }
    // Wave A F3: the answer clock starts when the question has been SAID.
    const runId = runIdRef.current;
    speak(narrateFlashcardPrompt(card.cards, card.up), {
      ...speechOptsFrom(settings.audio, { interrupt }),
      onEnd: () => {
        if (runIdRef.current !== runId || feedbackRef.current) return;
        answerClockRef.current = performance.now();
        // The prompt queued behind the correction, so the reading time is
        // already off the answer clock (and the shot clock is suspended).
        clockGraceRef.current = 0;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, eyesFree, voiceOn]);

  const next = (drill: Settings['drill'] = settings.drill) => {
    runIdRef.current += 1;
    clearAdvanceTimer();
    // Advancing invalidates the correction the chart was opened for, so the
    // overlay must not survive it: left open it re-pointed at the NEW card
    // (its cards/dealerUp are live props), and the learner closed it onto a
    // hand they had never been asked about.
    setShowChart(false);
    const drawn = drawFrom(drill, lastCellRef.current);
    // An empty deck: HandDeckGate takes the screen on this same render. An
    // empty review is a finished one (R7).
    if (!drawn) {
      if (review.active) finishReview();
      return;
    }
    lastCellRef.current = drawn.cellId;
    setCard(drawn);
    setFeedback(null);
    wheelPhaseRef.current = 'asking';
    feedbackRef.current = null;
    setSelfCheckOpen(false);
    promptShownAtRef.current = performance.now();
    answerClockRef.current = promptShownAtRef.current;
    clockGraceRef.current = 0;
  };

  // R7: the end of a review. Said out loud too: in the car nothing else says
  // that the dealing has stopped.
  const finishReview = () => {
    clearAdvanceTimer();
    clearShotClock();
    review.finish();
    if (eyesFree || voiceOn) {
      speak(reviewSource === 'review' ? 'Review done.' : 'All done.', speechOptsFrom(settings.audio, { interrupt: false }));
    }
  };

  // #13 / B2: HandDeckControls has already saved the change.
  const changeScopes = (nextSettings: Settings) => {
    onSettingsChange(nextSettings);
    next(nextSettings.drill);
  };

  const handleBack = () => {
    // Stop mid-utterance speech on the way out, matching CountDrillView.
    // Without it, a correction being spoken carried on over the drill picker.
    cancelSpeech();
    clearAdvanceTimer();
    clearShotClock();
    void releaseWakeLock();
    onBack();
  };

  const handleRepeat = () => {
    speak(narrateFlashcardPrompt(card.cards, card.up), speechOptsFrom(settings.audio, { interrupt: true }));
  };

  // `spokenMs` is how long the correction will occupy the speaker. The next
  // prompt speaks with `interrupt: true`, so advancing on the configured
  // pause alone cut the explanation off mid-sentence -- see answerPause.ts.
  const scheduleAutoAdvance = (spokenMs = 0) => {
    clearAdvanceTimer();
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenMs));
  };

  // Shared grading core (R4): the SAME gradeFlashcard function backs the
  // visual ActionBar taps, the eyes-free ZonePad taps, AND the mixed-session
  // view, so none of them can drift. R1 latency is captured here (BEFORE any
  // classification work) and passed in; R3 weights + the Stats write happen
  // inside gradeFlashcard. No audio, no setState -- callers layer their own
  // feedback on top.
  const gradeFlashcardAnswer = (
    taken: DrillAnswer,
    channel: AnswerChannel,
  ): { event: GradedEvent; correctAction: Action; prevSr: SrCard | undefined; cellBefore: CellTally | null } => {
    // Wave A review: reading a miss's correction is not answer time.
    const elapsedMs = answerElapsedMs(performance.now() - answerClockRef.current, clockGraceRef.current);
    // #22: the card's schedule before this answer, for "Wrong tap".
    const prevSr = srDeckRef.current[card.cellId];
    clearWrongTap();
    // Somebody is there: an answer restarts a clock stopped for idleness.
    consecutiveTimeoutsRef.current = 0;
    setClockIdle(false);
    const result = gradeFlashcard(
      card,
      taken,
      activeProfile.rules,
      elapsedMs,
      srDeckRef.current,
      Date.now(),
      channel,
      // V5-2: accuracy under the shot clock and accuracy without it measure
      // different things (see engine/grade.ts), so the grader records which
      // this was. Passed IN rather than stamped on the way out -- the grader
      // is what persists the event. Wave A review: a clock suspended
      // (eyes-free, voice) or stopped for idleness was not running.
      answeredUnderShotClock(shotClockMs, clockSuspended, clockIdle),
    );
    srDeckRef.current = result.nextDeck;
    indexReviewRef.current = result.indexReview ?? null;
    // R7: a right answer takes the cell out of a review.
    review.answered(card.cellId, result.event.correct);
    return { event: result.event, correctAction: result.correctAction, prevSr, cellBefore: result.cellBefore };
  };

  // Gates the SPOKEN "Correct." text (never the chime, never wrong-answer
  // speech, never the visible badge) to once per drill session: the first
  // correct answer speaks in full and flips the ref; every correct answer
  // after that skips `doSpeak` entirely so only the chime plays. Shared by
  // both handlers below so the visual and eyes-free paths can't drift.
  // Returns how long it will be talking, so the caller can hold the answer on
  // screen until it has finished. A gated-out "Correct." returns 0 and the
  // configured pause is used unchanged.
  const speakCorrectionOnceGated = (
    event: GradedEvent,
    doSpeak: (text: string) => void,
  ): number => {
    if (event.correct && spokenCorrectOnceRef.current) return 0;
    const text = narrateCorrection(event);
    doSpeak(text);
    if (event.correct) spokenCorrectOnceRef.current = true;
    return spokenPauseFor(text, settings.audio.rate);
  };

  /**
   * B1 (#8/#14/#17): freeze the answered card into the result strip. The SR
   * line is read here, after the grade wrote the deck, so a right answer
   * visibly pushes the review out.
   *
   * Called by EVERY grade site, including the ones that show the correction
   * panel and auto-advance (voice, zone, wheel, timeout): the strip appears
   * once that panel is gone, and it must describe the latest answer rather
   * than one from several hands back (review fix a).
   */
  const freezeResult = (event: GradedEvent, prevSr: SrCard | undefined, cellBefore: CellTally | null) => {
    // B7: the grade has already persisted, so loadStats() includes it.
    const afterStats = loadStats();
    const crossed = goalsCrossed(progressStatsRef.current, afterStats, scopesFrom(settings.drill));
    setGoalMet(crossed.length > 0 ? goalMetLine(crossed, afterStats) : null);
    progressStatsRef.current = afterStats;
    setProgressStats(afterStats);
    const indexReview = indexReviewRef.current;
    // Wave A review: an index card was reviewed in the QUIZ deck (F4b), so its
    // "Next review" is the index's -- not the untouched flash cell's, which
    // after a missed index read "in N days" while the index was due now.
    const srCard = indexReview ? loadQuizSr()[indexReview.key] : srDeckRef.current[card.cellId];
    const srText = formatReviewPlain(srCard, Date.now());
    const cellId = card.cellId;
    const snapshot = snapshotResult(
      nextResultId(),
      event,
      { cards: card.cards, up: card.up, tc: card.tc ?? null },
      {
        cellId,
        sr: srText ? { text: srText, box: srCard?.box } : null,
        // #53: a With-count card says whether an index applied. Wave A (s03):
        // not on a missed index -- the miss line already names it, and the
        // second copy only added height.
        ...(card.tc !== undefined && !(event.deviationId && !event.correct)
          ? { indexNote: indexLine(event, activeProfile.rules, { cards: card.cards, up: card.up, ctx: flashCtx(card) }) }
          : {}),
      },
    );
    showResult(
      // B7: a basic-strategy miss reads its chart region; B6: and its history.
      withMissDetail(snapshot, event, cellBefore, activeProfile.rules),
      event,
      // #22: a withdrawn answer puts the card's schedule back as well.
      () => {
        // Wave A F4b: an index card was reviewed in the quiz deck instead.
        if (indexReview) {
          saveQuizSr(restoreSrCard(loadQuizSr(), indexReview.key, indexReview.prev));
          return;
        }
        srDeckRef.current = restoreSrCard(srDeckRef.current, cellId, prevSr);
        saveFlashSr(srDeckRef.current);
      },
      cellBefore,
    );
  };

  /** Visual mode: freeze the answer into the strip and deal the next card in
   *  the same handler. */
  const advanceWithResult = (event: GradedEvent, prevSr: SrCard | undefined, cellBefore: CellTally | null) => {
    freezeResult(event, prevSr, cellBefore);
    releaseAnswerFocus();
    next();
    // Wave A (s09): a miss leaves a correction to read under the new card.
    clockGraceRef.current = readGraceMs(!event.correct);
  };

  const handleAction = (taken: Action) => {
    // R7: a finished review has no card to answer.
    if (review.doneRef.current) return;
    // Review fix (c): the second touch of a bounce lands on the new card.
    if (answerTooSoon(promptShownAtRef.current)) return;
    // An ActionBar click: the hand is on screen and a finger is on the button.
    const { event, prevSr, cellBefore } = gradeFlashcardAnswer(taken, SCREEN_CHANNEL);

    const spokenMs = speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(event.correct ? 'good' : 'bad');
    // Review fix (b): the next card's prompt must not cut this off.
    if (spokenMs > 0) promptQueuesRef.current = true;

    advanceWithResult(event, prevSr, cellBefore);
  };

  // Eyes-free zone tap: ZoneId and Action are the identical five-member
  // literal union (hit/stand/double/split/surrender), so the tapped zone
  // maps straight onto the grading function's `taken` param with no
  // translation layer to drift out of sync. ZonePad's onAnswer type also
  // covers the insurance 'take'/'decline' variant it never produces in
  // 'action' mode -- narrow it away rather than widening this handler.
  const handleZoneAnswer = (
    zone: ZoneId | 'take' | 'decline',
    // A blind zone tap by default. Voice overrides it: same path, but the
    // hands never left the wheel, and the SR schedule is told the difference
    // (drills/spacedRepetition.ts's channel ceiling).
    channel: AnswerChannel = BLIND_TAP_CHANNEL,
  ) => {
    if (zone === 'take' || zone === 'decline') return;
    if (review.doneRef.current) return;
    // Review fix (c): a bounce on the pad, not an answer to this card.
    if (answerTooSoon(promptShownAtRef.current)) return;

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    const gate = gateDrillAnswer(zone, card.cards, activeProfile.rules, card.up, card.ctx);
    if (!gate.accepted) {
      speak(gate.announcement!, speechOptsFrom(settings.audio, { interrupt: true }));
      return;
    }

    speak(narrateAnswerEcho(zoneLabel(zone)), speechOptsFrom(settings.audio, { interrupt: true }));

    const { event, correctAction, prevSr, cellBefore } = gradeFlashcardAnswer(zone, channel);

    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(event.correct ? 'good' : 'bad');

    freezeResult(event, prevSr, cellBefore);
    showFeedback({ correct: event.correct, correctAction, event });
    scheduleAutoAdvance(spokenMs);
  };

  /**
   * The shot clock ran out (R1, drills/shotClock.ts).
   *
   * Graded, not skipped: the card counts as missed, the SR deck takes it as a
   * miss, and Stats files it under `timeout` rather than as a wrong play --
   * `TIMEOUT_ANSWER` carries that all the way through the shared grade path, so
   * the flashcard and quiz drills cannot disagree about what a timeout is.
   *
   * The elapsed time recorded is MEASURED, never the nominal limit: a
   * backgrounded tab throttles timers hard, and writing "3000ms" into the
   * latency history for a card that actually sat there for half a minute would
   * quietly poison the median this whole feature is built on.
   *
   * Auto-advances in every mode, not just eyes-free. Someone who let the clock
   * run out is not looking at the screen (or has walked away), and leaving a
   * dead card up waiting for a tap is the one outcome that makes a timed drill
   * feel broken.
   */
  const handleShotClockExpiry = () => {
    if (review.doneRef.current) return;
    const elapsedMs = performance.now() - promptShownAtRef.current;
    if (!shotClockExpired(elapsedMs - clockGraceRef.current, shotClockMs)) return;
    // Wave A (s09): the second unanswered card in a row is not graded -- the
    // clock stops and waits for somebody to answer.
    if (expiryVerdict(consecutiveTimeoutsRef.current) === 'stop') {
      setClockIdle(true);
      return;
    }
    consecutiveTimeoutsRef.current += 1;

    const prevSr = srDeckRef.current[card.cellId];
    clearWrongTap();
    const result = gradeFlashcard(
      card,
      TIMEOUT_ANSWER,
      activeProfile.rules,
      elapsedMs,
      srDeckRef.current,
      Date.now(),
    );
    srDeckRef.current = result.nextDeck;
    indexReviewRef.current = result.indexReview ?? null;

    const spokenMs = speakCorrectionOnceGated(result.event, (text) =>
      eyesFree || voiceOn
        ? speak(text, speechOptsFrom(settings.audio))
        : audio.say(text, { interrupt: true }),
    );
    audio.ding('bad');
    // Visual mode: a timeout is a miss like any other, so it goes to the
    // strip and the next card is dealt. The timed correction screen is for
    // eyes-free, where nobody is reading a strip.
    if (!eyesFree && !voiceOn) {
      advanceWithResult(result.event, prevSr, result.cellBefore);
      return;
    }
    freezeResult(result.event, prevSr, result.cellBefore);
    showFeedback({ correct: false, correctAction: result.correctAction, event: result.event });
    scheduleAutoAdvance(spokenMs);
  };

  // Arm the clock for the card on screen. Re-armed whenever the card changes,
  // and cleared the moment an answer lands (`feedback`), the chart overlay goes
  // up over a frozen correction, or the limit is switched off in Settings
  // mid-drill. `runIdRef` is not a dep: it is a ref, and `card` changes in the
  // same render that bumps it.
  useEffect(() => {
    clearShotClock();
    if (!shotClockOn(shotClockMs)) return;
    if (feedback || showChart || clockSuspended || clockIdle || review.done) return;
    const runId = runIdRef.current;
    shotClockTimerRef.current = window.setTimeout(() => {
      shotClockTimerRef.current = null;
      // The card moved on while this timer was queued -- grading now would
      // score the hand on screen against a clock that belonged to a previous
      // one. Same guard, same reason, as the auto-advance timer's.
      if (runIdRef.current !== runId) return;
      handleShotClockExpiry();
    }, shotClockMs + clockGraceRef.current);
    return clearShotClock;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, feedback, showChart, shotClockMs, clockSuspended, clockIdle, review.done]);

  /**
   * A spoken answer.
   *
   * Routed through handleZoneAnswer rather than handleAction, because voice
   * IS an eyes-free channel and needs everything that path provides: the
   * legality gate refuses OUT LOUD (an illegal Split cannot be indicated by
   * a dark button to someone who is driving), the zone name is echoed back so
   * the speaker knows they were understood, and the answer auto-advances
   * without a tap. Sharing the path also means the spoken and tapped answers
   * cannot drift apart.
   */
  const handleVoiceAction = (action: VoiceAction) => {
    if (review.doneRef.current) return;
    if (action === 'repeat') {
      handleRepeat();
      return;
    }
    // Yes/no belong to insurance prompts, which flashcards never ask.
    if (action === 'yes' || action === 'no') return;
    // The chart overlay is modal over a frozen correction, exactly as for the
    // keyboard: answering behind it would draw a card nobody can see.
    if (showChart) return;
    // Already answered. The auto-advance is running and a second answer would
    // grade the next card against a word said about the previous one.
    if (feedback) return;

    handleZoneAnswer(action, VOICE_CHANNEL);
    // The recogniser dies on its own roughly every ninety seconds, and the
    // gap while it restarts is deaf. It cannot be overlapped away -- a second
    // recogniser ends the first -- so it is moved HERE, into the pause where
    // the answer is being read back and nobody is talking.
    voice.cycleIfStale();
  };


  /**
   * The eyes-free self-check: what the two wheel buttons do on a flashcard.
   *
   * A flashcard answer is a five-way choice and the wheel has two buttons, so
   * the wheel cannot state a play. It can run the shape the count drills
   * already use instead -- say the right play, then ask whether you had it --
   * and that answer IS binary. `SELF_REPORT_HAD`/`SELF_REPORT_MISSED` carry it
   * through the shared grade path (drills/gradeAnswer.ts).
   *
   * (An earlier comment here refused the wheel on the grounds that this screen
   * renders the count drills as children, so a claim here would steal their
   * presses. It does not: `Drills` renders them itself, as siblings, and only
   * one is ever mounted. The other half of that refusal -- one button cannot
   * pick one of five plays -- was right, and is why this is a self-check
   * rather than an answer.)
   */
  const revealForSelfCheck = () => {
    wheelPhaseRef.current = 'reporting';
    setSelfCheckOpen(true);
    speak(
      narrateSelfCheckReveal(card.correct),
      speechOptsFrom(settings.audio, { interrupt: true }),
    );
  };

  const submitSelfReport = (had: boolean) => {
    const { event, correctAction, prevSr, cellBefore } = gradeFlashcardAnswer(
      had ? SELF_REPORT_HAD : SELF_REPORT_MISSED,
      // SCREEN_CHANNEL, and not the eyes-free/hands-free channel the press
      // physically was. The channel ceiling exists to stop an easy answer
      // promoting a card as far as a hard one, and a self-report is the
      // easiest of all: the app checked nothing. Graded on its delivery it
      // would earn the HIGHEST cap for the weakest evidence. A miss still
      // demotes in full -- admitting one is worth taking at face value.
      SCREEN_CHANNEL,
    );
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(event.correct ? 'good' : 'bad');
    freezeResult(event, prevSr, cellBefore);
    showFeedback({ correct: event.correct, correctAction, event });
    scheduleAutoAdvance(spokenMs);
  };

  useWheelCommand((command) => {
    // Push-to-talk mode borrows both buttons: forward opens the microphone for
    // a few seconds, back still repeats. See ui/voiceSession.ts.
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('flashcards');
        audio.ding('attention');
      } else {
        handleRepeat();
      }
      return;
    }
    // The chart overlay is modal over a frozen correction, exactly as for the
    // keyboard and for voice.
    if (showChart) return;
    // R7: nothing left to ask.
    if (review.doneRef.current) return;

    if (wheelPhaseRef.current === 'reporting') {
      submitSelfReport(command === 'forward');
      return;
    }
    if (wheelPhaseRef.current === 'feedback') {
      if (command === 'forward') {
        next();
      } else if (feedbackRef.current) {
        speak(narrateCorrection(feedbackRef.current.event), speechOptsFrom(settings.audio, { interrupt: true }));
      }
      return;
    }
    // Asking. Forward reveals the play; back repeats the hand, which is the
    // one thing the operator asked for by name ("repeat is useful").
    if (command === 'forward') revealForSelfCheck();
    else handleRepeat();
  });

  const voice = useVoiceControl({
    // Push-to-talk opens the recogniser for its window even with the toggle
    // off; without this the wheel would open a microphone nothing listens to.
    enabled: voiceOn || pushToTalkOpen,
    onAction: handleVoiceAction,
    // Eyes-free, a rejection is silence, and silence looks the same as a dead
    // microphone. A short cue says "say it again" without costing a sentence
    // of narration mid-drill; Mute silences it like every other tone.
    onNotUnderstood: () => audio.ding('again'),
    escalation: {
      promptKey: card,
      reask: handleRepeat,
      hint: () =>
        speak(
          playHint(drillLegalActions(card.cards, activeProfile.rules, card.up, card.ctx)),
          speechOptsFrom(settings.audio, { interrupt: true }),
        ),
    },
    // Bias the engine toward the words it should be hearing. Reported from
    // real use: "stand" came back as "Stant" and was rejected -- unbiased,
    // the engine is choosing a one-syllable word out of all of English.
    biasPhrases: Object.keys(VOICE_ACTIONS),
    onListening: () => audio.dingWhenQuiet('ready'),
    context: 'flashcards',
  });

  // Desktop keyboard input (operator request): while an answer is awaited,
  // number keys 1-5 feed the SAME handler a tap on that action would use --
  // handleAction in visual mode, handleZoneAnswer in eyes-free mode (so the
  // eyes-free zone-name echo/audio path is identical to a real zone tap,
  // and visual-mode grading/audio is identical to an ActionBar click).
  // Enter/Space advance once feedback (the "Next" state) is showing.
  // Skipped whenever a native input/select/textarea has focus, so the
  // category Segmented control / toggles above are unaffected. Depends on
  // `feedback` (not `card`): a fresh card is always drawn in the same
  // render that resets feedback to null, so this closure is never stale.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      // The chart overlay is modal over a frozen correction. Without this,
      // Enter (the obvious "dismiss" key) ran next() BEHIND the overlay --
      // drawing a new card, clearing the correction, and in eyes-free even
      // narrating it -- while the chart stayed up.
      if (showChart) return;
      if (review.doneRef.current) return;

      if (!feedback) {
        const action = KEY_TO_ACTION[e.key];
        if (!action) return;
        e.preventDefault();
        // The keyboard is an alias for the buttons, so it obeys the same
        // legality gate they do. Without this, pressing 4 would submit a
        // Split on a 10,6 that the (disabled) Split button cannot -- and
        // record an impossible play as a "mistake" against the learner.
        //
        // Feedback follows the channel: eyes-free routes through
        // handleZoneAnswer, which refuses OUT LOUD (A1), while eyes-on stays
        // silent because the button is already visibly dark.
        if (eyesFree) {
          handleZoneAnswer(action);
        } else if (gateDrillAnswer(action, card.cards, activeProfile.rules, card.up, card.ctx).accepted) {
          handleAction(action);
        }
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // `card` is a REQUIRED dep, not a convenience. The old comment assumed a
    // fresh card is always drawn in the same render that resets feedback to
    // null, so `feedback` alone was a sufficient proxy. `changeScopes`
    // breaks that: it calls next() while feedback is ALREADY null, React bails
    // on the no-op state write, the dep array never changes, and the listener
    // stays bound to the previous card. The next keypress then graded the hand
    // you had already left -- accepting a Split the visible hand cannot make,
    // and writing the miss into Stats and the SR deck under the OLD cellId.
    // Every sibling view (quiz, mixed, pair-cancel, bet/sit/leave) already
    // lists its item here; this was the only one that did not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, eyesFree, card, showChart]);

  const openChartOn = (result: HandResult) => {
    setChartTarget(chartTargetFrom(result));
    setShowChart(true);
  };

  // Closing the chart over a strip lands on a card that has been waiting,
  // unanswered, the whole time the chart was up. Its clock restarts so that
  // time is not charged to the answer (latency, shot clock).
  const closeChart = () => {
    setShowChart(false);
    if (!feedbackRef.current) {
      runIdRef.current += 1;
      promptShownAtRef.current = performance.now();
      answerClockRef.current = promptShownAtRef.current;
      clockGraceRef.current = 0;
    }
  };

  const reviewNoun = reviewSource === 'review' ? 'cell' : 'hand';
  if (review.done) {
    return (
      <ReviewDone
        heading={reviewHeading(reviewSource, review.total)}
        line={reviewDoneLine(reviewSource, review.total, reviewNoun)}
        onBack={handleBack}
        onHome={onHome}
        lastResult={lastResult}
      />
    );
  }

  return (
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">{review.active ? reviewHeading(reviewSource, review.total) : 'Flashcards'}</div>
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
        {/* R7 (#40, #41): a review deals its own cells, so the saved deck's
            controls and goal line would describe something else -- and a tap
            on them would rewrite the saved deck. A status line instead. */}
        {review.active ? (
          <ReviewStatusLine text={reviewStatus(reviewSource, review.total, review.left, reviewNoun)} />
        ) : (
          <>
            <HandDeckControls settings={settings} onChange={changeScopes} />
            <div className="flash-progress" data-testid="flash-progress">
              {flashProgressLine(progressStats, scopesFrom(settings.drill))}
            </div>
            {goalMet && (
              <div className="flash-goal-met" role="status" data-testid="flash-goal-met">
                {goalMet}
              </div>
            )}
          </>
        )}

        <DrillModeControls
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onEyesFreeChange={(on) => {
            // A pending auto-advance is an eyes-free affordance; leaving
            // eyes-free must cancel it, or the correction vanishes and a new
            // card appears on its own in visual mode.
            if (!on) clearAdvanceTimer();
            setEyesFree(on);
          }}
          voiceSupported={voiceSupported}
          voiceOn={voiceOn}
          onVoiceChange={setVoiceOn}
          voiceStatus={voice.status}
          options={review.active ? undefined :
            <>
              {/* #27 / #53: set once, so folded with the other options --
                  a row of its own pushed the answers off a 635px phone. */}
              <DealToggles settings={settings} onChange={changeScopes} withCount />
              {/* V5-1/#52: interleaving pays most when confusable items land
                  back to back (Brunmair & Richter 2019). On, half the cards
                  are drawn only from the last hand's look-alikes. */}
              <label className="count-toggle">
                <input
                  type="checkbox"
                  checked={settings.drill.flashByConfusability}
                  onChange={(e) => {
                    const nextSettings: Settings = {
                      ...settings,
                      drill: { ...settings.drill, flashByConfusability: e.target.checked },
                    };
                    saveSettings(nextSettings);
                    onSettingsChange(nextSettings);
                  }}
                />
                <span>Follow each hand with a look-alike</span>
              </label>
            </>
          }
        />
      </div>

      {/* #26: the rules this card is graded under, before the answer. A
          flashcard is a fresh two-card hand at the profile's table, unless
          (#27) it was dealt as a fallback: then "No double" / "No surrender". */}
      {/* #53: a With-count card plays at this count. */}
      {card.tc !== undefined && <div className="quiz-tc">TC {formatSigned(card.tc)}</div>}
      <RulesChip labels={rulesChipLabels(flashCtx(card), activeProfile.rules, card)} />

      <div className="dealer-area">
        <PlayingCard card={{ rank: card.up, suit: 's' }} />
      </div>

      <div className="hands-row">
        {/* #31: long-press the hand to mark its cell. */}
        <MarkableHand cellId={card.cellId} handKey={card} settings={settings} onSettingsChange={onSettingsChange}>
          <div className="hand-cards">
            {card.cards.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
          {/* The hand in words, for a screen reader: the same sentence the
              eyes-free prompt speaks ("a pair of eights", not two images). */}
          <span className="u-sr-only">
            {narrateFlashcardPrompt(card.cards, card.up)}
          </span>
        </MarkableHand>
      </div>

      {/* Between the hand and the answer, which is where the eye already is.
          Paused rather than hidden once an answer is in, so the bar does not
          vanish out from under a glance at the correction. */}
      <ShotClockBar
        limitMs={clockSuspended ? 0 : shotClockMs}
        restartKey={runIdRef.current}
        paused={feedback !== null || showChart || clockIdle}
        delayMs={clockGraceRef.current}
      />
      {clockIdle && !clockSuspended && (
        <div className="shot-clock-idle" data-testid="shot-clock-idle">
          Shot clock stopped: nobody answered. Answer to start it again.
        </div>
      )}

      <div className="message-strip">
        {/* The revealed play, while the wheel waits to be told whether it was
            had. On screen as well as spoken so the wheel can be checked at a
            desk -- the operator asked for uses they could verify in
            flashcards, and an audio-only affordance is unverifiable. */}
        {selfCheckOpen && !feedback && (
          <div className="selfcheck-banner" data-testid="flash-selfcheck">
            <strong>{zoneLabel(card.correct)}</strong>
            <span>Wheel: next = I had it &middot; prev = I missed it</span>
          </div>
        )}
        {feedback && (
          <>
            {feedback.correct ? (
              <div className="result-correct">Correct!</div>
            ) : (
              <MistakeCard
                taken={feedback.event.taken}
                expected={feedback.event.expected}
                reason={feedback.event.reason}
                tc={feedback.event.tc}
                hand={feedback.event.hand}
                classification={feedback.event.classification}
                eyesFree={eyesFree}
                onShowTable={() => {
                  // No advance happened on this path, so the card on screen
                  // IS the answered one. Frozen anyway, like the strip.
                  setChartTarget({
                    cards: card.cards,
                    up: card.up,
                    graded: {
                      expected: feedback.event.expected,
                      reason: feedback.event.reason,
                      tc: feedback.event.tc,
                    },
                  });
                  setShowChart(true);
                }}
              />
            )}
            {/* The cell id names the chart row just drilled, and belongs to
                the feedback state rather than to either outcome — it is
                equally worth seeing after a hit or a miss. */}
            <div className="feedback-cell" data-cell-id={card.cellId}>
              {plainCellLabel(card.cellId)}
            </div>
            {/* The schedule for the row just answered. It existed only in
                aggregate -- the picker's "N due", the Stats histogram -- so
                the one place it was invisible was the card you are actually
                answering. Read AFTER grading, so a right answer visibly
                pushes the next review out and a miss visibly collapses it. */}
            {(() => {
              const srCard = srDeckRef.current[card.cellId];
              const sr = formatReviewPlain(srCard, Date.now());
              return sr ? (
                <div className="feedback-sr" data-box={srCard?.box}>
                  {sr}
                </div>
              ) : null;
            })()}
          </>
        )}
        {/* B1: the previous card's result, under the card now being asked. */}
        {!feedback && !selfCheckOpen && !eyesFree && lastResult && (
          <>
            <HandResultStrip result={lastResult} onShowChart={openChartOn} onWrongTap={wrongTapFor(lastResult)} />
            <MissHistoryLine result={lastResult} />
          </>
        )}
      </div>

      {!feedback ? (
        eyesFree ? (
          <ZonePad
            mode="action"
            onAnswer={handleZoneAnswer}
            onRepeat={handleRepeat}
            visible={!settings.audio.dimZones}
            legal={drillLegalActions(card.cards, activeProfile.rules, card.up, card.ctx)}
          />
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              legal: drillLegalActions(card.cards, activeProfile.rules, card.up, card.ctx),
              onAction: handleAction,
              // ?e2e=1 only, as on Play's table: lets a spec answer right.
              ...(isE2eAudioMode() ? { advice: card.correct } : {}) }}
          />
        )
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={() => next()}>
            Next
          </button>
        </div>
      )}
      {showChart && chartTarget && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={chartTarget.cards}
          dealerUp={chartTarget.up}
          graded={chartTarget.graded}
          onClose={closeChart}
        />
      )}
    </div>
  );
}

/** R7: a review's "what and how much is left" line, in place of the deck controls. */
function ReviewStatusLine({ text }: { text: string }) {
  return (
    <div className="review-status" role="status" data-testid="review-status">
      {text}
    </div>
  );
}

/**
 * R7 (#42): the end of a review or session deck -- the dealing stops, says
 * so, and offers the way back. `lastResult` keeps the final answer readable.
 */
function ReviewDone({
  heading,
  line,
  onBack,
  onHome,
  lastResult,
}: {
  heading: string;
  line: string;
  onBack: () => void;
  onHome?: () => void;
  lastResult: DrillHandResult | null;
}) {
  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">{heading}</div>
      </div>
      <div className="review-done" role="status" data-testid="review-done">
        <div className="result-correct">{line}</div>
        {lastResult && <HandResultStrip result={lastResult} />}
        <div className="review-done-actions">
          {onHome && (
            <button type="button" className="u-btn u-btn-primary" onClick={onHome}>
              Back to Home
            </button>
          )}
          <button type="button" className="u-btn" onClick={onBack}>
            Drills
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Deviation Quiz                                                     */
/* ---------------------------------------------------------------- */

function quizFilterArg(quizIndex: DeviationId | 'all'): DeviationId | undefined {
  return quizIndex === 'all' ? undefined : quizIndex;
}

/**
 * Get the active quiz filter, falling back to 'all' if the saved index is
 * inactive in the current ruleset.
 */
function getActiveQuizFilter(quizIndex: DeviationId | 'all', activeProfile: Profile): DeviationId | 'all' {
  if (quizIndex === 'all') return 'all';
  const rules = strategyRulesFor(activeProfile);
  if (!isIndexActive(quizIndex, rules)) {
    return 'all';
  }
  // Wave A (s08): an index this profile's basic chart already plays is not
  // quizzed (drills/deviationQuiz.ts redundantForChart).
  const entry = indexSetFor(rules).find((d) => d.id === quizIndex);
  if (!entry || redundantForChart(entry, rules)) return 'all';
  return quizIndex;
}

function DeviationQuizView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
  reviewIds = null,
  onHome }: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
  /** Wave B2 #38 / R7: the due indexes of an index review, handed over in memory. */
  reviewIds?: string[] | null;
  /** The review's end state offers Home. */
  onHome?: () => void;
}) {
  // Use the active filter (falls back to 'all' if saved index is inactive)
  const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);

  // R3 (docs/BACKLOG.md, spaced-repetition): per-index miss-weight map,
  // loaded once per mount exactly like FlashcardsView's srDeckRef.
  const srDeckRef = useRef<SrDeck>(loadQuizSr());
  // #22: the answered index's card before its review, set at the grade.
  const prevSrRef = useRef<{ key: string; prev: SrCard | undefined } | null>(null);
  // B3: the answered cell's tally before the answer, for "Wrong tap".
  const cellBeforeRef = useRef<CellTally | null>(null);

  // Wave B2 #38 / R7: an index review asks exactly the due indexes, one at a
  // time, with no off-index hands, ignoring the saved Index choice (which it
  // never rewrites). Finite, as the cells' review is: an index leaves once
  // answered right, and the one just answered is not asked straight back.
  const review = useReviewSession(reviewIds);
  const lastIndexRef = useRef<string | null>(null);
  const drawItem = (filter: DeviationId | 'all', distractorPct: number): QuizItem | null => {
    if (review.active) {
      const pool = review.pool(lastIndexRef.current);
      if (pool.length === 0) return null;
      const id = pool[Math.floor(Math.random() * pool.length)] as DeviationId;
      return drawQuizItem(randomSeed(), id, strategyRulesFor(activeProfile), 0, srDeckRef.current, Date.now());
    }
    return drawQuizItem(
      randomSeed(),
      quizFilterArg(filter),
      strategyRulesFor(activeProfile),
      distractorPct,
      srDeckRef.current,
      Date.now(),
    );
  };
  const [item, setItem] = useState<QuizItem>(() => {
    const first = drawItem(activeFilter, settings.drill.quizDistractorPct)!;
    lastIndexRef.current = first.deviationId ?? null;
    return first;
  });
  const [feedback, setFeedback] = useState<{ correct: boolean; event: GradedEvent } | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  // B1: the last answered item, frozen, and the hand the chart opens on.
  const { lastResult, chartTarget, setChartTarget, nextResultId, showResult, clearWrongTap, wrongTapFor } =
    useHandResult();
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 9): a per-session choice, shared across screens for
  // the life of this page load (ui/eyesFreeSession.ts) rather than owned by
  // each drill -- it used to reset on every navigation, which in a car reads
  // as the app having gone silent for no reason.
  const [eyesFree, setEyesFree] = useEyesFreeToggle('deviation-quiz');
  // Voice and the wheel, on the same terms as FlashcardsView -- see its
  // copies of these for why each is per-page-load rather than persisted.
  const [voiceOn, setVoiceOn] = useVoiceToggle('deviation-quiz');
  const pushToTalkOpen = usePushToTalk();
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  // The wheel self-check: the right play is revealed and the two buttons say
  // whether it was had. State for the banner, a REF for the handler, because
  // two presses can land in the same tick and the second would otherwise run
  // against the render before the first.
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const wheelPhaseRef = useRef<'asking' | 'reporting' | 'feedback'>('asking');
  const feedbackRef = useRef<{ correct: boolean; event: GradedEvent } | null>(null);
  // Bumped every time a new item is drawn so a stale auto-advance timer
  // from a previous item can recognize itself as stale and no-op, even
  // though its own effect cleanup already clears it on unmount/early exit.
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  // R1 (docs/BACKLOG.md, decision-latency telemetry): performance.now() at
  // the moment the CURRENT item was drawn -- read in gradeQuizAnswer (the
  // shared grade site) to compute elapsedMs. Written in the exact same place
  // as `runIdRef.current += 1` below (both `next()` and this initial
  // value), so it can never point at a stale, already-answered item.
  // `performance.now()`, never `Date.now()`.
  const promptShownAtRef = useRef(performance.now());
  // Wave A F3: where the answer clock starts -- see FlashcardsView's.
  const answerClockRef = useRef(performance.now());
  // Spoken "Correct." is only wanted once per drill session -- after that,
  // correct answers still chime but skip the spoken text. `useRef(false)`
  // is fresh on every mount, and this view is unmounted/remounted each time
  // it's (re)entered from the picker (see the Drills switch below), so a
  // new session always starts with this false; no extra reset effect needed.
  const spokenCorrectOnceRef = useRef(false);
  // T0-BUG1: measure the control strip so the eyes-free ZonePad overlay can
  // start BELOW it (keeping its Dim-screen/Eyes-free toggles tappable).
  const [controlsRef, padTop] = useControlStripBottom();

  // R1's shot clock -- identical plumbing to FlashcardsView's, deliberately:
  // both drills ask the same question of the same limit, and the shared
  // TIMEOUT_ANSWER means neither can invent its own idea of what a timeout is.
  const shotClockMs = settings.drill.shotClockMs;
  const shotClockTimerRef = useRef<number | null>(null);
  // Wave A: suspension, idle stop and reading grace -- see FlashcardsView.
  const clockSuspended = shotClockSuspended(eyesFree, voiceOn);
  const consecutiveTimeoutsRef = useRef(0);
  const [clockIdle, setClockIdle] = useState(false);
  const clockGraceRef = useRef(0);

  const clearShotClock = () => {
    if (shotClockTimerRef.current !== null) {
      window.clearTimeout(shotClockTimerRef.current);
      shotClockTimerRef.current = null;
    }
  };

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };

  // Clear any pending auto-advance timer on unmount.
  useEffect(() => clearAdvanceTimer, []);

  // Eyes-free requires audio to be enabled; drop it if audio gets disabled
  // (e.g. via Settings) while checked, rather than leaving a checked-but-
  // disabled control.
  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  // Wake lock lifecycle: held for as long as eyes-free is active, released
  // the moment it's turned off (and unconditionally on unmount below).
  useEffect(() => {
    if (eyesFree) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }
  }, [eyesFree]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, []);

  // Speak the scenario every time a new item is drawn, including the very
  // first one. Eyes-free bypasses the verbosity gate entirely (it's the
  // primary output channel in that mode, not decoration); visual mode keeps
  // the existing Phase-A verbosity-'full' behavior unchanged. The two
  // branches are mutually exclusive so nothing double-speaks.
  useEffect(() => {
    // Wave A review: voice counts as eyes-free here as in Flashcards --
    // someone answering out loud is not reading the screen, and a prompt
    // spoken through sayFull had no end to start the answer clock from.
    if (eyesFree || voiceOn) {
      // Wave A F3: the answer clock starts when the question has been said.
      const runId = runIdRef.current;
      speak(narrateQuizPrompt(item.cards, item.up, item.tc), {
        ...speechOptsFrom(settings.audio, { interrupt: true }),
        onEnd: () => {
          if (runIdRef.current !== runId || feedbackRef.current) return;
          answerClockRef.current = performance.now();
          clockGraceRef.current = 0;
        },
      });
    } else {
      audio.sayFull(narrateQuizPrompt(item.cards, item.up, item.tc));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, eyesFree, voiceOn]);

  /**
   * Show a graded answer. The ONE place `feedback` is set to a result, so
   * the wheel's phase ref cannot fall out of step with what is on screen --
   * there are four grade sites (button, zone, shot clock, self-report) and a
   * missed one would leave the wheel still offering "I had it" over a
   * correction. Mirrors FlashcardsView's.
   */
  const showFeedback = (result: { correct: boolean; event: GradedEvent }) => {
    wheelPhaseRef.current = 'feedback';
    feedbackRef.current = result;
    setSelfCheckOpen(false);
    setFeedback(result);
  };

  const next = (filter: DeviationId | 'all' = activeFilter, distractorPct: number = settings.drill.quizDistractorPct) => {
    runIdRef.current += 1;
    wheelPhaseRef.current = 'asking';
    feedbackRef.current = null;
    setSelfCheckOpen(false);
    clearAdvanceTimer();
    // Advancing invalidates the correction the chart was opened for, so the
    // overlay must not survive it: left open it re-pointed at the NEW card
    // (its cards/dealerUp are live props), and the learner closed it onto a
    // hand they had never been asked about.
    setShowChart(false);
    const drawn = drawItem(filter, distractorPct);
    // R7: an empty review is a finished one.
    if (!drawn) {
      finishReview();
      return;
    }
    lastIndexRef.current = drawn.deviationId ?? null;
    setItem(drawn);
    setFeedback(null);
    promptShownAtRef.current = performance.now();
    answerClockRef.current = promptShownAtRef.current;
    clockGraceRef.current = 0;
  };

  // R7: the end of an index review, said out loud as well.
  const finishReview = () => {
    clearAdvanceTimer();
    clearShotClock();
    review.finish();
    if (eyesFree || voiceOn) speak('Review done.', speechOptsFrom(settings.audio, { interrupt: false }));
  };

  const changeIndex = (quizIndex: DeviationId | 'all') => {
    const nextSettings: Settings = { ...settings, drill: { ...settings.drill, quizIndex } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
    next(quizIndex);
  };

  // "Mix in fakes" (operator request): 0/25/50% chance a drawn item is a
  // distractor (see drills/deviationQuiz.ts). Redraws immediately so the
  // new rate takes effect on the very next item, matching changeIndex.
  const changeDistractorPct = (quizDistractorPct: number) => {
    const nextSettings: Settings = { ...settings, drill: { ...settings.drill, quizDistractorPct } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
    next(activeFilter, quizDistractorPct);
  };

  const handleBack = () => {
    // Stop mid-utterance speech on the way out, matching CountDrillView.
    // Without it, a correction being spoken carried on over the drill picker.
    cancelSpeech();
    clearAdvanceTimer();
    clearShotClock();
    void releaseWakeLock();
    onBack();
  };

  const handleRepeat = () => {
    speak(narrateQuizPrompt(item.cards, item.up, item.tc), speechOptsFrom(settings.audio, { interrupt: true }));
  };

  // `spokenMs` is how long the correction will occupy the speaker. The next
  // prompt speaks with `interrupt: true`, so advancing on the configured
  // pause alone cut the explanation off mid-sentence -- see answerPause.ts.
  const scheduleAutoAdvance = (spokenMs = 0) => {
    clearAdvanceTimer();
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenMs));
  };

  // Shared grading core (R4): the SAME gradeQuiz function backs the visual
  // buttons (ActionBar / Take-Decline), the eyes-free ZonePad taps, AND the
  // mixed-session view. R1 latency is captured here; R3 index weights
  // (real items only) + the Stats write happen inside gradeQuiz. No audio,
  // no setState -- callers layer their own feedback on top.
  const gradeQuizAnswer = (taken: string, channel: AnswerChannel = SCREEN_CHANNEL): GradedEvent => {
    // Wave A review: reading a miss's correction is not answer time.
    const elapsedMs = answerElapsedMs(performance.now() - answerClockRef.current, clockGraceRef.current);
    if (taken !== TIMEOUT_ANSWER) {
      // Somebody is there: an answer restarts a clock stopped for idleness.
      consecutiveTimeoutsRef.current = 0;
      setClockIdle(false);
    }
    // #22: the index's schedule before this answer, for "Wrong tap". A
    // distractor has no index and nothing scheduled to put back.
    const srKey = item.deviationId;
    prevSrRef.current = srKey ? { key: srKey, prev: srDeckRef.current[srKey] } : null;
    clearWrongTap();
    const result = gradeQuiz(
      item,
      taken,
      strategyRulesFor(activeProfile),
      elapsedMs,
      srDeckRef.current,
      Date.now(),
      channel,
      answeredUnderShotClock(shotClockMs, clockSuspended, clockIdle), // V5-2: see the flashcard grader above.
    );
    srDeckRef.current = result.nextDeck;
    cellBeforeRef.current = result.cellBefore;
    // R7: a right answer takes the index out of a review.
    review.answered(item.deviationId, result.event.correct);
    return result.event;
  };

  // Gates the SPOKEN "Correct." text (never the chime, never wrong-answer
  // speech, never the visible badge) to once per drill session: the first
  // correct answer speaks in full and flips the ref; every correct answer
  // after that skips `doSpeak` entirely so only the chime plays. Shared by
  // both handlers below so the visual and eyes-free paths can't drift.
  // Returns how long it will be talking, so the caller can hold the answer on
  // screen until it has finished. A gated-out "Correct." returns 0 and the
  // configured pause is used unchanged.
  const speakCorrectionOnceGated = (
    event: GradedEvent,
    doSpeak: (text: string) => void,
  ): number => {
    if (event.correct && spokenCorrectOnceRef.current) return 0;
    const text = narrateCorrection(event);
    doSpeak(text);
    if (event.correct) spokenCorrectOnceRef.current = true;
    return spokenPauseFor(text, settings.audio.rate);
  };

  /**
   * B1 (#8/#14/#17): freeze the answered item -- its cards, its count, the
   * table it was asked for -- into the result strip. Called by every grade
   * site, the auto-advancing ones too, so the strip always describes the
   * latest answer (review fix a; see FlashcardsView's freezeResult).
   */
  const freezeResult = (event: GradedEvent) => {
    const prevSr = prevSrRef.current;
    showResult(
      // B6: the miss's cost and history (the region rule is a no-op for quiz events).
      withMissDetail(
        snapshotResult(
          nextResultId(),
          event,
          { cards: item.cards, up: item.up, tc: item.tc },
          { label: item.label, note: tableMaskNote(item, strategyRulesFor(activeProfile)) },
        ),
        event,
        cellBeforeRef.current ?? null,
        activeProfile.rules,
      ),
      event,
      () => {
        if (!prevSr) return;
        srDeckRef.current = restoreSrCard(srDeckRef.current, prevSr.key, prevSr.prev);
        saveQuizSr(srDeckRef.current);
      },
      cellBeforeRef.current,
    );
  };

  /** Visual mode: freeze the answer and draw the next item at once. */
  const advanceWithResult = (event: GradedEvent) => {
    freezeResult(event);
    releaseAnswerFocus();
    next();
    // Wave A (s09): a miss leaves a correction to read under the new item.
    clockGraceRef.current = readGraceMs(!event.correct);
  };

  const handleAnswer = (taken: string) => {
    if (review.doneRef.current) return;
    // Review fix (c): the second touch of a bounce lands on the new item.
    if (answerTooSoon(promptShownAtRef.current)) return;
    const event = gradeQuizAnswer(taken);

    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(event.correct ? 'good' : 'bad');

    advanceWithResult(event);
  };

  /**
   * The shot clock ran out. See FlashcardsView's handler for the reasoning --
   * the same one applies here, including insurance items: "take or decline?" is
   * a decision with a deadline at a real table too, and letting it sit
   * unanswered is not a third option.
   */
  const handleShotClockExpiry = () => {
    if (review.doneRef.current) return;
    const elapsedMs = performance.now() - promptShownAtRef.current;
    if (!shotClockExpired(elapsedMs - clockGraceRef.current, shotClockMs)) return;
    // Wave A (s09): the second unanswered item in a row stops the clock.
    if (expiryVerdict(consecutiveTimeoutsRef.current) === 'stop') {
      setClockIdle(true);
      return;
    }
    consecutiveTimeoutsRef.current += 1;

    const event = gradeQuizAnswer(TIMEOUT_ANSWER);
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      eyesFree ? speak(text, speechOptsFrom(settings.audio)) : audio.say(text, { interrupt: true }),
    );
    audio.ding('bad');
    // Visual mode: to the strip, next item at once -- see FlashcardsView.
    if (!eyesFree && !voiceOn) {
      advanceWithResult(event);
      return;
    }
    freezeResult(event);
    showFeedback({ correct: false, event });
    scheduleAutoAdvance(spokenMs);
  };

  // Arm the clock for the item on screen; see FlashcardsView's copy for why
  // each dep is here and why runIdRef is not.
  useEffect(() => {
    clearShotClock();
    if (!shotClockOn(shotClockMs)) return;
    if (feedback || showChart || clockSuspended || clockIdle || review.done) return;
    const runId = runIdRef.current;
    shotClockTimerRef.current = window.setTimeout(() => {
      shotClockTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      handleShotClockExpiry();
    }, shotClockMs + clockGraceRef.current);
    return clearShotClock;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, feedback, showChart, shotClockMs, clockSuspended, clockIdle]);

  // Eyes-free zone tap. Non-insurance items: ZoneId and Action are the
  // identical five-member literal union, so the tapped zone maps straight
  // onto `taken`. Insurance items: ZonePad's 'action'-mode zones ('hit'
  // etc.) never appear here since the pad is rendered in 'insurance' mode
  // for these items -- only 'take'/'decline' can arrive, translated to the
  // 'take-insurance'/'decline-insurance' strings buildQuizEvent expects
  // (matching the existing Take/Decline Insurance buttons exactly).
  const handleZoneAnswer = (
    zone: ZoneId | 'take' | 'decline',
    channel: AnswerChannel = BLIND_TAP_CHANNEL,
  ) => {
    if (review.doneRef.current) return;
    const isInsurance = item.cards === null;
    if (isInsurance !== (zone === 'take' || zone === 'decline')) return; // mode/zone mismatch guard
    // Review fix (c): a bounce on the pad, not an answer to this item.
    if (answerTooSoon(promptShownAtRef.current)) return;

    const taken = zone === 'take' ? 'take-insurance' : zone === 'decline' ? 'decline-insurance' : zone;

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    // The QUIZ gate, not the table gate: see drills/answerGate.ts. The
    // ActionBar has disabled out-of-question actions since RV3, and this
    // path -- the blind one -- was still grading them.
    const gate = gateQuizAnswer(taken, item, strategyRulesFor(activeProfile));
    if (!gate.accepted) {
      speak(gate.announcement!, speechOptsFrom(settings.audio, { interrupt: true }));
      return;
    }

    speak(narrateAnswerEcho(zoneLabel(zone)), speechOptsFrom(settings.audio, { interrupt: true }));

    // BLIND_TAP by default -- eyes off the screen, hand on the glass -- and
    // VOICE when the answer was spoken, which is a harder channel and caps
    // the SR promotion differently (drills/spacedRepetition.ts).
    const event = gradeQuizAnswer(taken, channel);

    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(event.correct ? 'good' : 'bad');

    freezeResult(event);
    showFeedback({ correct: event.correct, event });
    scheduleAutoAdvance(spokenMs);
  };

  /**
   * A spoken answer, routed through the zone path for the reasons
   * FlashcardsView gives: the refusal has to be audible, the answer has to be
   * echoed, and the two must not be able to drift apart.
   *
   * Insurance items are the one place "yes" and "no" mean something here --
   * the question really is a yes/no -- so they are taken rather than ignored.
   */
  const handleVoiceAction = (action: VoiceAction) => {
    if (review.doneRef.current) return;
    if (action === 'repeat') {
      handleRepeat();
      return;
    }
    if (showChart) return;
    // Already answered: the auto-advance is running, and a second answer
    // would grade the next item against a word said about this one.
    if (feedback) return;

    const isInsurance = item.cards === null;
    if (action === 'yes' || action === 'no') {
      if (!isInsurance) return;
      handleZoneAnswer(action === 'yes' ? 'take' : 'decline', VOICE_CHANNEL);
      voice.cycleIfStale();
      return;
    }
    if (isInsurance) return; // a play named at an insurance prompt is not an answer
    handleZoneAnswer(action, VOICE_CHANNEL);
    // The recogniser dies on its own roughly every ninety seconds; the pause
    // while the answer is read back is the one moment nobody is talking.
    voice.cycleIfStale();
  };

  /** What the self-check says the answer was. */
  const answerLabel = (): string =>
    item.correct === 'take-insurance'
      ? zoneLabel('take')
      : item.correct === 'decline-insurance'
        ? zoneLabel('decline')
        : zoneLabel(item.correct as ZoneId);

  /**
   * The wheel's self-check, the same shape FlashcardsView runs: a quiz answer
   * is a five-way choice and the wheel has two buttons, so it cannot state a
   * play -- but "did you have it" is binary. `SELF_REPORT_HAD/MISSED` carry it
   * through the shared grade path, which learned to grade them for this.
   */
  const revealForSelfCheck = () => {
    wheelPhaseRef.current = 'reporting';
    setSelfCheckOpen(true);
    speak(
      `${narrateAnswerEcho(answerLabel())} ${DID_YOU_HAVE_IT}`,
      speechOptsFrom(settings.audio, { interrupt: true }),
    );
  };

  const submitSelfReport = (had: boolean) => {
    // SCREEN_CHANNEL, not the channel the press physically was: the app
    // checked nothing, so grading a self-report on its delivery would earn
    // the highest SR cap for the weakest evidence. See FlashcardsView.
    const event = gradeQuizAnswer(had ? SELF_REPORT_HAD : SELF_REPORT_MISSED, SCREEN_CHANNEL);
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(event.correct ? 'good' : 'bad');
    freezeResult(event);
    showFeedback({ correct: event.correct, event });
    scheduleAutoAdvance(spokenMs);
  };

  useWheelCommand((command) => {
    // Push-to-talk borrows both buttons; back still repeats. See
    // ui/voiceSession.ts.
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('deviation-quiz');
        audio.ding('attention');
      } else {
        handleRepeat();
      }
      return;
    }
    // The chart overlay is modal over a frozen correction, as for every
    // other input.
    if (showChart) return;
    if (review.doneRef.current) return;

    if (wheelPhaseRef.current === 'reporting') {
      submitSelfReport(command === 'forward');
      return;
    }
    if (wheelPhaseRef.current === 'feedback') {
      if (command === 'forward') {
        next();
      } else if (feedbackRef.current) {
        speak(
          narrateCorrection(feedbackRef.current.event),
          speechOptsFrom(settings.audio, { interrupt: true }),
        );
      }
      return;
    }
    if (command === 'forward') revealForSelfCheck();
    else handleRepeat();
  });

  const voice = useVoiceControl({
    enabled: voiceOn || pushToTalkOpen,
    onAction: handleVoiceAction,
    onNotUnderstood: () => audio.ding('again'),
    escalation: {
      promptKey: item,
      reask: handleRepeat,
      hint: () =>
        speak(
          item.cards === null
            ? INSURANCE_HINT
            : playHint(quizLegalActions(item, strategyRulesFor(activeProfile))),
          speechOptsFrom(settings.audio, { interrupt: true }),
        ),
    },
    biasPhrases: Object.keys(VOICE_ACTIONS),
    onListening: () => audio.dingWhenQuiet('ready'),
    context: 'deviation-quiz',
  });

  const maskNote = tableMaskNote(item, strategyRulesFor(activeProfile));

  // Desktop keyboard input (operator request): while an answer is awaited,
  // number keys feed the SAME handler a tap would use -- handleAnswer in
  // visual mode, handleZoneAnswer in eyes-free mode -- so grading/stats/
  // audio can't drift from a real tap. Action items use the same 1-5
  // hit/stand/double/split/surrender mapping as FlashcardsView; insurance
  // items (item.cards === null) use 1=Take/2=Decline instead, matching the
  // visual Take/Decline Insurance buttons and the ZonePad's insurance
  // variant. Enter/Space advance once feedback (the "Next" state) is
  // showing. Skipped whenever a native input/select/textarea has focus, so
  // the Index <select> and toggles above are unaffected.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      // The chart overlay is modal over a frozen correction. Without this,
      // Enter (the obvious "dismiss" key) ran next() BEHIND the overlay --
      // drawing a new card, clearing the correction, and in eyes-free even
      // narrating it -- while the chart stayed up.
      if (showChart) return;
      if (review.doneRef.current) return;

      if (!feedback) {
        const isInsurance = item.cards === null;
        if (isInsurance) {
          if (e.key === '1') {
            e.preventDefault();
            if (eyesFree) handleZoneAnswer('take');
            else handleAnswer('take-insurance');
          } else if (e.key === '2') {
            e.preventDefault();
            if (eyesFree) handleZoneAnswer('decline');
            else handleAnswer('decline-insurance');
          }
          return;
        }

        const action = KEY_TO_ACTION[e.key];
        if (!action) return;
        e.preventDefault();
        // Same legality gate as the ActionBar buttons -- see FlashcardsView.
        if (eyesFree) {
          handleZoneAnswer(action);
        } else if (gateQuizAnswer(action, item, strategyRulesFor(activeProfile)).accepted) {
          handleAnswer(action);
        }
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, eyesFree, item, showChart]);

  // Wave A (s08): indexes the profile's basic chart already plays show as
  // inactive -- the quiz never asks them.
  const indexList = indexSetFor(strategyRulesFor(activeProfile)).map((d) =>
    redundantForChart(d, strategyRulesFor(activeProfile)) ? { ...d, active: false } : d,
  );

  const openChartOn = (result: HandResult) => {
    setChartTarget(chartTargetFrom(result));
    setShowChart(true);
  };

  // See FlashcardsView: the item behind the chart restarts its clock.
  const closeChart = () => {
    setShowChart(false);
    if (!feedbackRef.current) {
      runIdRef.current += 1;
      promptShownAtRef.current = performance.now();
      answerClockRef.current = promptShownAtRef.current;
      clockGraceRef.current = 0;
    }
  };

  if (review.done) {
    return (
      <ReviewDone
        heading={reviewHeading('review', review.total)}
        line={reviewDoneLine('review', review.total, 'index')}
        onBack={handleBack}
        onHome={onHome}
        lastResult={lastResult}
      />
    );
  }

  return (
    <div className="drill-screen" style={drillScreenStyle(padTop)} data-correct={isE2eAudioMode() ? item.correct : undefined}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">{review.active ? reviewHeading('review', review.total) : 'Deviation quiz'}</div>
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
        {/* R7 (#38, #40): a review asks its own indexes; the saved Ask/Index
            choices would describe something else, and changing them would
            rewrite the saved settings. */}
        {review.active ? (
          <ReviewStatusLine text={reviewStatus('review', review.total, review.left, 'index')} />
        ) : (
        <>
        <QuizAskSwitch settings={settings} onSettingsChange={onSettingsChange} />
        <label className="settings-row">
          <span className="settings-label">Index</span>
          <select
            className="quiz-index-select"
            value={activeFilter}
            onChange={(e) => {
              changeIndex(e.target.value as DeviationId | 'all');
              // A <select> keeps focus after a choice, and it legitimately
              // swallows every key (typing jumps between options), so leaving
              // it focused killed keyboard drilling until the user clicked
              // elsewhere -- the same dead-keyboard symptom as the checkbox
              // bug, by a different route. Hand the keyboard back.
              blurAfterChange(e.target);
            }}
          >
            <option value="all">All indices</option>
            {indexList.map((d) => (
              <option key={d.id} value={d.id} disabled={!d.active}>
                {indexPickerText(d)}
                {!d.active ? ' (inactive for this profile)' : ''}
              </option>
            ))}
          </select>
        </label>
        </>
        )}

        <DrillModeControls
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onEyesFreeChange={(on) => {
            // A pending auto-advance is an eyes-free affordance; leaving
            // eyes-free must cancel it, or the correction vanishes and a new
            // card appears on its own in visual mode.
            if (!on) clearAdvanceTimer();
            setEyesFree(on);
          }}
          voiceSupported={voiceSupported}
          voiceOn={voiceOn}
          onVoiceChange={setVoiceOn}
          voiceStatus={voice.status}
          options={review.active ? undefined :
            <div className="settings-row">
              <span className="settings-label">Off-index hands</span>
              <Segmented
                options={[
                  { value: '0', label: '0%' },
                  { value: '25', label: '25%' },
                  { value: '50', label: '50%' },
                ]}
                value={String(settings.drill.quizDistractorPct) as '0' | '25' | '50'}
                onChange={(v) => changeDistractorPct(Number(v))}
              />
            </div>
          }
        />
      </div>

      <div className="quiz-tc">TC {formatSigned(item.tc)}</div>
      {/* #26: the item's OWN context -- most indices are asked with
          surrender off, even at a table that offers it. */}
      <RulesChip labels={quizRulesChip(item, strategyRulesFor(activeProfile))} />

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

      {/* Below the hand (or the insurance prompt) and above the answer, the
          same place FlashcardsView puts it. */}
      <ShotClockBar
        limitMs={clockSuspended ? 0 : shotClockMs}
        restartKey={runIdRef.current}
        paused={feedback !== null || showChart || clockIdle}
        delayMs={clockGraceRef.current}
      />
      {clockIdle && !clockSuspended && (
        <div className="shot-clock-idle" data-testid="shot-clock-idle">
          Shot clock stopped: nobody answered. Answer to start it again.
        </div>
      )}

      <div className="message-strip">
        {/* The revealed answer, while the wheel waits to be told whether it
            was had. On screen as well as spoken, so the wheel can be checked
            at a desk. */}
        {selfCheckOpen && !feedback && (
          <div className="selfcheck-banner" data-testid="quiz-selfcheck">
            <strong>{answerLabel()}</strong>
            <span>Wheel: next = I had it &middot; prev = I missed it</span>
          </div>
        )}
        {feedback && (
          <>
            {feedback.correct ? (
              <div className="result-correct">Correct!</div>
            ) : (
              <MistakeCard
                taken={feedback.event.taken}
                expected={feedback.event.expected}
                reason={feedback.event.reason}
                tc={feedback.event.tc}
                hand={feedback.event.hand}
                classification={feedback.event.classification}
                eyesFree={eyesFree}
                onShowTable={
                  item.cards
                    ? () => {
                        setChartTarget({
                          cards: item.cards,
                          up: item.up,
                          graded: {
                            expected: feedback.event.expected,
                            reason: feedback.event.reason,
                            tc: feedback.event.tc,
                          },
                        });
                        setShowChart(true);
                      }
                    : undefined
                }
              />
            )}
            <div className="quiz-label">{item.label}</div>
            {/* Which table the question was asked for. Screen only -- see
                tableMaskNote: it is a fact about the cell, not about the
                answer, and the correction is already the longest thing the
                car has to listen to. */}
            {maskNote && <div className="quiz-table-note">{maskNote}</div>}
          </>
        )}
        {/* B1: the previous item's result, under the item now being asked.
            An insurance question has no chart cell to open. */}
        {!feedback && !selfCheckOpen && !eyesFree && lastResult && (
          <>
            <HandResultStrip
              result={lastResult}
              onShowChart={lastResult.cards ? openChartOn : undefined}
              onWrongTap={wrongTapFor(lastResult)}
            />
            <MissHistoryLine result={lastResult} />
          </>
        )}
      </div>

      {!feedback ? (
        eyesFree ? (
          <ZonePad
            mode={item.cards === null ? 'insurance' : 'action'}
            onAnswer={handleZoneAnswer}
            onRepeat={handleRepeat}
            visible={!settings.audio.dimZones}
            legal={quizLegalActions(item, strategyRulesFor(activeProfile))}
          />
        ) : item.cards === null ? (
          <div className="action-bar">
            <button type="button" className="action-btn" onClick={() => handleAnswer('take-insurance')}>
              Take insurance
            </button>
            <button type="button" className="action-btn" onClick={() => handleAnswer('decline-insurance')}>
              Decline insurance
            </button>
          </div>
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              legal: quizLegalActions(item, strategyRulesFor(activeProfile)),
              onAction: handleAnswer }}
          />
        )
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={() => next()}>
            Next
          </button>
        </div>
      )}
      {showChart && chartTarget && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={chartTarget.cards}
          dealerUp={chartTarget.up}
          graded={chartTarget.graded}
          onClose={closeChart}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Mixed session (R4, docs/BACKLOG.md, interleaved / mixed-session)   */
/* Blends flashcard items (pure basic strategy, NO count) with        */
/* deviation-quiz items (count-dependent) in one session so the       */
/* learner keeps switching between "the count doesn't matter" and     */
/* "the count matters" -- the near-miss discrimination the            */
/* interleaving meta-analysis says beats blocked practice. Each item  */
/* is a seeded coin flip (pickMixedType), NOT a rigid A-B-A. Every    */
/* item grades through the EXACT shared path (gradeFlashcard/         */
/* gradeQuiz) the standalone views use -- see src/drills/gradeAnswer. */
/* ---------------------------------------------------------------- */

type MixedCurrent = { type: 'flash'; card: Flashcard } | { type: 'quiz'; item: QuizItem };

function MixedSessionView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange }: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  // R3 weight maps -- one per drill, held exactly as the standalone views do
  // so a mixed session's misses/decays feed the same persisted weighting.
  const flashSrRef = useRef<SrDeck>(loadFlashSr());
  const quizSrRef = useRef<SrDeck>(loadQuizSr());
  // #22: the answered item's card before its review, set at the grade.
  const prevSrRef = useRef<{ deck: 'flash' | 'quiz'; key: string; prev: SrCard | undefined } | null>(null);
  // B3: the answered cell's tally before the answer, for "Wrong tap".
  const cellBeforeRef = useRef<CellTally | null>(null);

  // Seeded interleave: the session seed is drawn once (lazily, StrictMode-
  // safe) and each position's type comes from pickMixedType(seed, index) --
  // pure, so a re-render can never desync it. itemIndexRef tracks position.
  const sessionSeedRef = useRef<number | null>(null);
  const sessionSeed = () => {
    if (sessionSeedRef.current === null) sessionSeedRef.current = randomSeed();
    return sessionSeedRef.current;
  };
  const itemIndexRef = useRef(0);
  const mixedLastCellRef = useRef<string | null>(null);
  const [eyesFree, setEyesFree] = useEyesFreeToggle('mixed-session');

  // V5-1: same confusable-neighbour bias as the flashcards drill. The chain is
  // over FLASHCARDS only -- a quiz item in between does not reset it, since the
  // confusion being trained is between chart cells, not between drill types.
  // B2: from the deck the settings describe; null when it is empty.
  const drawMixedFlash = (drill: Settings['drill'] = settings.drill): Flashcard | null => {
    const deck = handDeckFor(drill, activeProfile);
    if (deck.ids.length === 0) return null;
    const drawn = drawFlashcard(
      deck.scopes,
      flashSrRef.current,
      Date.now(),
      randomSeed(),
      activeProfile.rules,
      drill.flashByConfusability,
      mixedLastCellRef.current,
      deck.weights,
      // #27: fallbacks only -- a Mixed flashcard is the no-count half.
      { fallbacks: flashOptionsFor(drill, eyesFree).fallbacks },
    );
    mixedLastCellRef.current = drawn.cellId;
    return drawn;
  };

  const drawFor = (type: MixedItemType): MixedCurrent => {
    // An empty basic-strategy deck deals the index item instead; the gate
    // replaces the screen on the same render anyway.
    const card = type === 'flash' ? drawMixedFlash() : null;
    if (card) return { type: 'flash', card };
    const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);
    return {
      type: 'quiz',
      item: drawQuizItem(
        randomSeed(),
        quizFilterArg(activeFilter),
        // THE SAME RULES THE FILTER WAS VALIDATED AGAINST, two lines up.
        // `getActiveQuizFilter` uses `strategyRulesFor`, so with surrender
        // indices on it accepts `sur15v10` -- and passing the bare rules
        // here handed that id to a draw whose index set does not contain
        // it. `drawQuizItem` throws on an unknown id, and this call is a
        // `useState` initialiser, so the throw took the whole screen.
        strategyRulesFor(activeProfile),
        settings.drill.quizDistractorPct,
        quizSrRef.current,
        Date.now(),
      ) };
  };

  const [current, setCurrent] = useState<MixedCurrent>(() => drawFor(pickMixedType(sessionSeed(), 0)));
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction?: Action; event: GradedEvent } | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  // B1: the last answered item, frozen, and the hand the chart opens on.
  const { lastResult, chartTarget, setChartTarget, nextResultId, showResult, clearWrongTap, wrongTapFor } =
    useHandResult();
  const audio = useAudio(settings.audio);

  // Voice and the wheel, on the same terms as the two standalone views. A
  // mixed session is the one an operator runs in the car for twenty minutes,
  // and it had neither.
  const [voiceOn, setVoiceOn] = useVoiceToggle('mixed-session');
  const pushToTalkOpen = usePushToTalk();
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const wheelPhaseRef = useRef<'asking' | 'reporting' | 'feedback'>('asking');
  const feedbackRef = useRef<{
    correct: boolean;
    correctAction?: Action;
    event: GradedEvent;
  } | null>(null);
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const promptShownAtRef = useRef(performance.now());
  // Wave A F3: where the answer clock starts -- see FlashcardsView's.
  const answerClockRef = useRef(performance.now());
  const spokenCorrectOnceRef = useRef(false);
  const [controlsRef, padTop] = useControlStripBottom();

  const isInsuranceItem = current.type === 'quiz' && current.item.cards === null;

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };

  useEffect(() => clearAdvanceTimer, []);

  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  useEffect(() => {
    if (eyesFree) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }
  }, [eyesFree]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, []);

  const promptFor = (c: MixedCurrent): string =>
    c.type === 'flash'
      ? narrateFlashcardPrompt(c.card.cards, c.card.up)
      : narrateQuizPrompt(c.item.cards, c.item.up, c.item.tc);

  // Narrate each new item. Eyes-free speaks every item (its primary output
  // channel); visual mode mirrors each drill's standalone behavior -- the
  // quiz's verbosity-gated sayFull, and the flashcard's silence -- reusing
  // the same prompt builders (the quiz prompt includes the spoken TC, the
  // flashcard prompt never does, making the discrimination audible too).
  useEffect(() => {
    // Wave A review: voice is spoken to like eyes-free (see the quiz view).
    if (eyesFree || voiceOn) {
      // Wave A F3: the answer clock starts when the question has been said.
      const runId = runIdRef.current;
      speak(promptFor(current), {
        ...speechOptsFrom(settings.audio, { interrupt: true }),
        onEnd: () => {
          if (runIdRef.current === runId && !feedbackRef.current) answerClockRef.current = performance.now();
        },
      });
    } else if (current.type === 'quiz') {
      audio.sayFull(narrateQuizPrompt(current.item.cards, current.item.up, current.item.tc));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, eyesFree, voiceOn]);

  /** The ONE place `feedback` is set to a result -- see FlashcardsView. */
  const showFeedback = (result: {
    correct: boolean;
    correctAction?: Action;
    event: GradedEvent;
  }) => {
    wheelPhaseRef.current = 'feedback';
    feedbackRef.current = result;
    setSelfCheckOpen(false);
    setFeedback(result);
  };

  const next = () => {
    runIdRef.current += 1;
    wheelPhaseRef.current = 'asking';
    feedbackRef.current = null;
    setSelfCheckOpen(false);
    clearAdvanceTimer();
    // Advancing invalidates the correction the chart was opened for, so the
    // overlay must not survive it: left open it re-pointed at the NEW card
    // (its cards/dealerUp are live props), and the learner closed it onto a
    // hand they had never been asked about.
    setShowChart(false);
    const idx = itemIndexRef.current + 1;
    itemIndexRef.current = idx;
    setCurrent(drawFor(pickMixedType(sessionSeed(), idx)));
    setFeedback(null);
    promptShownAtRef.current = performance.now();
    answerClockRef.current = promptShownAtRef.current;
  };

  // #13: a basic-strategy hand still waiting for its answer is re-dealt
  // from the new scope, as in Flashcards; a quiz item, or an answered hand,
  // is left alone and the next draw follows the new scope.
  const changeScopes = (nextSettings: Settings) => {
    onSettingsChange(nextSettings);
    if (current.type === 'flash' && !feedbackRef.current) {
      const card = drawMixedFlash(nextSettings.drill);
      if (!card) return; // empty deck: HandDeckGate takes the screen
      setCurrent({ type: 'flash', card });
      promptShownAtRef.current = performance.now();
      answerClockRef.current = promptShownAtRef.current;
    }
  };

  const handleBack = () => {
    // Stop mid-utterance speech on the way out, matching CountDrillView.
    // Without it, a correction being spoken carried on over the drill picker.
    cancelSpeech();
    clearAdvanceTimer();
    void releaseWakeLock();
    onBack();
  };

  const handleRepeat = () => {
    speak(promptFor(current), speechOptsFrom(settings.audio, { interrupt: true }));
  };

  // `spokenMs` is how long the correction will occupy the speaker. The next
  // prompt speaks with `interrupt: true`, so advancing on the configured
  // pause alone cut the explanation off mid-sentence -- see answerPause.ts.
  const scheduleAutoAdvance = (spokenMs = 0) => {
    clearAdvanceTimer();
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenMs));
  };

  // THE shared grade path (R4): dispatch to gradeFlashcard or gradeQuiz by the
  // current item's type -- byte-identical to what the standalone views call.
  // R1 latency captured here; R3 weights + Stats write happen inside.
  const gradeCurrent = (taken: string): { correct: boolean; correctAction?: Action; event: GradedEvent } => {
    const elapsedMs = performance.now() - answerClockRef.current;
    clearWrongTap();
    if (current.type === 'flash') {
      // #22: the card's schedule before this answer, for "Wrong tap".
      const key = current.card.cellId;
      prevSrRef.current = { deck: 'flash', key, prev: flashSrRef.current[key] };
      const result = gradeFlashcard(current.card, taken as Action, activeProfile.rules, elapsedMs, flashSrRef.current, Date.now());
      flashSrRef.current = result.nextDeck;
      cellBeforeRef.current = result.cellBefore;
      return { correct: result.event.correct, correctAction: result.correctAction, event: result.event };
    }
    const quizKey = current.item.deviationId;
    prevSrRef.current = quizKey ? { deck: 'quiz', key: quizKey, prev: quizSrRef.current[quizKey] } : null;
    // ...AND GRADED AGAINST THEM TOO. The standalone quiz grades with
    // `strategyRulesFor`; grading a surrender index with the bare rules
    // marks a correct surrender wrong.
    const result = gradeQuiz(current.item, taken, strategyRulesFor(activeProfile), elapsedMs, quizSrRef.current, Date.now());
    quizSrRef.current = result.nextDeck;
    cellBeforeRef.current = result.cellBefore;
    return { correct: result.event.correct, event: result.event };
  };

  // Returns how long it will be talking, so the caller can hold the answer on
  // screen until it has finished. A gated-out "Correct." returns 0 and the
  // configured pause is used unchanged.
  const speakCorrectionOnceGated = (
    event: GradedEvent,
    doSpeak: (text: string) => void,
  ): number => {
    if (event.correct && spokenCorrectOnceRef.current) return 0;
    const text = narrateCorrection(event);
    doSpeak(text);
    if (event.correct) spokenCorrectOnceRef.current = true;
    return spokenPauseFor(text, settings.audio.rate);
  };

  /**
   * B1 (#8/#14/#17): freeze the answered item into the result strip. A quiz
   * item keeps its count and index label; a flashcard has neither, exactly as
   * it was asked. Called by every grade site, the auto-advancing ones too
   * (review fix a; see FlashcardsView's freezeResult).
   */
  const freezeResult = (event: GradedEvent) => {
    const snapshot =
      current.type === 'flash'
        ? snapshotResult(
            nextResultId(),
            event,
            { cards: current.card.cards, up: current.card.up, tc: null },
            { cellId: current.card.cellId },
          )
        : snapshotResult(
            nextResultId(),
            event,
            { cards: current.item.cards, up: current.item.up, tc: current.item.tc },
            {
              label: current.item.label,
              note: tableMaskNote(current.item, strategyRulesFor(activeProfile)),
            },
          );
    const prevSr = prevSrRef.current;
    showResult(withMissDetail(snapshot, event, cellBeforeRef.current ?? null, activeProfile.rules), event, () => {
      if (!prevSr) return;
      if (prevSr.deck === 'flash') {
        flashSrRef.current = restoreSrCard(flashSrRef.current, prevSr.key, prevSr.prev);
        saveFlashSr(flashSrRef.current);
      } else {
        quizSrRef.current = restoreSrCard(quizSrRef.current, prevSr.key, prevSr.prev);
        saveQuizSr(quizSrRef.current);
      }
    }, cellBeforeRef.current);
  };

  /** Visual mode: freeze the answer and draw the next item at once. */
  const advanceWithResult = (event: GradedEvent) => {
    freezeResult(event);
    releaseAnswerFocus();
    next();
  };

  const handleAnswer = (taken: string) => {
    // Review fix (c): the second touch of a bounce lands on the new item.
    if (answerTooSoon(promptShownAtRef.current)) return;
    const { correct, event } = gradeCurrent(taken);
    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(correct ? 'good' : 'bad');
    advanceWithResult(event);
  };

  const handleZoneAnswer = (zone: ZoneId | 'take' | 'decline') => {
    // Insurance items expose only take/decline zones; every other item the
    // five action zones. Reject a mode/zone mismatch, exactly as the
    // standalone quiz view does.
    if (isInsuranceItem !== (zone === 'take' || zone === 'decline')) return;
    // Review fix (c): a bounce on the pad, not an answer to this item.
    if (answerTooSoon(promptShownAtRef.current)) return;
    const taken = zone === 'take' ? 'take-insurance' : zone === 'decline' ? 'decline-insurance' : zone;

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    const gate = gateCurrent(taken);
    if (!gate.accepted) {
      speak(gate.announcement!, speechOptsFrom(settings.audio, { interrupt: true }));
      return;
    }

    speak(narrateAnswerEcho(zoneLabel(zone)), speechOptsFrom(settings.audio, { interrupt: true }));

    const { correct, correctAction, event } = gradeCurrent(taken);
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(correct ? 'good' : 'bad');
    freezeResult(event);
    showFeedback({ correct, correctAction, event });
    scheduleAutoAdvance(spokenMs);
  };

  /**
   * A spoken answer, through the zone path -- see FlashcardsView for why.
   * "Yes"/"no" mean something only on an insurance item, where the question
   * really is a yes/no.
   */
  const handleVoiceAction = (action: VoiceAction) => {
    if (action === 'repeat') {
      handleRepeat();
      return;
    }
    if (showChart || feedback) return;
    if (action === 'yes' || action === 'no') {
      if (!isInsuranceItem) return;
      handleZoneAnswer(action === 'yes' ? 'take' : 'decline');
      voice.cycleIfStale();
      return;
    }
    if (isInsuranceItem) return;
    handleZoneAnswer(action);
    voice.cycleIfStale();
  };

  /** What the self-check says the answer was, for either kind of item. */
  const answerLabel = (): string => {
    const correct = current.type === 'flash' ? current.card.correct : current.item.correct;
    return correct === 'take-insurance'
      ? zoneLabel('take')
      : correct === 'decline-insurance'
        ? zoneLabel('decline')
        : zoneLabel(correct as ZoneId);
  };

  /**
   * The wheel's self-check. Both item types grade it through their own
   * shared path -- `gradeFlashcard` has taken the two markers since the
   * shape shipped, and `gradeQuiz` learned them for this.
   */
  const revealForSelfCheck = () => {
    wheelPhaseRef.current = 'reporting';
    setSelfCheckOpen(true);
    speak(
      `${narrateAnswerEcho(answerLabel())} ${DID_YOU_HAVE_IT}`,
      speechOptsFrom(settings.audio, { interrupt: true }),
    );
  };

  const submitSelfReport = (had: boolean) => {
    const { correct, correctAction, event } = gradeCurrent(
      had ? SELF_REPORT_HAD : SELF_REPORT_MISSED,
    );
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(correct ? 'good' : 'bad');
    freezeResult(event);
    showFeedback({ correct, correctAction, event });
    scheduleAutoAdvance(spokenMs);
  };

  useWheelCommand((command) => {
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('mixed-session');
        audio.ding('attention');
      } else {
        handleRepeat();
      }
      return;
    }
    if (showChart) return;

    if (wheelPhaseRef.current === 'reporting') {
      submitSelfReport(command === 'forward');
      return;
    }
    if (wheelPhaseRef.current === 'feedback') {
      if (command === 'forward') {
        next();
      } else if (feedbackRef.current) {
        speak(
          narrateCorrection(feedbackRef.current.event),
          speechOptsFrom(settings.audio, { interrupt: true }),
        );
      }
      return;
    }
    if (command === 'forward') revealForSelfCheck();
    else handleRepeat();
  });

  const voice = useVoiceControl({
    enabled: voiceOn || pushToTalkOpen,
    onAction: handleVoiceAction,
    onNotUnderstood: () => audio.ding('again'),
    escalation: {
      promptKey: current,
      reask: handleRepeat,
      hint: () =>
        speak(
          isInsuranceItem
            ? INSURANCE_HINT
            : playHint(
                current.type === 'quiz'
                  ? quizLegalActions(current.item, strategyRulesFor(activeProfile))
                  : drillLegalActions(current.card.cards, activeProfile.rules, current.card.up, current.card.ctx),
              ),
          speechOptsFrom(settings.audio, { interrupt: true }),
        ),
    },
    biasPhrases: Object.keys(VOICE_ACTIONS),
    onListening: () => audio.dingWhenQuiet('ready'),
    context: 'mixed-session',
  });

  // Keyboard: identical mapping to the standalone views -- 1-5 action keys for
  // flashcard + quiz-action items, 1=Take/2=Decline for quiz insurance items,
  // Enter/Space to advance past feedback. Routed to the eyes-free or visual
  // handler so grading/audio can't drift from a real tap.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      // The chart overlay is modal over a frozen correction. Without this,
      // Enter (the obvious "dismiss" key) ran next() BEHIND the overlay --
      // drawing a new card, clearing the correction, and in eyes-free even
      // narrating it -- while the chart stayed up.
      if (showChart) return;

      if (!feedback) {
        if (isInsuranceItem) {
          if (e.key === '1') {
            e.preventDefault();
            if (eyesFree) handleZoneAnswer('take');
            else handleAnswer('take-insurance');
          } else if (e.key === '2') {
            e.preventDefault();
            if (eyesFree) handleZoneAnswer('decline');
            else handleAnswer('decline-insurance');
          }
          return;
        }

        const action = KEY_TO_ACTION[e.key];
        if (!action) return;
        e.preventDefault();
        // Same legality gate as the ActionBar buttons -- see FlashcardsView.
        if (eyesFree) handleZoneAnswer(action);
        else if (gateCurrent(action).accepted) handleAnswer(action);
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, eyesFree, current, showChart]);

  const dealerUp = current.type === 'flash' ? current.card.up : current.item.up;
  const handCards = current.type === 'flash' ? current.card.cards : current.item.cards;

  /**
   * Which gate this item is answered through.
   *
   * A mixed session alternates between the two drills, and they ask
   * different questions of the same five buttons: a flashcard asks what the
   * table allows, a quiz item also asks what the ITEM was drawn under. One
   * gate for both left the quiz half of a mixed session with the bug the
   * standalone quiz no longer has -- and a mixed session is what an operator
   * runs in the car.
   */
  const gateCurrent = (taken: string) =>
    current.type === 'quiz'
      ? gateQuizAnswer(taken, current.item, strategyRulesFor(activeProfile))
      : gateDrillAnswer(taken, handCards, activeProfile.rules, dealerUp, current.card.ctx);

  const openChartOn = (result: HandResult) => {
    setChartTarget(chartTargetFrom(result));
    setShowChart(true);
  };

  // See FlashcardsView: the item behind the chart restarts its clock.
  const closeChart = () => {
    setShowChart(false);
    if (!feedbackRef.current) {
      runIdRef.current += 1;
      promptShownAtRef.current = performance.now();
      answerClockRef.current = promptShownAtRef.current;
    }
  };

  return (
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Mixed</div>
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
        <HandDeckControls settings={settings} onChange={changeScopes} />
        <DrillModeControls
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onEyesFreeChange={(on) => {
            // A pending auto-advance is an eyes-free affordance; leaving
            // eyes-free must cancel it, or the correction vanishes and a new
            // card appears on its own in visual mode.
            if (!on) clearAdvanceTimer();
            setEyesFree(on);
          }}
          voiceSupported={voiceSupported}
          voiceOn={voiceOn}
          onVoiceChange={setVoiceOn}
          voiceStatus={voice.status}
          // #27: set once, folded away like the flashcards' options.
          options={<DealToggles settings={settings} onChange={changeScopes} />}
        />
      </div>

      {/* A quiz item shows its true count; a flashcard item shows none -- the
          visible cue that tells the learner which regime applies. */}
      {current.type === 'quiz' && <div className="quiz-tc">TC {formatSigned(current.item.tc)}</div>}
      {/* #26: the rules this item is graded under, before the answer. */}
      <RulesChip
        labels={
          current.type === 'quiz'
            ? quizRulesChip(current.item, strategyRulesFor(activeProfile))
            : rulesChipLabels(flashCtx(current.card), activeProfile.rules, current.card)
        }
      />

      {handCards !== null ? (
        <>
          <div className="dealer-area">
            <PlayingCard card={{ rank: dealerUp, suit: 's' }} />
          </div>
          <div className="hands-row">
            <div className="player-hand">
              <div className="hand-cards">
                {handCards.map((c, i) => (
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
        {selfCheckOpen && !feedback && (
          <div className="selfcheck-banner" data-testid="mixed-selfcheck">
            <strong>{answerLabel()}</strong>
            <span>Wheel: next = I had it &middot; prev = I missed it</span>
          </div>
        )}
        {feedback && (
          <>
            {feedback.correct ? (
              <div className="result-correct">Correct!</div>
            ) : (
              <MistakeCard
                taken={feedback.event.taken}
                expected={feedback.event.expected}
                reason={feedback.event.reason}
                tc={feedback.event.tc}
                hand={feedback.event.hand}
                classification={feedback.event.classification}
                eyesFree={eyesFree}
                onShowTable={
                  handCards
                    ? () => {
                        setChartTarget({
                          cards: handCards,
                          up: dealerUp,
                          graded: {
                            expected: feedback.event.expected,
                            reason: feedback.event.reason,
                            tc: feedback.event.tc,
                          },
                        });
                        setShowChart(true);
                      }
                    : undefined
                }
              />
            )}
            {current.type === 'flash' ? (
              <div className="feedback-cell">{current.card.cellId}</div>
            ) : (
              <div className="quiz-label">{current.item.label}</div>
            )}
          </>
        )}
        {/* B1: the previous item's result, under the item now being asked. */}
        {!feedback && !selfCheckOpen && !eyesFree && lastResult && (
          <>
            <HandResultStrip
              result={lastResult}
              onShowChart={lastResult.cards ? openChartOn : undefined}
              onWrongTap={wrongTapFor(lastResult)}
            />
            <MissHistoryLine result={lastResult} />
          </>
        )}
      </div>

      {!feedback ? (
        eyesFree ? (
          <ZonePad
            mode={isInsuranceItem ? 'insurance' : 'action'}
            onAnswer={handleZoneAnswer}
            onRepeat={handleRepeat}
            visible={!settings.audio.dimZones}
            legal={
              current.type === 'quiz'
                ? quizLegalActions(current.item, strategyRulesFor(activeProfile))
                : drillLegalActions(handCards ?? [], activeProfile.rules, dealerUp, current.card.ctx)
            }
          />
        ) : isInsuranceItem ? (
          <div className="action-bar">
            <button type="button" className="action-btn" onClick={() => handleAnswer('take-insurance')}>
              Take insurance
            </button>
            <button type="button" className="action-btn" onClick={() => handleAnswer('decline-insurance')}>
              Decline insurance
            </button>
          </div>
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              // `handCards` is non-null on this branch (the insurance case is
              // the branch immediately above), so the hand is always the real
              // two-card hand the legality rules expect.
              //
              // A quiz item answers to the ctx it was drawn under, exactly as
              // in the standalone quiz; a flashcard is an ordinary hand.
              legal:
                current.type === 'quiz'
                  ? quizLegalActions(current.item, strategyRulesFor(activeProfile))
                  : drillLegalActions(handCards ?? [], activeProfile.rules, dealerUp, current.card.ctx),
              onAction: handleAnswer }}
          />
        )
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={() => next()}>
            Next
          </button>
        </div>
      )}
      {showChart && chartTarget && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={chartTarget.cards}
          dealerUp={chartTarget.up}
          graded={chartTarget.graded}
          onClose={closeChart}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Picker                                                             */
/* ---------------------------------------------------------------- */

type DrillMode =
  | 'count'
  | 'truecount'
  | 'deckest'
  | 'flash'
  | 'quiz'
  | 'mixed'
  | 'paircancel'
  | 'betsizing'
  | 'rulesdiff'
  | 'producetc'
  | 'mastery'
  | 'custom'
  | 'speed';

export function Drills({ settings, activeProfile, onNavigate, onSettingsChange }: DrillsProps) {
  // #28: Home's Next step can hand over the drill to open.
  const [launch] = useState(() => takeDrillLaunch());
  const [mode, setMode] = useState<'picker' | DrillMode>(() => launch ?? 'picker');
  // C-R3: Home's Drive tap starts the drill it opens; taken once, on mount.
  const [driveStart] = useState(() => takeDriveAutoStart());
  const autoStartFor = (m: DrillMode) => driveStart && launch === m;
  // C-R3: a drill run eyes-free or by voice becomes Home's Drive button.
  const [eyesFreeAny] = useEyesFreeToggle('drills');
  const [voiceAny] = useVoiceToggle('drills');
  useEffect(() => {
    if (mode === 'picker' || (!eyesFreeAny && !voiceAny)) return;
    const next = recordDrive(settings, mode, voiceAny);
    if (next === settings) return;
    saveSettings(next);
    onSettingsChange(next);
    // Keyed on what is being recorded; `settings` is read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, eyesFreeAny, voiceAny]);
  // R7 / R5: a review or session deck rides along with the launch, in memory.
  // Taken (and so cleared) on every mount; kept only for the drill it was
  // handed to, and dropped once that drill is left.
  const [flashHandOver, setFlashHandOver] = useState(() => {
    const h = takeFlashHandOver();
    return launch === 'flash' && h && h.ids.length > 0 ? h : null;
  });
  const [reviewIndexes, setReviewIndexes] = useState(() => {
    const ids = takeReviewIndexes();
    if (launch !== 'quiz' || !ids) return null;
    // Only indexes the quiz can ask under this profile (drawQuizItem throws on others).
    const askable = new Set(quizIndexSet(strategyRulesFor(activeProfile)).filter((d) => d.active).map((d) => d.id as string));
    const kept = ids.filter((id) => askable.has(id));
    return kept.length > 0 ? kept : null;
  });
  const leaveHandOver = () => {
    setFlashHandOver(null);
    setReviewIndexes(null);
    setMode('picker');
  };
  // Every mode is a new screen: start it at the top, not at the picker's
  // scroll offset (the Custom editor opened mid-grid with its header hidden).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  if (mode === 'count') {
    return (
      <CountDrillView
        settings={settings}
        autoStart={autoStartFor('count')}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'truecount') {
    return (
      <TrueCountDrillView
        settings={settings}
        activeProfile={activeProfile}
        autoStart={autoStartFor('truecount')}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'producetc') {
    return (
      <ProduceTcDrillView
        settings={settings}
        activeProfile={activeProfile}
        autoStart={autoStartFor('producetc')}
        onBack={() => setMode('picker')}
      onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'deckest') {
    return (
      <DeckEstimationView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  // B2: the hand drills mount only on a deck with something in it.
  const gate = (title: string, view: ReactNode) => (
    <HandDeckGate
      title={title}
      settings={settings}
      activeProfile={activeProfile}
      onSettingsChange={onSettingsChange}
      onBack={() => setMode('picker')}
    >
      {view}
    </HandDeckGate>
  );
  if (mode === 'flash' && flashHandOver) {
    // R7 / R5: the handed-over cells, whatever the saved deck holds -- so no
    // empty-deck gate, and no first-run chart intro in front of a review.
    return (
      <FlashcardsView
        settings={settings}
        activeProfile={activeProfile}
        onBack={leaveHandOver}
        onSettingsChange={onSettingsChange}
        handOver={flashHandOver}
        onHome={() => onNavigate('home')}
      />
    );
  }
  if (mode === 'flash') {
    return (
      <FlashEntry
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        flashcards={gate(
          'Flashcards',
          <FlashcardsView
            settings={settings}
            activeProfile={activeProfile}
            onBack={() => setMode('picker')}
            onSettingsChange={onSettingsChange}
          />,
        )}
      />
    );
  }
  if (mode === 'quiz' && reviewIndexes) {
    // Wave B2 #38 / R7: an index review is the Deviation quiz on exactly the
    // due indexes, whatever the saved Ask and Index choices are.
    return (
      <DeviationQuizView
        settings={settings}
        activeProfile={activeProfile}
        onBack={leaveHandOver}
        onSettingsChange={onSettingsChange}
        reviewIds={reviewIndexes}
        onHome={() => onNavigate('home')}
      />
    );
  }
  if (mode === 'quiz') {
    // B3: the quiz asks either the play (as ever) or the index.
    if (settings.drill.quizAsk === 'index') {
      return (
        <IndexTestView
          settings={settings}
          activeProfile={activeProfile}
          onBack={() => setMode('picker')}
          onSettingsChange={onSettingsChange}
        />
      );
    }
    return (
      <DeviationQuizView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'mixed') {
    return gate(
      'Mixed',
      <MixedSessionView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />,
    );
  }
  if (mode === 'mastery') {
    return gate(
      'Mastery challenge',
      <MasteryChallengeView
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onBack={() => setMode('picker')}
      />,
    );
  }
  if (mode === 'speed') {
    return (
      <SpeedDrillView
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onBack={() => setMode('picker')}
      />
    );
  }

  if (mode === 'custom') {
    // #9 / B2: paint a selection, then run a hand drill on it.
    return (
      <CustomDrillEditor
        settings={settings}
        autoOnOpen={launch === 'custom'}
        onSettingsChange={onSettingsChange}
        onStart={(drill) => {
          const next = settingsForCustomStart(settings);
          saveSettings(next);
          onSettingsChange(next);
          setMode(drill === 'flashcards' ? 'flash' : drill);
        }}
        onBack={() => setMode('picker')}
      />
    );
  }
  if (mode === 'paircancel') {
    return <PairCancelView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'betsizing')
    return (
      <BetSizingView
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onBack={() => setMode('picker')}
      />
    );
  if (mode === 'rulesdiff') return <RulesDiffView settings={settings} activeProfile={activeProfile} onBack={() => setMode('picker')} />;

  // V3-4: SOFT competence gating — advanced pressure modes still work, but show
  // a "get fluent first" nudge until the learner has demonstrated basic
  // count-drill competence. Read once here (only the picker branch reaches this).
  const fluent = isCountFluent(loadStats().countDrill.history);

  // One line per drill: what you practise, and why it matters at the table.
  // The name stays the button's accessible name (aria-label) so a screen
  // reader -- and every spec that clicks a drill by name -- hears the drill,
  // with the line attached as its description.
  const entry = (
    target: DrillMode,
    name: string,
    description: string,
    advanced = false,
  ) => {
    const descId = `drill-desc-${target}`;
    const gated = advanced && !fluent;
    return (
      <button
        key={target}
        type="button"
        className={`drills-nav-btn${gated ? ' drills-nav-btn-advanced' : ''}`}
        aria-label={name}
        aria-describedby={descId}
        onClick={() => setMode(target)}
      >
        <span className="drills-nav-name">{name}</span>
        <span className="drills-nav-desc" id={descId}>
          {description}
        </span>
        {gated && <span className="drills-nav-note">Advanced — get fluent at the count drill first</span>}
      </button>
    );
  };

  return (
    <div className="drills-picker">
      <h1 className="drills-title">Drills</h1>
      <TabSettingsButton tab="drills" />
      {/* Grouped by the SKILL each drill trains (C8). Ten identical buttons in
          one list said nothing about what to do next, or about the fact that
          keeping the count, knowing the plays, and holding up under pressure
          are three different abilities you build in roughly that order. */}
      <div className="drills-nav">
        <h2 className="drills-group-title">Keeping the count</h2>
        {entry('count', 'Count drill', 'Keep the running count as cards are dealt. Every bet and play starts from it.')}
        {entry('paircancel', 'Pair cancellation', 'Read two cards as one net value and skip pairs that cancel, to keep up with a fast dealer.')}
        {entry('deckest', 'Deck estimation', 'Judge decks remaining from the discard tray. It is what you divide by.')}
        {entry('truecount', 'True count drill', 'Turn a running count and decks remaining into the true count, which sets your bet.')}
        {entry('producetc', 'Produce the true count', 'Count the cards, read the tray, give the true count: the whole job, as at the table.')}

        <h2 className="drills-group-title">Knowing the plays</h2>
        {entry('flash', 'Flashcards', 'Basic strategy, one hand at a time. It decides most of your hands.')}
        {entry('quiz', 'Deviation quiz', 'Index plays: when the true count says to leave basic strategy.')}
        {/* R2/R4: interleaving is a DESIRABLE difficulty -- it helps once the
            base skill is there and costs accuracy before it. Soft, like every
            other gate here (V3-4, operator's explicit choice): the mode still
            works, it just says what it is. */}
        {entry('mixed', 'Mixed', 'Basic-strategy and index hands shuffled together, so you learn when the count matters.', true)}
        {entry('mastery', 'Mastery challenge', 'Every basic-strategy hand once, with no mistakes. One miss starts the sweep over.')}
        {entry('custom', 'Custom', 'Paint the chart cells you want, then drill just those in Flashcards, Mastery or Mixed.')}
        {entry('speed', 'Speed', 'Yes or no, against the clock: Surrender? Deviation here? Double? Split?')}
        {entry('rulesdiff', 'Rules differences', 'Only the plays that change between H17 and S17, 6 and 8 decks, or another game.')}

        <h2 className="drills-group-title">Under pressure</h2>
        {entry('betsizing', BET_SIZING_DRILL, BET_SIZING_PICKER, true)}
      </div>
      {/* Wave B2 #11 (B1): Drills is a tab-bar screen; Home is the tab bar's. */}
    </div>
  );
}

/**
 * B7: the Flashcards entry. Decides once, on mount, whether this launch is
 * the first-run "How to read the chart" screen; FlashcardsView is untouched.
 */
function FlashEntry({
  activeProfile,
  onBack,
  flashcards,
}: {
  activeProfile: Profile;
  onBack: () => void;
  flashcards: ReactNode;
}) {
  const [intro, setIntro] = useState(() =>
    chartIntroDue({
      stats: loadStats(),
      seen: loadChartIntroSeen(),
      eyesFree: isEyesFreeOn(),
      voiceOn: isVoiceOn(),
      search: window.location.search,
      e2e: isE2eAudioMode(),
    }),
  );
  if (intro) {
    return (
      <ChartIntro
        activeProfile={activeProfile}
        onBack={onBack}
        onStart={() => {
          saveChartIntroSeen();
          setIntro(false);
        }}
      />
    );
  }
  return <>{flashcards}</>;
}
