import { useEffect, useRef, useState } from 'react';
import type { FlashHandOver } from '../../drillLaunch';
import type { Profile, Settings } from '../../../store/types';
import type { Action } from '../../../engine/deviations';
import type { GradedEvent } from '../../../engine/grade';
import { drawFlashcard, flashCtx } from '../../../drills/flashcards';
import type { Flashcard } from '../../../drills/flashcards';
import { flashOptionsFor } from '../../../drills/flashOptions';
import { indexLine } from '../../../drills/withCount';
import { plainCellLabel } from '../../../drills/cellLabel';
import { formatReviewPlain } from '../../../drills/srStatus';
import { drillLegalActions, rulesChipLabels } from '../../../drills/legalActions';
import { gateDrillAnswer } from '../../../drills/answerGate';
// R4 (docs/BACKLOG.md, interleaved mixed-session mode): the ONE shared grade
// path -- gradeFlashcardAnswer/gradeQuizAnswer back the standalone
// FlashcardsView/DeviationQuizView AND the mixed-session view, so the two
// contexts cannot drift (same engine graders, same R3 weights, same R1
// latency, same GradedEvent + Stats write). See src/drills/gradeAnswer.ts.
import {
  gradeFlashcardAnswer as gradeFlashcard,
  loadFlashSr,
  loadQuizSr,
  saveFlashSr,
  saveQuizSr,
  TIMEOUT_ANSWER,
  SELF_REPORT_HAD,
  SELF_REPORT_MISSED } from '../../../drills/gradeAnswer';
