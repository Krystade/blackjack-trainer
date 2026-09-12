import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Action, DeviationId } from '../../engine/deviations';
import { isIndexActive, indexSetFor } from '../../engine/deviations';
import type { GradedEvent } from '../../engine/grade';
import { drawFlashcard } from '../../drills/flashcards';
import { drillLegalActions } from '../../drills/legalActions';
import { gateDrillAnswer } from '../../drills/answerGate';
import type { Flashcard } from '../../drills/flashcards';
import { drawQuizItem } from '../../drills/deviationQuiz';
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
  TIMEOUT_ANSWER } from '../../drills/gradeAnswer';
import { shotClockExpired, shotClockOn } from '../../drills/shotClock';
import type { SrDeck } from '../../drills/spacedRepetition';
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
import { Segmented } from './Settings';
import { useAudio } from '../../audio/useAudio';
import { narrateCorrection, narrateFlashcardPrompt, narrateQuizPrompt } from '../../audio/narrate';
import { useVoiceControl } from '../useVoiceControl';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../drills/answerPause';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../audio/voiceRecognition';
import { BLIND_TAP_CHANNEL, SCREEN_CHANNEL, VOICE_CHANNEL } from '../../drills/spacedRepetition';
import type { AnswerChannel } from '../../drills/spacedRepetition';
import { VoiceStatusBar } from '../components/VoiceStatusBar';
import type { VoiceAction } from '../../audio/voiceRecognition';
import { cancelSpeech, speak } from '../../audio/speech';
import { speechOptsFrom } from '../../audio/speechOpts';
import { requestWakeLock, releaseWakeLock } from '../../audio/wakeLock';
import { ZONE_LABEL } from '../../audio/zones';
import type { ZoneId } from '../../audio/zones';
import { CountDrillView } from './drills/CountDrillView';
import { TrueCountDrillView } from './drills/TrueCountDrillView';
import { ProduceTcDrillView } from './drills/ProduceTcDrillView';
import { PairCancelView } from './drills/PairCancelView';
import { BetSitLeaveView } from './drills/BetSitLeaveView';
import { DownswingView } from './drills/DownswingView';
import { DeckEstimationView } from './drills/DeckEstimationView';
import { MasteryChallengeView } from './drills/MasteryChallengeView';
import { focusSwallowsKey, blurAfterChange } from '../keyboardFocus';
import { enableAudioNow } from '../audioGate';

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

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
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
/* Flashcards                                                        */
/* ---------------------------------------------------------------- */

