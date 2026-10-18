import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import type { GradedEvent } from '../../../engine/grade';
import type { Card, Rank } from '../../../engine/cards';
import type { CellTally } from '../../../store/cellStats';
import { useAudio } from '../../../audio/useAudio';
import { narrateCorrection } from '../../../audio/narrate';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../../drills/answerPause';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../../audio/voiceRecognition';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { cancelSpeech, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import type { WheelCommand } from '../../../audio/wheelCommands';
import {
  expiryVerdict,
  shotClockExpired,
  shotClockOn,
  shotClockSuspended,
} from '../../../drills/shotClock';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { focusSwallowsKey } from '../../keyboardFocus';
import { useVoiceToggle, usePushToTalk, startPushToTalk } from '../../voiceSession';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { withdrawAnswer, wrongTapOffered, type WrongTapRecord } from '../../wrongTap';
import type { HandResult } from '../../handResult';
import type { DrillHandResult } from './drillMiss';
import { chartTargetFrom, type AnswerFeedback, type ChartTarget } from './handDrillShared';

/*
 * W2-25: the answer plumbing the three hand drills (Flashcards, Deviation
 * quiz, Mixed) used to carry three copies of -- the answer and prompt clocks,
 * the auto-advance timer, the once-per-session spoken "Correct.", the
 * correction panel and the wheel's phase, the result strip and "Wrong tap",
 * the study chart, the shot clock, and the wheel / voice / keyboard wiring.
 * Each view keeps only what is its own: what it deals and how it grades.
 *
 * Several hooks rather than one, because React runs effects in the order the
 * hooks are called and the views' effects interleave with these: the
 * session's (wake lock, audio) run before the view speaks its prompt, the
 * shot clock's after, then the wheel and voice, then the keyboard. Each view
 * calls them where its own copy used to sit.
 */

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
export function useControlStripBottom() {
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

/**
 * The last answered hand's result and the chart it can open.
 *
 * In visual mode an answer no longer waits on a Next tap: the view grades,
 * freezes the result here, and draws the next hand in the same handler. The
 * strip shows the frozen result; "Show on chart" opens that frozen hand.
 * Eyes-free, voice and the wheel keep their timed auto-advance and the
 * full correction panel -- nobody is looking at a strip while driving.
 */
export function useHandResult() {
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

export type WheelPhase = 'asking' | 'reporting' | 'feedback';

/**
 * One hand drill's answer session: the state every answer path reads and
 * writes. `context` names the screen to the eyes-free / voice sessions and
 * the logs ('flashcards', 'deviation-quiz', 'mixed-session').
 */
export function useAnswerSession(settings: Settings, context: string) {
  // Eyes-free audio (Task 9): a per-session choice, shared across screens for
  // the life of this page load (ui/eyesFreeSession.ts) rather than owned by
  // each drill -- it used to reset on every navigation, which in a car reads
  // as the app having gone silent for no reason.
  const [eyesFree, setEyesFree] = useEyesFreeToggle(context);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  // B1: the last answered card, frozen, and the hand the chart opens on.
  const hand = useHandResult();
  const audio = useAudio(settings.audio);

  // Voice input. Per-session like eyes-free, and deliberately NOT persisted:
  // a setting that survives a reload would open the microphone on load, which
  // browsers refuse without a gesture anyway and which nobody should have to
  // discover after the fact.
  // Remembered for the life of the page load, not the life of this screen:
  // a toggle forgotten on every navigation is indistinguishable, in a car,
  // from a microphone that failed. See ui/voiceSession.ts.
  const [voiceOn, setVoiceOn] = useVoiceToggle(context);
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
  // the moment the CURRENT card was drawn -- read at the shared grade site
  // to compute elapsedMs. Written in the exact same place as
  // `runIdRef.current += 1` (each view's `next()` and this initial value),
  // so it can never point at a stale, already-answered card: there is no
  // async gap between drawing a card and this ref being updated for it,
  // unlike the auto-advance timer runIdRef guards against.
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
  // Wave A (s09): reading time before THIS card's clock starts -- set after a
  // miss in visual mode, when the next card is dealt under the correction.
  // Always 0 in a drill with no shot clock (Mixed).
  const clockGraceRef = useRef(0);
  // Spoken "Correct." is only wanted once per drill session -- after that,
  // correct answers still chime but skip the spoken text. `useRef(false)`
  // is fresh on every mount, and each view is unmounted/remounted each time
  // it's (re)entered from the picker (see the Drills switch), so a new
  // session always starts with this false; no extra reset effect needed.
  const spokenCorrectOnceRef = useRef(false);
  // The wheel self-check: is the right play currently revealed and waiting to
  // be reported on? State for the banner, a REF for the handler, because two
  // wheel presses can land in the same tick and the second would otherwise be
  // handled by the closure from the render BEFORE the first -- the same bug
  // the count drills' `phaseRef` exists for.
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const wheelPhaseRef = useRef<WheelPhase>('asking');
  // The correction on screen, for the same reason: the second of two presses
  // in one tick arrives before React has re-rendered with it.
  const feedbackRef = useRef<AnswerFeedback | null>(null);
  // T0-BUG1: measure the control strip so the eyes-free ZonePad overlay can
  // start BELOW it (keeping its Dim-screen/Eyes-free toggles tappable).
  const [controlsRef, padTop] = useControlStripBottom();

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

  /**
   * Show a graded answer. The ONE place `feedback` is set to a result, so the
   * wheel's phase ref cannot fall out of step with what is on screen -- there
   * are four grade sites (button, zone, shot clock, self-report) and a missed
   * one would leave the wheel still offering "I had it" over a correction.
   */
  const showFeedback = (result: AnswerFeedback) => {
    wheelPhaseRef.current = 'feedback';
    feedbackRef.current = result;
    setSelfCheckOpen(false);
    setFeedback(result);
  };

  /** The wheel is asking again and no correction is held for it. */
  const resetAnswerRefs = () => {
    wheelPhaseRef.current = 'asking';
    feedbackRef.current = null;
    setSelfCheckOpen(false);
  };

  /** A new item is up: no correction, the wheel is asking again. */
  const resetAnswer = () => {
    setFeedback(null);
    resetAnswerRefs();
  };

  /** The prompt and answer clocks start now, with no reading grace. */
  const restartClocks = () => {
    promptShownAtRef.current = performance.now();
    answerClockRef.current = promptShownAtRef.current;
    clockGraceRef.current = 0;
  };

  // `spokenMs` is how long the correction will occupy the speaker. The next
  // prompt speaks with `interrupt: true`, so advancing on the configured
  // pause alone cut the explanation off mid-sentence -- see answerPause.ts.
  const scheduleAutoAdvance = (spokenMs: number, next: () => void) => {
    clearAdvanceTimer();
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenMs));
  };

  // Gates the SPOKEN "Correct." text (never the chime, never wrong-answer
  // speech, never the visible badge) to once per drill session: the first
  // correct answer speaks in full and flips the ref; every correct answer
  // after that skips `doSpeak` entirely so only the chime plays. Shared by
  // every handler so the visual and eyes-free paths can't drift.
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

  /** The correction through the app's own voice, queued after the echo. */
  const speakQueued = (text: string) => speak(text, speechOptsFrom(settings.audio));
  /** Interrupting whatever is being said (a refusal, an echo, a repeat). */
  const speakNow = (text: string) => speak(text, speechOptsFrom(settings.audio, { interrupt: true }));

  /**
   * The timed correction screen (eyes-free, voice, the wheel, a blind
   * timeout): freeze the strip, show the panel, advance once it has been said.
   */
  const completeTimed = (result: AnswerFeedback, spokenMs: number, freeze: () => void, next: () => void) => {
    freeze();
    showFeedback(result);
    scheduleAutoAdvance(spokenMs, next);
  };

  /**
   * The eyes-free self-check: what the two wheel buttons do on a hand drill.
   *
   * An answer is a five-way choice and the wheel has two buttons, so the
   * wheel cannot state a play. It can run the shape the count drills already
   * use instead -- say the right play, then ask whether you had it -- and
   * that answer IS binary. `SELF_REPORT_HAD`/`SELF_REPORT_MISSED` carry it
   * through the shared grade path (drills/gradeAnswer.ts).
   */
  const openSelfCheck = (spoken: string) => {
    wheelPhaseRef.current = 'reporting';
    setSelfCheckOpen(true);
    speakNow(spoken);
  };

  // A pending auto-advance is an eyes-free affordance; leaving eyes-free must
  // cancel it, or the correction vanishes and a new card appears on its own
  // in visual mode.
  const changeEyesFree = (on: boolean) => {
    if (!on) clearAdvanceTimer();
    setEyesFree(on);
  };

  const openChartOn = (result: HandResult) => {
    hand.setChartTarget(chartTargetFrom(result));
    setShowChart(true);
  };

  /** MistakeCard's "Show table": no advance happened on this path, so the
   *  item on screen IS the answered one. Frozen anyway, like the strip. */
  const openChartOnFeedback = (cards: Card[] | null, up: Rank, event: GradedEvent) => {
    hand.setChartTarget({
      cards,
      up,
      graded: { expected: event.expected, reason: event.reason, tc: event.tc },
    });
    setShowChart(true);
  };

  // Closing the chart over a strip lands on a card that has been waiting,
  // unanswered, the whole time the chart was up. Its clock restarts so that
  // time is not charged to the answer (latency, shot clock).
  const closeChart = () => {
    setShowChart(false);
    if (!feedbackRef.current) {
      runIdRef.current += 1;
      restartClocks();
    }
  };

  /** Back: stop mid-utterance speech on the way out, matching CountDrillView.
   *  Without it, a correction being spoken carried on over the drill picker. */
  const leave = (onBack: () => void, clearShotClock?: () => void) => {
    cancelSpeech();
    clearAdvanceTimer();
    clearShotClock?.();
    void releaseWakeLock();
    onBack();
  };

  return {
    eyesFree,
    setEyesFree,
    changeEyesFree,
    voiceOn,
    setVoiceOn,
    pushToTalkOpen,
    voiceSupported,
    audio,
    feedback,
    feedbackRef,
    showFeedback,
    resetAnswer,
    resetAnswerRefs,
    showChart,
    setShowChart,
    openChartOn,
    openChartOnFeedback,
    closeChart,
    ...hand,
    runIdRef,
    promptShownAtRef,
    answerClockRef,
    clockGraceRef,
    restartClocks,
    selfCheckOpen,
    wheelPhaseRef,
    openSelfCheck,
    controlsRef,
    padTop,
    clearAdvanceTimer,
    scheduleAutoAdvance,
    speakCorrectionOnceGated,
    speakQueued,
    speakNow,
    completeTimed,
    leave,
  };
}

export type AnswerSession = ReturnType<typeof useAnswerSession>;

/**
 * R1's shot clock. The timer is a plain setTimeout rather than anything
 * derived from the countdown bar: the bar is a CSS animation with no callback
 * and no JS state, so the deadline has to be kept separately. Both are keyed
 * to the same runId, which is what stops a timer from a previous card grading
 * the one now on screen.
 */
export function useShotClock(settings: Settings, eyesFree: boolean, voiceOn: boolean) {
  const shotClockMs = settings.drill.shotClockMs;
  const timerRef = useRef<number | null>(null);
  // Wave A F3: no clock eyes-free or by voice.
  const clockSuspended = shotClockSuspended(eyesFree, voiceOn);
  // Wave A (s09): expiries in a row, and whether the clock has stopped
  // because nobody is answering. Any answer resets both.
  const consecutiveTimeoutsRef = useRef(0);
  const [clockIdle, setClockIdle] = useState(false);

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Somebody is there: an answer restarts a clock stopped for idleness. */
  const noteAnswered = () => {
    consecutiveTimeoutsRef.current = 0;
    setClockIdle(false);
  };

  /**
   * A timer fired. Returns the MEASURED elapsed time when the item is to be
   * graded as a timeout, or null when it is not: not really expired, or
   * (Wave A s09) the second unanswered item in a row, when the clock stops
   * and waits for somebody to answer instead.
   */
  const takeExpiry = (promptShownAt: number, graceMs: number): number | null => {
    const elapsedMs = performance.now() - promptShownAt;
    if (!shotClockExpired(elapsedMs - graceMs, shotClockMs)) return null;
    if (expiryVerdict(consecutiveTimeoutsRef.current) === 'stop') {
      setClockIdle(true);
      return null;
    }
    consecutiveTimeoutsRef.current += 1;
    return elapsedMs;
  };

  return { shotClockMs, timerRef, clockSuspended, clockIdle, clear, noteAnswered, takeExpiry };
}

export type ShotClock = ReturnType<typeof useShotClock>;

/**
 * Arm the clock for the item on screen. Re-armed whenever the item changes,
 * and cleared the moment an answer lands (`feedback`), the chart overlay goes
 * up over a frozen correction, or the limit is switched off in Settings
 * mid-drill. `runIdRef` is not a dep: it is a ref, and the item changes in
 * the same render that bumps it.
 */
export function useShotClockTimer(
  clock: ShotClock,
  session: Pick<AnswerSession, 'feedback' | 'showChart' | 'runIdRef' | 'clockGraceRef'>,
  itemKey: unknown,
  done: boolean,
  onExpire: () => void,
): void {
  const { feedback, showChart, runIdRef, clockGraceRef } = session;
  useEffect(() => {
    clock.clear();
    if (!shotClockOn(clock.shotClockMs)) return;
    if (feedback || showChart || clock.clockSuspended || clock.clockIdle || done) return;
    const runId = runIdRef.current;
    clock.timerRef.current = window.setTimeout(() => {
      clock.timerRef.current = null;
      // The card moved on while this timer was queued -- grading now would
      // score the hand on screen against a clock that belonged to a previous
      // one. Same guard, same reason, as the auto-advance timer's.
      if (runIdRef.current !== runId) return;
      onExpire();
    }, clock.shotClockMs + clockGraceRef.current);
    return clock.clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, feedback, showChart, clock.shotClockMs, clock.clockSuspended, clock.clockIdle, done]);
}

/**
 * The wheel and the microphone, wired to a hand drill.
 *
 * The wheel: push-to-talk mode borrows both buttons (forward opens the
 * microphone for a few seconds, back still repeats -- ui/voiceSession.ts).
 * Otherwise it runs the self-check: asking, forward reveals the play and
 * back repeats the hand ("repeat is useful"); reporting, forward = I had it
 * and back = I missed it; on the correction, forward deals the next item and
 * back says the correction again. The chart overlay is modal over a frozen
 * correction, exactly as for the keyboard and for voice.
 *
 * The voice: eyes-free, a rejection is silence, and silence looks the same
 * as a dead microphone, so a short cue says "say it again"; the engine is
 * biased toward the words it should be hearing ("stand" came back as
 * "Stant" unbiased). Push-to-talk opens the recogniser for its window even
 * with the toggle off; without that the wheel would open a microphone
 * nothing listens to.
 */
export function useAnswerInputs({
  settings,
  context,
  session,
  isDone,
  promptKey,
  onRepeat,
  onReveal,
  onSelfReport,
  onNext,
  onVoiceAction,
}: {
  settings: Settings;
  context: string;
  session: AnswerSession;
  /** R7: a finished review has nothing left to ask. */
  isDone: () => boolean;
  promptKey: unknown;
  onRepeat: () => void;
  onReveal: () => void;
  onSelfReport: (had: boolean) => void;
  onNext: () => void;
  onVoiceAction: (action: VoiceAction) => void;
}): { status: ReturnType<typeof useVoiceControl>['status']; cycleIfStale: () => void } {
  const { audio, showChart, wheelPhaseRef, feedbackRef, speakNow } = session;
  useWheelCommand((command: WheelCommand) => {
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk(context);
        audio.ding('attention');
      } else {
        onRepeat();
      }
      return;
    }
    if (showChart) return;
    if (isDone()) return;

    if (wheelPhaseRef.current === 'reporting') {
      onSelfReport(command === 'forward');
      return;
    }
    if (wheelPhaseRef.current === 'feedback') {
      if (command === 'forward') {
        onNext();
      } else if (feedbackRef.current) {
        speakNow(narrateCorrection(feedbackRef.current.event));
      }
      return;
    }
    if (command === 'forward') onReveal();
    else onRepeat();
  });

  return useVoiceControl({
    enabled: session.voiceOn || session.pushToTalkOpen,
    onAction: onVoiceAction,
    onNotUnderstood: () => audio.ding('again'),
    escalation: {
      promptKey,
      reask: onRepeat,
    },
    biasPhrases: Object.keys(VOICE_ACTIONS),
    onListening: () => audio.dingWhenQuiet('ready'),
    context,
  });
}