import type { DrillAnswer } from '../../../drills/gradeAnswer';
import { answeredUnderShotClock, answerElapsedMs, readGraceMs } from '../../../drills/shotClock';
import type { SrCard, SrDeck } from '../../../drills/spacedRepetition';
import { restoreSrCard, BLIND_TAP_CHANNEL, SCREEN_CHANNEL, VOICE_CHANNEL } from '../../../drills/spacedRepetition';
import type { AnswerChannel } from '../../../drills/spacedRepetition';
import { redealOptions } from '../../../drills/learningRedeal';
import { useLearningRedeal } from './useLearningRedeal';
import { saveSettings, loadStats } from '../../../store/persist';
import { PlayingCard } from '../../components/PlayingCard';
import { ActionBar } from '../../components/ActionBar';
import { ZonePad } from '../../components/ZonePad';
import { RulesChip } from '../../components/RulesChip';
import { releaseAnswerFocus, snapshotResult } from '../../handResult';
import { withMissDetail } from './drillMiss';
import type { CellTally } from '../../../store/cellStats';
import { answerTooSoon } from '../../answerBounce';
import { narrateSelfCheckReveal, narrateFlashcardPrompt, narrateAnswerEcho } from '../../../audio/narrate';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { isE2eAudioMode, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import type { ZoneId } from '../../../audio/zones';
import { DrillModeControls } from './DrillModeControls';
import { handCarStatus } from './useAnswerSession';
import { shortCellLabel } from '../../../drills/missHistory';
import { DealToggles } from './DealToggles';
import { HandDeckControls } from './HandDeckControls';
import { scopesFrom } from '../../../drills/handScope';
import { handDeckFor } from './handDeckFor';
import { MarkableHand } from '../../components/MarkableHand';
import { ControlsSummary } from './ControlsSummary';
import { flashSummaryLine } from './summaryLine';
import './drillTiming.css';
import './drillActionBar.css';
import './flashProgress.css';
import { flashProgressLine, goalMetLine, goalsCrossed } from './flashProgress';
import { reviewDoneLine, reviewHeading, reviewStatus, useReviewSession } from './reviewSession';
import './reviewSession.css';
import { KEY_TO_ACTION, drillScreenStyle, formatSigned, randomSeed, zoneLabel } from './handDrillShared';
import { useAnswerInputs, useAnswerKeys, useAnswerSession, useShotClock, useShotClockTimer } from './useAnswerSession';
import {
  DrillChart,
  DrillTopBar,
  FeedbackVerdict,
  LastResult,
  NextBar,
  ReviewDone,
  ReviewStatusLine,
  SelfCheckBanner,
  ShotClockArea,
} from './HandDrillParts';

/* ---------------------------------------------------------------- */
/* Flashcards                                                        */
/* ---------------------------------------------------------------- */

export function FlashcardsView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
  handOver = null,
  onHome,
  onCustomize }: {
  /** Wave M: open the Custom editor and come back here. */
  onCustomize?: () => void;
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
  /** R7 / R5: a review or session deck handed over in memory (Drills takes it). */
  handOver?: FlashHandOver | null;
  /** The review's end state offers Home. */
  onHome?: () => void;
}) {
  const session = useAnswerSession(settings, 'flashcards');
  const {
    eyesFree,
    voiceOn,
    audio,
    feedback,
    feedbackRef,
    showChart,
    setShowChart,
    runIdRef,
    promptShownAtRef,
    answerClockRef,
    clockGraceRef,
    lastResult,
    nextResultId,
    showResult,
    clearWrongTap,
  } = session;
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
  // E2 (drills/learningRedeal.ts): a missed cell is dealt again 3-6 cards on,
  // in a review too, and sits out the draw until then.
  const learning = useLearningRedeal();
  const drawFrom = (drill: Settings['drill'], previous: string | null): Flashcard | null => {
    const deck = review.active ? reviewDeckFor(previous) : handDeckFor(drill, activeProfile);
    if (deck.ids.length === 0) return null;
    const drawn = drawFlashcard(
      deck.scopes,
      srDeckRef.current,
      Date.now(),
      randomSeed(),
      activeProfile.rules,
      drill.flashByConfusability,
      previous,
      deck.weights,
      {
        // A review asks the cell itself: no count (an index answer would be
        // reviewed in the quiz deck and leave the cell due), no fallback deal.
        ...(review.active ? { fallbacks: false, withCount: false } : flashOptionsFor(drill, eyesFree)),
        ...redealOptions(learning.plan(deck.ids)),
      },
    );
    learning.dealt(drawn.cellId);
    return drawn;
  };
  /** E2: how many cells a miss's re-deal gap is measured against. */
  const learningPoolSize = () => (review.active ? review.pool(null).length : handDeckFor(settings.drill, activeProfile).ids.length);
  const [card, setCard] = useState<Flashcard>(
    // The gate only mounts this view on a non-empty deck; the chart draw is
    // a backstop, never the expected path.
    () => drawFrom(settings.drill, null) ?? drawFlashcard('all', srDeckRef.current, Date.now(), randomSeed(), activeProfile.rules),
  );

  // Review fix (b): set when a spoken correction is still playing as the next
  // card is dealt, so that card's prompt queues behind it.
  const promptQueuesRef = useRef(false);

  // R1's shot clock (drills/shotClock.ts, useAnswerSession.ts).
  const clock = useShotClock(settings, eyesFree, voiceOn);
  const { shotClockMs, clockSuspended, clockIdle } = clock;

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
    session.clearAdvanceTimer();
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
    session.resetAnswer();
    session.restartClocks();
  };

  // R7: the end of a review. Said out loud too: in the car nothing else says
  // that the dealing has stopped.
  const finishReview = () => {
    session.clearAdvanceTimer();
    clock.clear();
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

  const handleBack = () => session.leave(onBack, clock.clear);

  const handleRepeat = () => {
    session.speakNow(narrateFlashcardPrompt(card.cards, card.up));
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
    clock.noteAnswered();
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
      learning.isRepeat(card.cellId),
    );
    srDeckRef.current = result.nextDeck;
    indexReviewRef.current = result.indexReview ?? null;
    // R7: a right answer takes the cell out of a review.
    review.answered(card.cellId, result.event.correct);
    // The card just answered is the one not to deal straight back. next()
    // sets this on every draw, but the FIRST card comes from the useState
    // initialiser, which never did -- so a miss on it could be redealt.
    lastCellRef.current = card.cellId;
    learning.answered(card.cellId, result.event.correct, learningPoolSize());
    return { event: result.event, correctAction: result.correctAction, prevSr, cellBefore: result.cellBefore };
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
        // E2: a withdrawn miss is not dealt again either.
        learning.withdraw(cellId);
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

    const spokenMs = session.speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
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
      session.speakNow(gate.announcement!);
      return;
    }

    session.speakNow(narrateAnswerEcho(zoneLabel(zone)));

    const { event, correctAction, prevSr, cellBefore } = gradeFlashcardAnswer(zone, channel);

    const spokenMs = session.speakCorrectionOnceGated(event, session.speakQueued);
    audio.ding(event.correct ? 'good' : 'bad');

    session.completeTimed({ correct: event.correct, correctAction, event }, spokenMs, () => freezeResult(event, prevSr, cellBefore), next);
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
    const elapsedMs = clock.takeExpiry(promptShownAtRef.current, clockGraceRef.current);
    if (elapsedMs === null) return;

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
    // E2: a timeout is a miss, so it is dealt again like one.
    learning.answered(card.cellId, false, learningPoolSize());

    const spokenMs = session.speakCorrectionOnceGated(result.event, (text) =>
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
    session.completeTimed(
      { correct: false, correctAction: result.correctAction, event: result.event },
      spokenMs,
      () => freezeResult(result.event, prevSr, result.cellBefore),
      next,
    );
  };

  useShotClockTimer(clock, session, card, review.done, handleShotClockExpiry);

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

  /*
   * The wheel self-check (useAnswerSession's openSelfCheck). (An earlier
   * comment here refused the wheel on the grounds that this screen renders
   * the count drills as children, so a claim here would steal their presses.
   * It does not: `Drills` renders them itself, as siblings, and only one is
   * ever mounted. The other half of that refusal -- one button cannot pick
   * one of five plays -- was right, and is why this is a self-check rather
   * than an answer.)
   */
  const revealForSelfCheck = () => session.openSelfCheck(narrateSelfCheckReveal(card.correct));

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
    const spokenMs = session.speakCorrectionOnceGated(event, session.speakQueued);
    audio.ding(event.correct ? 'good' : 'bad');
    session.completeTimed({ correct: event.correct, correctAction, event }, spokenMs, () => freezeResult(event, prevSr, cellBefore), next);
  };

  const voice = useAnswerInputs({
    settings,
    context: 'flashcards',
    session,
    isDone: () => review.doneRef.current,
    promptKey: card,
    onRepeat: handleRepeat,
    onReveal: revealForSelfCheck,
    onSelfReport: submitSelfReport,
    onNext: () => next(),
    onVoiceAction: handleVoiceAction,
  });

  // Desktop keyboard input (operator request): number keys 1-5 feed the SAME
  // handler a tap on that action would use -- handleAction in visual mode,
  // handleZoneAnswer in eyes-free mode (so the eyes-free zone-name echo/audio
  // path is identical to a real zone tap, and visual-mode grading/audio is
  // identical to an ActionBar click).
  useAnswerKeys({
    feedback,
    eyesFree,
    itemKey: card,
    showChart,
    isDone: () => review.doneRef.current,
    onNext: () => next(),
    onAnswerKey: (e) => {
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
    },
  });

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
    <div
      className="drill-screen"
      style={drillScreenStyle(session.padTop)}
      // ?e2e=1 only: the card's SR key, so a spec can see a re-deal (E2).
      data-item-key={isE2eAudioMode() ? card.cellId : undefined}
    >
      <DrillTopBar
        title={review.active ? reviewHeading(reviewSource, review.total) : 'Flashcards'}
        onBack={handleBack}
        audioEnabled={settings.audio.enabled}
        onReplay={audio.replay}
      />

      <div className="drill-inline-controls" ref={session.controlsRef}>
        {/* R7 (#40, #41): a review deals its own cells, so the saved deck's
            controls and goal line would describe something else -- and a tap
            on them would rewrite the saved deck. A status line instead. */}
        {review.active ? (
          <ReviewStatusLine text={reviewStatus(reviewSource, review.total, review.left, reviewNoun)} />
        ) : (
          <>
            {/* W2-7: folded into one line once the first answer is in. */}
            <ControlsSummary
              answered={lastResult !== null}
              summary={flashSummaryLine(settings.drill, activeProfile.rules, progressStats)}
            >
              <HandDeckControls settings={settings} onChange={changeScopes} onCustomize={onCustomize} />
              <div className="flash-progress" data-testid="flash-progress">
                {flashProgressLine(progressStats, scopesFrom(settings.drill))}
              </div>
            </ControlsSummary>
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
          onEyesFreeChange={session.changeEyesFree}
          voiceSupported={session.voiceSupported}
          voiceOn={voiceOn}
          onVoiceChange={session.setVoiceOn}
          voiceStatus={voice.status}
          car={handCarStatus(session, settings.drill.wheelMode, shortCellLabel(card.cellId) + (card.tc !== undefined ? ` · TC ${formatSigned(card.tc)}` : ''), voice.status.state)}
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

      <ShotClockArea clock={clock} session={session} />

      <div className="message-strip">
        {session.selfCheckOpen && !feedback && (
          <SelfCheckBanner testId="flash-selfcheck" label={zoneLabel(card.correct)} />
        )}
        {feedback && (
          <>
            <FeedbackVerdict
              feedback={feedback}
              eyesFree={eyesFree}
              onShowTable={() => session.openChartOnFeedback(card.cards, card.up, feedback.event)}
            />
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
        {!feedback && !session.selfCheckOpen && !eyesFree && lastResult && (
          <LastResult session={session} result={lastResult} />
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
        <NextBar onNext={() => next()} />
      )}
      <DrillChart session={session} activeProfile={activeProfile} />
    </div>
  );
}