function FlashcardsView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange }: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  const srDeckRef = useRef<SrDeck>(loadFlashSr());
  const [card, setCard] = useState<Flashcard>(() =>
    drawFlashcard(settings.drill.flashCategory, srDeckRef.current, Date.now(), randomSeed(), activeProfile.rules, settings.drill.flashByFrequency),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction: Action; event: GradedEvent } | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 9): local UI state, not persisted, per the
  // CountDrillView precedent (a per-session choice scoped to this screen).
  const [eyesFree, setEyesFree] = useState(false);
  // Voice input. Per-session like eyes-free, and deliberately NOT persisted:
  // a setting that survives a reload would open the microphone on load, which
  // browsers refuse without a gesture anyway and which nobody should have to
  // discover after the fact.
  const [voiceOn, setVoiceOn] = useState(false);
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
  // Spoken "Correct." is only wanted once per drill session -- after that,
  // correct answers still chime but skip the spoken text. `useRef(false)`
  // is fresh on every mount, and this view is unmounted/remounted each time
  // it's (re)entered from the picker (see the Drills switch below), so a
  // new session always starts with this false; no extra reset effect needed.
  const spokenCorrectOnceRef = useRef(false);
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

  // Speak the scenario whenever a new card is drawn, or the instant
  // eyes-free is switched on for the current card. Unlike Phase-A's
  // verbosity-gated narration, eyes-free speaks regardless of verbosity --
  // it IS the primary output channel in this mode, not decoration (same
  // precedent as CountDrillView's flashing-card narration).
  useEffect(() => {
    // Voice counts as eyes-free whether or not the ZonePad is up: someone
    // answering out loud is not watching the screen, and an unspoken prompt
    // would leave them waiting for a question that never comes.
    if (!eyesFree && !voiceOn) return;
    speak(narrateFlashcardPrompt(card.cards, card.up, settings.audio.handStyle), speechOptsFrom(settings.audio, { interrupt: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, eyesFree, voiceOn]);

  const next = (category: Settings['drill']['flashCategory'] = settings.drill.flashCategory) => {
    runIdRef.current += 1;
    clearAdvanceTimer();
    // Advancing invalidates the correction the chart was opened for, so the
    // overlay must not survive it: left open it re-pointed at the NEW card
    // (its cards/dealerUp are live props), and the learner closed it onto a
    // hand they had never been asked about.
    setShowChart(false);
    setCard(drawFlashcard(category, srDeckRef.current, Date.now(), randomSeed(), activeProfile.rules, settings.drill.flashByFrequency));
    setFeedback(null);
    promptShownAtRef.current = performance.now();
  };

  const changeCategory = (category: Settings['drill']['flashCategory']) => {
    const nextSettings: Settings = { ...settings, drill: { ...settings.drill, flashCategory: category } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
    next(category);
  };

  // "Dim screen" (opt-in): the ZonePad is visible-with-labels by default so
  // its layout can be learned; this switches it back to the transparent-
  // but-tappable presentation for genuine eyes-free driving use.
  const toggleDimZones = (dim: boolean) => {
    const nextSettings: Settings = { ...settings, audio: { ...settings.audio, dimZones: dim } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
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
    speak(narrateFlashcardPrompt(card.cards, card.up, settings.audio.handStyle), speechOptsFrom(settings.audio, { interrupt: true }));
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
    taken: Action,
    channel: AnswerChannel,
  ): { event: GradedEvent; correctAction: Action } => {
    const elapsedMs = performance.now() - promptShownAtRef.current;
    const result = gradeFlashcard(
      card,
      taken,
      activeProfile.rules,
      elapsedMs,
      srDeckRef.current,
      Date.now(),
      channel,
    );
    srDeckRef.current = result.nextDeck;
    return { event: result.event, correctAction: result.correctAction };
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

  const handleAction = (taken: Action) => {
    // An ActionBar click: the hand is on screen and a finger is on the button.
    const { event, correctAction } = gradeFlashcardAnswer(taken, SCREEN_CHANNEL);

    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct, correctAction, event });
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

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    const gate = gateDrillAnswer(zone, card.cards, activeProfile.rules);
    if (!gate.accepted) {
      speak(gate.announcement!, speechOptsFrom(settings.audio, { interrupt: true }));
      return;
    }

    speak(`${zoneLabel(zone)}…`, speechOptsFrom(settings.audio, { interrupt: true }));

    const { event, correctAction } = gradeFlashcardAnswer(zone, channel);

    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct, correctAction, event });
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
    const elapsedMs = performance.now() - promptShownAtRef.current;
    if (!shotClockExpired(elapsedMs, shotClockMs)) return;

    const result = gradeFlashcard(
      card,
      TIMEOUT_ANSWER,
      activeProfile.rules,
      elapsedMs,
      srDeckRef.current,
      Date.now(),
    );
    srDeckRef.current = result.nextDeck;

    const spokenMs = speakCorrectionOnceGated(result.event, (text) =>
      eyesFree || voiceOn
        ? speak(text, speechOptsFrom(settings.audio))
        : audio.say(text, { interrupt: true }),
    );
    audio.ding('bad');
    setFeedback({ correct: false, correctAction: result.correctAction, event: result.event });
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
    if (feedback || showChart) return;
    const runId = runIdRef.current;
    shotClockTimerRef.current = window.setTimeout(() => {
      shotClockTimerRef.current = null;
      // The card moved on while this timer was queued -- grading now would
      // score the hand on screen against a clock that belonged to a previous
      // one. Same guard, same reason, as the auto-advance timer's.
      if (runIdRef.current !== runId) return;
      handleShotClockExpiry();
    }, shotClockMs);
    return clearShotClock;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, feedback, showChart, shotClockMs]);

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


  // NO STEERING-WHEEL CLAIM HERE, and twice deliberately.
  //
  // A wheel press means "yes" (audio/wheelCommands.ts), and a flashcard or quiz
  // answer is a five-way decision -- one button cannot say which. `yes` is
  // already a no-op above for the same reason.
  //
  // And this screen RENDERS the count and true-count drills as children, both
  // of which do claim the wheel. Child effects run before the parent's, so a
  // claim here would win the slot and hand every press to flashcards while a
  // count drill was on screen.

  const voice = useVoiceControl({
    enabled: voiceOn,
    onAction: handleVoiceAction,
    // Eyes-free, a rejection is silence, and silence looks the same as a dead
    // microphone. A short cue says "say it again" without costing a sentence
    // of narration mid-drill; it respects the chimes setting like every other
    // tone, so it can be turned off.
    onNotUnderstood: () => audio.ding('attention'),
    // Bias the engine toward the words it should be hearing. Reported from
    // real use: "stand" came back as "Stant" and was rejected -- unbiased,
    // the engine is choosing a one-syllable word out of all of English.
    biasPhrases: Object.keys(VOICE_ACTIONS),
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
        } else if (gateDrillAnswer(action, card.cards, activeProfile.rules).accepted) {
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
    // null, so `feedback` alone was a sufficient proxy. `changeCategory`
    // breaks that: it calls next() while feedback is ALREADY null, React bails
    // on the no-op state write, the dep array never changes, and the listener
    // stays bound to the previous card. The next keypress then graded the hand
    // you had already left -- accepting a Split the visible hand cannot make,
    // and writing the miss into Stats and the SR deck under the OLD cellId.
    // Every sibling view (quiz, mixed, pair-cancel, bet/sit/leave) already
    // lists its item here; this was the only one that did not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, eyesFree, card, showChart]);

  return (
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Flashcards</div>
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
        <div className="settings-row">
          <span className="settings-label">Category</span>
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pairs', label: 'Pairs' },
            ]}
            value={settings.drill.flashCategory}
            onChange={changeCategory}
          />
        </div>

        {/* V4-1 (docs/BACKLOG.md): the draw weighted cells by schedule alone,
            so the 16 v 10 you face most shoes and the hard 5 v 7 you face once
            a month got the same reps. Off by default -- reallocating practice
            time is the user's call. */}
        <label className="count-toggle">
          <input
            type="checkbox"
            checked={settings.drill.flashByFrequency}
            onChange={(e) => {
              const nextSettings: Settings = {
                ...settings,
                drill: { ...settings.drill, flashByFrequency: e.target.checked },
              };
              saveSettings(nextSettings);
              onSettingsChange(nextSettings);
            }}
          />
          <span>Favour hands you&apos;ll actually see</span>
        </label>

        <label className="count-toggle">
          <input
            type="checkbox"
            checked={eyesFree}
            onChange={(e) => {
              // Tapping this IS a request for audio, so honour it instead of
              // refusing: the control used to sit disabled whenever
              // `audio.enabled` was false -- which is the shipped default --
              // making the app's whole driving mode a dead checkbox curable
              // only from another screen. See ui/audioGate.ts.
              if (e.target.checked && !settings.audio.enabled) {
                enableAudioNow(settings, onSettingsChange);
              }
              // A pending auto-advance is an eyes-free affordance; leaving
              // eyes-free must cancel it, or the correction vanishes and a new
              // card appears on its own in visual mode.
              if (!e.target.checked) clearAdvanceTimer();
              setEyesFree(e.target.checked);
            }}
          />
          Eyes-free audio
        </label>
        <label className="count-toggle">
          <input
            type="checkbox"
            checked={settings.audio.dimZones}
            disabled={!eyesFree}
            onChange={(e) => toggleDimZones(e.target.checked)}
          />
          Dim screen
        </label>
        {voiceSupported && (
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={voiceOn}
              onChange={(e) => {
                // Answering out loud is worthless without hearing the reply,
                // so this turns audio on the way Eyes-free does rather than
                // sitting dead when audio happens to be off.
                if (e.target.checked && !settings.audio.enabled) {
                  enableAudioNow(settings, onSettingsChange);
                }
                setVoiceOn(e.target.checked);
              }}
            />
            Voice answers
          </label>
        )}
        {/* What the microphone last heard, whether or not it meant anything.
            Without it a misheard word and a dead microphone look identical,
            and neither can be diagnosed while driving. */}
        {voiceOn && <VoiceStatusBar status={voice.status} />}
      </div>

      <div className="dealer-area">
        <PlayingCard card={{ rank: card.up, suit: 's' }} />
      </div>

      <div className="hands-row">
        <div className="player-hand">
          <div className="hand-cards">
            {card.cards.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
        </div>
      </div>

      {/* Between the hand and the answer, which is where the eye already is.
          Paused rather than hidden once an answer is in, so the bar does not
          vanish out from under a glance at the correction. */}
      <ShotClockBar
        limitMs={shotClockMs}
        restartKey={runIdRef.current}
        paused={feedback !== null || showChart}
      />

      <div className="message-strip">
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
                onShowTable={() => setShowChart(true)}
              />
            )}
            {/* The cell id names the chart row just drilled, and belongs to
                the feedback state rather than to either outcome — it is
                equally worth seeing after a hit or a miss. */}
            <div className="feedback-cell">{card.cellId}</div>
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
          />
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              legal: drillLegalActions(card.cards, activeProfile.rules),
              onAction: handleAction }}
          />
        )
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={() => next()}>
            Next
          </button>
        </div>
      )}
      {showChart && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={card.cards}
          dealerUp={card.up}
          onClose={() => setShowChart(false)}
        />
      )}
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
  if (!isIndexActive(quizIndex, activeProfile.rules)) {
    return 'all';
  }
  return quizIndex;
}