/**
 * Desktop keyboard input (operator request): while an answer is awaited,
 * `onAnswerKey` feeds the SAME handler a tap would use; Enter/Space advance
 * once the correction (the "Next" state) is showing. Skipped whenever a
 * native input/select/textarea has focus, so the controls above are
 * unaffected, and while the chart overlay is up: it is modal over a frozen
 * correction, and Enter (the obvious "dismiss" key) used to run next()
 * BEHIND it.
 *
 * `itemKey` is a REQUIRED dep: a scope change deals a new item while
 * `feedback` is already null, and a listener bound to the previous item
 * graded the hand you had already left.
 */
export function useAnswerKeys({
  feedback,
  eyesFree,
  itemKey,
  showChart,
  isDone,
  onAnswerKey,
  onNext,
}: {
  feedback: AnswerFeedback | null;
  eyesFree: boolean;
  itemKey: unknown;
  showChart: boolean;
  isDone: () => boolean;
  onAnswerKey: (e: KeyboardEvent) => void;
  onNext: () => void;
}): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (showChart) return;
      if (isDone()) return;

      if (!feedback) {
        onAnswerKey(e);
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, eyesFree, itemKey, showChart]);
}

/** Insurance items: 1 = Take, 2 = Decline, matching the visual buttons and
 *  the ZonePad's insurance variant. */
export function insuranceKey(
  e: KeyboardEvent,
  eyesFree: boolean,
  onZone: (zone: 'take' | 'decline') => void,
  onAnswer: (taken: string) => void,
): void {
  if (e.key === '1') {
    e.preventDefault();
    if (eyesFree) onZone('take');
    else onAnswer('take-insurance');
  } else if (e.key === '2') {
    e.preventDefault();
    if (eyesFree) onZone('decline');
    else onAnswer('decline-insurance');
  }
}