function DeviationQuizView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange }: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  // Use the active filter (falls back to 'all' if saved index is inactive)
  const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);

  // R3 (docs/BACKLOG.md, spaced-repetition): per-index miss-weight map,
  // loaded once per mount exactly like FlashcardsView's srDeckRef.
  const srDeckRef = useRef<SrDeck>(loadQuizSr());

  const [item, setItem] = useState<QuizItem>(() =>
    drawQuizItem(
      randomSeed(),
      quizFilterArg(activeFilter),
      activeProfile.rules,
      settings.drill.quizDistractorPct,
      srDeckRef.current,
      Date.now(),
    ),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; event: GradedEvent } | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 9): local UI state, not persisted, per the
  // CountDrillView precedent (a per-session choice scoped to this screen).
  const [eyesFree, setEyesFree] = useState(false);
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
    if (eyesFree) {
      speak(narrateQuizPrompt(item.cards, item.up, item.tc, settings.audio.handStyle), speechOptsFrom(settings.audio, { interrupt: true }));
    } else {
      audio.sayFull(narrateQuizPrompt(item.cards, item.up, item.tc, settings.audio.handStyle));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, eyesFree]);

  const next = (filter: DeviationId | 'all' = activeFilter, distractorPct: number = settings.drill.quizDistractorPct) => {
    runIdRef.current += 1;
    clearAdvanceTimer();
    // Advancing invalidates the correction the chart was opened for, so the
    // overlay must not survive it: left open it re-pointed at the NEW card
    // (its cards/dealerUp are live props), and the learner closed it onto a
    // hand they had never been asked about.
    setShowChart(false);
    setItem(
      drawQuizItem(randomSeed(), quizFilterArg(filter), activeProfile.rules, distractorPct, srDeckRef.current, Date.now()),
    );
    setFeedback(null);
    promptShownAtRef.current = performance.now();
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

  // "Dim screen" (opt-in): the ZonePad is visible-with-labels by default so
  // its layout can be learned; this switches it back to the transparent-
  // but-tappable presentation for genuine eyes-free driving use.
  const toggleDimZones = (dim: boolean) => {
    const nextSettings: Settings = { ...settings, audio: { ...settings.audio, dimZones: dim } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
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
    speak(narrateQuizPrompt(item.cards, item.up, item.tc, settings.audio.handStyle), speechOptsFrom(settings.audio, { interrupt: true }));
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
    const elapsedMs = performance.now() - promptShownAtRef.current;
    const result = gradeQuiz(
      item,
      taken,
      activeProfile.rules,
      elapsedMs,
      srDeckRef.current,
      Date.now(),
      channel,
    );
    srDeckRef.current = result.nextDeck;
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

  const handleAnswer = (taken: string) => {
    const event = gradeQuizAnswer(taken);

    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct, event });
  };

  /**
   * The shot clock ran out. See FlashcardsView's handler for the reasoning --
   * the same one applies here, including insurance items: "take or decline?" is
   * a decision with a deadline at a real table too, and letting it sit
   * unanswered is not a third option.
   */
  const handleShotClockExpiry = () => {
    const elapsedMs = performance.now() - promptShownAtRef.current;
    if (!shotClockExpired(elapsedMs, shotClockMs)) return;

    const event = gradeQuizAnswer(TIMEOUT_ANSWER);
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      eyesFree ? speak(text, speechOptsFrom(settings.audio)) : audio.say(text, { interrupt: true }),
    );
    audio.ding('bad');
    setFeedback({ correct: false, event });
    scheduleAutoAdvance(spokenMs);
  };

  // Arm the clock for the item on screen; see FlashcardsView's copy for why
  // each dep is here and why runIdRef is not.
  useEffect(() => {
    clearShotClock();
    if (!shotClockOn(shotClockMs)) return;
    if (feedback || showChart) return;
    const runId = runIdRef.current;
    shotClockTimerRef.current = window.setTimeout(() => {
      shotClockTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      handleShotClockExpiry();
    }, shotClockMs);
    return clearShotClock;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, feedback, showChart, shotClockMs]);

  // Eyes-free zone tap. Non-insurance items: ZoneId and Action are the
  // identical five-member literal union, so the tapped zone maps straight
  // onto `taken`. Insurance items: ZonePad's 'action'-mode zones ('hit'
  // etc.) never appear here since the pad is rendered in 'insurance' mode
  // for these items -- only 'take'/'decline' can arrive, translated to the
  // 'take-insurance'/'decline-insurance' strings buildQuizEvent expects
  // (matching the existing Take/Decline Insurance buttons exactly).
  const handleZoneAnswer = (zone: ZoneId | 'take' | 'decline') => {
    const isInsurance = item.cards === null;
    if (isInsurance !== (zone === 'take' || zone === 'decline')) return; // mode/zone mismatch guard

    const taken = zone === 'take' ? 'take-insurance' : zone === 'decline' ? 'decline-insurance' : zone;

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    const gate = gateDrillAnswer(taken, item.cards, activeProfile.rules);
    if (!gate.accepted) {
      speak(gate.announcement!, speechOptsFrom(settings.audio, { interrupt: true }));
      return;
    }

    speak(`${zoneLabel(zone)}…`, speechOptsFrom(settings.audio, { interrupt: true }));

    // The quiz has no voice input, so a zone tap here is always the blind
    // pad: eyes off the screen, hand on the glass.
    const event = gradeQuizAnswer(taken, BLIND_TAP_CHANNEL);

    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct, event });
    scheduleAutoAdvance(spokenMs);
  };

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
        } else if (gateDrillAnswer(action, item.cards, activeProfile.rules).accepted) {
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

  const indexList = indexSetFor(activeProfile.rules);

  return (
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Deviation Quiz</div>
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
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
                {d.label}
                {!d.active ? ' (inactive for this profile)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-row">
          <span className="settings-label">Mix in fakes</span>
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

        <label className="count-toggle">
          <input
            type="checkbox"
            checked={eyesFree}
            onChange={(e) => {
              // Tapping this IS a request for audio, so honour it instead of
              // refusing: the control used to sit disabled whenever
              // `audio.enabled` was false -- which is the shipped default --
              // making the app's whole driving mode a dead checkbox curable
              // only from another screen. See ui/audioGate.ts.
              if (e.target.checked && !settings.audio.enabled) {
                enableAudioNow(settings, onSettingsChange);
              }
              // A pending auto-advance is an eyes-free affordance; leaving
              // eyes-free must cancel it, or the correction vanishes and a new
              // card appears on its own in visual mode.
              if (!e.target.checked) clearAdvanceTimer();
              setEyesFree(e.target.checked);
            }}
          />
          Eyes-free audio
        </label>
        <label className="count-toggle">
          <input
            type="checkbox"
            checked={settings.audio.dimZones}
            disabled={!eyesFree}
            onChange={(e) => toggleDimZones(e.target.checked)}
          />
          Dim screen
        </label>
      </div>

      <div className="quiz-tc">TC {formatSigned(item.tc)}</div>

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
        limitMs={shotClockMs}
        restartKey={runIdRef.current}
        paused={feedback !== null || showChart}
      />

      <div className="message-strip">
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
                onShowTable={item.cards ? () => setShowChart(true) : undefined}
              />
            )}
            <div className="quiz-label">{item.label}</div>
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
          />
        ) : item.cards === null ? (
          <div className="action-bar">
            <button type="button" className="action-btn" onClick={() => handleAnswer('take-insurance')}>
              Take Insurance
            </button>
            <button type="button" className="action-btn" onClick={() => handleAnswer('decline-insurance')}>
              Decline Insurance
            </button>
          </div>
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              legal: drillLegalActions(item.cards, activeProfile.rules),
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
      {showChart && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={item.cards}
          dealerUp={item.up}
          onClose={() => setShowChart(false)}
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

  // Seeded interleave: the session seed is drawn once (lazily, StrictMode-
  // safe) and each position's type comes from pickMixedType(seed, index) --
  // pure, so a re-render can never desync it. itemIndexRef tracks position.
  const sessionSeedRef = useRef<number | null>(null);
  const sessionSeed = () => {
    if (sessionSeedRef.current === null) sessionSeedRef.current = randomSeed();
    return sessionSeedRef.current;
  };
  const itemIndexRef = useRef(0);

  const drawFor = (type: MixedItemType): MixedCurrent => {
    if (type === 'flash') {
      return {
        type,
        card: drawFlashcard(settings.drill.flashCategory, flashSrRef.current, Date.now(), randomSeed(), activeProfile.rules, settings.drill.flashByFrequency) };
    }
    const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);
    return {
      type,
      item: drawQuizItem(
        randomSeed(),
        quizFilterArg(activeFilter),
        activeProfile.rules,
        settings.drill.quizDistractorPct,
        quizSrRef.current,
        Date.now(),
      ) };
  };

  const [current, setCurrent] = useState<MixedCurrent>(() => drawFor(pickMixedType(sessionSeed(), 0)));
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction?: Action; event: GradedEvent } | null>(null);
  // #7: the chart opened over this correction, closed back onto the same card.
  const [showChart, setShowChart] = useState(false);
  const audio = useAudio(settings.audio);

  const [eyesFree, setEyesFree] = useState(false);
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const promptShownAtRef = useRef(performance.now());
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
      ? narrateFlashcardPrompt(c.card.cards, c.card.up, settings.audio.handStyle)
      : narrateQuizPrompt(c.item.cards, c.item.up, c.item.tc, settings.audio.handStyle);

  // Narrate each new item. Eyes-free speaks every item (its primary output
  // channel); visual mode mirrors each drill's standalone behavior -- the
  // quiz's verbosity-gated sayFull, and the flashcard's silence -- reusing
  // the same prompt builders (the quiz prompt includes the spoken TC, the
  // flashcard prompt never does, making the discrimination audible too).
  useEffect(() => {
    if (eyesFree) {
      speak(promptFor(current), speechOptsFrom(settings.audio, { interrupt: true }));
    } else if (current.type === 'quiz') {
      audio.sayFull(narrateQuizPrompt(current.item.cards, current.item.up, current.item.tc, settings.audio.handStyle));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, eyesFree]);

  const next = () => {
    runIdRef.current += 1;
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
  };

  const toggleDimZones = (dim: boolean) => {
    const nextSettings: Settings = { ...settings, audio: { ...settings.audio, dimZones: dim } };
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
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
    const elapsedMs = performance.now() - promptShownAtRef.current;
    if (current.type === 'flash') {
      const result = gradeFlashcard(current.card, taken as Action, activeProfile.rules, elapsedMs, flashSrRef.current, Date.now());
      flashSrRef.current = result.nextDeck;
      return { correct: result.event.correct, correctAction: result.correctAction, event: result.event };
    }
    const result = gradeQuiz(current.item, taken, activeProfile.rules, elapsedMs, quizSrRef.current, Date.now());
    quizSrRef.current = result.nextDeck;
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

  const handleAnswer = (taken: string) => {
    const { correct, correctAction, event } = gradeCurrent(taken);
    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(correct ? 'good' : 'bad');
    setFeedback({ correct, correctAction, event });
  };

  const handleZoneAnswer = (zone: ZoneId | 'take' | 'decline') => {
    // Insurance items expose only take/decline zones; every other item the
    // five action zones. Reject a mode/zone mismatch, exactly as the
    // standalone quiz view does.
    if (isInsuranceItem !== (zone === 'take' || zone === 'decline')) return;
    const taken = zone === 'take' ? 'take-insurance' : zone === 'decline' ? 'decline-insurance' : zone;

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    const gate = gateDrillAnswer(taken, handCards, activeProfile.rules);
    if (!gate.accepted) {
      speak(gate.announcement!, speechOptsFrom(settings.audio, { interrupt: true }));
      return;
    }

    speak(`${zoneLabel(zone)}…`, speechOptsFrom(settings.audio, { interrupt: true }));

    const { correct, correctAction, event } = gradeCurrent(taken);
    const spokenMs = speakCorrectionOnceGated(event, (text) =>
      speak(text, speechOptsFrom(settings.audio)),
    );
    audio.ding(correct ? 'good' : 'bad');
    setFeedback({ correct, correctAction, event });
    scheduleAutoAdvance(spokenMs);
  };

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
        else if (gateDrillAnswer(action, handCards, activeProfile.rules).accepted) handleAnswer(action);
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
        <div className="settings-row settings-note-row">
          Basic-strategy and count-dependent hands, interleaved.
        </div>
        <label className="count-toggle">
          <input
            type="checkbox"
            checked={eyesFree}
            onChange={(e) => {
              // Tapping this IS a request for audio, so honour it instead of
              // refusing: the control used to sit disabled whenever
              // `audio.enabled` was false -- which is the shipped default --
              // making the app's whole driving mode a dead checkbox curable
              // only from another screen. See ui/audioGate.ts.
              if (e.target.checked && !settings.audio.enabled) {
                enableAudioNow(settings, onSettingsChange);
              }
              // A pending auto-advance is an eyes-free affordance; leaving
              // eyes-free must cancel it, or the correction vanishes and a new
              // card appears on its own in visual mode.
              if (!e.target.checked) clearAdvanceTimer();
              setEyesFree(e.target.checked);
            }}
          />
          Eyes-free audio
        </label>
        <label className="count-toggle">
          <input
            type="checkbox"
            checked={settings.audio.dimZones}
            disabled={!eyesFree}
            onChange={(e) => toggleDimZones(e.target.checked)}
          />
          Dim screen
        </label>
      </div>

      {/* A quiz item shows its true count; a flashcard item shows none -- the
          visible cue that tells the learner which regime applies. */}
      {current.type === 'quiz' && <div className="quiz-tc">TC {formatSigned(current.item.tc)}</div>}

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
                onShowTable={handCards ? () => setShowChart(true) : undefined}
              />
            )}
            {current.type === 'flash' ? (
              <div className="feedback-cell">{current.card.cellId}</div>
            ) : (
              <div className="quiz-label">{current.item.label}</div>
            )}
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
          />
        ) : isInsuranceItem ? (
          <div className="action-bar">
            <button type="button" className="action-btn" onClick={() => handleAnswer('take-insurance')}>
              Take Insurance
            </button>
            <button type="button" className="action-btn" onClick={() => handleAnswer('decline-insurance')}>
              Decline Insurance
            </button>
          </div>
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              // `handCards` is non-null on this branch (the insurance case is
              // the branch immediately above), so the hand is always the real
              // two-card hand the legality rules expect.
              legal: drillLegalActions(handCards ?? [], activeProfile.rules),
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
      {showChart && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={handCards}
          dealerUp={dealerUp}
          onClose={() => setShowChart(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Picker                                                             */
/* ---------------------------------------------------------------- */

export function Drills({ settings, activeProfile, onNavigate, onSettingsChange }: DrillsProps) {
  const [mode, setMode] = useState<
    | 'picker'
    | 'count'
    | 'truecount'
    | 'deckest'
    | 'flash'
    | 'quiz'
    | 'mixed'
    | 'paircancel'
    | 'betsitleave'
    | 'downswing'
    | 'producetc'
    | 'mastery'
  >('picker');

  if (mode === 'count') {
    return (
      <CountDrillView
        settings={settings}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'truecount') {
    return (
      <TrueCountDrillView
        settings={settings}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'producetc') {
    return <ProduceTcDrillView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'deckest') {
    return <DeckEstimationView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'flash') {
    return (
      <FlashcardsView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'quiz') {
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
    return (
      <MixedSessionView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'mastery') {
    return (
      <MasteryChallengeView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'paircancel') {
    return <PairCancelView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'betsitleave') {
    return <BetSitLeaveView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'downswing') {
    return (
      <DownswingView settings={settings} activeProfile={activeProfile} onBack={() => setMode('picker')} />
    );
  }

  // V3-4: SOFT competence gating — advanced pressure modes still work, but show
  // a "build your fluency first" nudge until the learner has demonstrated basic
  // count-drill competence. Read once here (only the picker branch reaches this).
  const fluent = isCountFluent(loadStats().countDrill.history);
  const advancedNote = fluent ? null : (
    <div className="drills-nav-note">Advanced — build your count fluency first</div>
  );

  return (
    <div className="drills-picker">
      <h1 className="drills-title">Drills</h1>
      {/* Grouped by the SKILL each drill trains (C8). Ten identical buttons in
          one list said nothing about what to do next, or about the fact that
          keeping the count, knowing the plays, and holding up under pressure
          are three different abilities you build in roughly that order. */}
      <div className="drills-nav">
        <h2 className="drills-group-title">Keeping the count</h2>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('count')}>
          Count Drill
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('paircancel')}>
          Pair Cancellation
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('deckest')}>
          Deck Estimation
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('truecount')}>
          True Count Drill
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('producetc')}>
          Produce the True Count
        </button>

        <h2 className="drills-group-title">Knowing the plays</h2>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('flash')}>
          Flashcards
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('quiz')}>
          Deviation Quiz
        </button>
        {/* R2/R4: interleaving is a DESIRABLE difficulty -- it helps once the
            base skill is there and costs accuracy before it. Soft, like every
            other gate here (V3-4, operator's explicit choice): the mode still
            works, it just says what it is. */}
        <button
          type="button"
          className={`drills-nav-btn${fluent ? '' : ' drills-nav-btn-advanced'}`}
          onClick={() => setMode('mixed')}
        >
          Mixed
        </button>
        {advancedNote}
        <button type="button" className="drills-nav-btn" onClick={() => setMode('mastery')}>
          Mastery Challenge
        </button>

        <h2 className="drills-group-title">Under pressure</h2>
        <button
          type="button"
          className={`drills-nav-btn${fluent ? '' : ' drills-nav-btn-advanced'}`}
          onClick={() => setMode('betsitleave')}
        >
          Bet / Sit / Leave
        </button>
        {advancedNote}
        <button
          type="button"
          className={`drills-nav-btn${fluent ? '' : ' drills-nav-btn-advanced'}`}
          onClick={() => setMode('downswing')}
        >
          Downswing
        </button>
        {advancedNote}
      </div>
      <button type="button" className="drills-back-btn" onClick={() => onNavigate('home')}>
        Back to Home
      </button>
    </div>
  );
}
