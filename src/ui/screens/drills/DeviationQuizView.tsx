import { useEffect, useRef, useState } from 'react';
import { strategyRulesFor } from '../../../store/profiles';
import type { Profile, Settings } from '../../../store/types';
import type { DeviationId } from '../../../engine/deviations';
import { indexSetFor } from '../../../engine/deviations';
import type { GradedEvent } from '../../../engine/grade';
import { indexPickerText } from '../../../drills/withCount';
import { gateQuizAnswer } from '../../../drills/answerGate';
import { askedIndexSet, drawQuizItem, quizLegalActions, quizRulesChip, redundantForChart, tableMaskNote } from '../../../drills/deviationQuiz';
import type { QuizItem } from '../../../drills/deviationQuiz';
// R4: the ONE shared grade path (see FlashcardsView / src/drills/gradeAnswer.ts).
import {
  gradeQuizAnswer as gradeQuiz,
  loadQuizSr,
  saveQuizSr,
  TIMEOUT_ANSWER,
  SELF_REPORT_HAD,
  SELF_REPORT_MISSED } from '../../../drills/gradeAnswer';
import { answeredUnderShotClock, answerElapsedMs, readGraceMs } from '../../../drills/shotClock';
import type { SrCard, SrDeck } from '../../../drills/spacedRepetition';
import { restoreSrCard, BLIND_TAP_CHANNEL, SCREEN_CHANNEL, VOICE_CHANNEL } from '../../../drills/spacedRepetition';
import type { AnswerChannel } from '../../../drills/spacedRepetition';
import { useLearningRedeal } from './useLearningRedeal';
import { saveSettings } from '../../../store/persist';
import { ActionBar } from '../../components/ActionBar';
import { ZonePad } from '../../components/ZonePad';
import { RulesChip } from '../../components/RulesChip';
import { releaseAnswerFocus, snapshotResult } from '../../handResult';
import { withMissDetail } from './drillMiss';
import type { CellTally } from '../../../store/cellStats';
import { answerTooSoon } from '../../answerBounce';
import { Segmented } from '../Settings';
import { narrateQuizPrompt, narrateAnswerEcho, DID_YOU_HAVE_IT } from '../../../audio/narrate';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { isE2eAudioMode, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import type { ZoneId } from '../../../audio/zones';
import { DrillModeControls } from './DrillModeControls';
import { QuizAskSwitch } from './QuizAskSwitch';
import { blurAfterChange } from '../../keyboardFocus';
import { ControlsSummary } from './ControlsSummary';
import { quizSummaryLine } from './summaryLine';
import './drillTiming.css';
import './drillActionBar.css';
import { reviewDoneLine, reviewHeading, reviewStatus, useReviewSession } from './reviewSession';
import './reviewSession.css';
import {
  KEY_TO_ACTION,
  answerLabelFor,
  drillScreenStyle,
  formatSigned,
  getActiveQuizFilter,
  quizFilterArg,
  randomSeed,
  zoneLabel,
  zoneToTaken,
} from './handDrillShared';
import {
  insuranceKey,
  useAnswerInputs,
  useAnswerKeys,
  useAnswerSession,
  useShotClock,
  useShotClockTimer,
} from './useAnswerSession';
import {
  DealtHand,
  DrillChart,
  DrillTopBar,
  FeedbackVerdict,
  InsuranceBar,
  LastResult,
  NextBar,
  ReviewDone,
  ReviewStatusLine,
  SelfCheckBanner,
  ShotClockArea,
} from './HandDrillParts';

/* ---------------------------------------------------------------- */
/* Deviation Quiz                                                     */
/* ---------------------------------------------------------------- */

export function DeviationQuizView({
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

  const session = useAnswerSession(settings, 'deviation-quiz');
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
  // E2 (drills/learningRedeal.ts): a missed index is asked again 3-6 items
  // on (pool - 1 when fewer than four can be asked), in a review too.
  const learning = useLearningRedeal();
  /** The indexes a draw may ask: the review's, the pinned one, or every asked index. */
  const quizPoolIds = (filter: DeviationId | 'all'): string[] =>
    review.active
      ? review.pool(lastIndexRef.current)
      : filter === 'all'
        ? askedIndexSet(strategyRulesFor(activeProfile)).map((d) => d.id)
        : [filter];
  const drawItem = (filter: DeviationId | 'all', distractorPct: number): QuizItem | null => {
    const drawn = drawQuizFor(filter, distractorPct);
    // A distractor has no index: it is one more item between, nothing else.
    if (drawn) learning.dealt(drawn.deviationId ?? '');
    return drawn;
  };
  const drawQuizFor = (filter: DeviationId | 'all', distractorPct: number): QuizItem | null => {
    const poolIds = quizPoolIds(filter);
    const plan = learning.plan(poolIds);
    // A due re-deal is the real index, never a fake near it.
    if ('redeal' in plan) {
      return drawQuizItem(randomSeed(), plan.redeal as DeviationId, strategyRulesFor(activeProfile), 0, srDeckRef.current, Date.now());
    }
    if (review.active) {
      if (poolIds.length === 0) return null;
      const open = poolIds.filter((id) => !plan.exclude.has(id));
      const pool = open.length > 0 ? open : poolIds;
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
      plan.exclude,
    );
  };
  /** E2: how many indexes a miss's re-deal gap is measured against. */
  const learningPoolSize = () => (review.active ? review.pool(null).length : quizPoolIds(activeFilter).length);
  const [item, setItem] = useState<QuizItem>(() => {
    const first = drawItem(activeFilter, settings.drill.quizDistractorPct)!;
    lastIndexRef.current = first.deviationId ?? null;
    return first;
  });

  // R1's shot clock -- identical plumbing to FlashcardsView's, deliberately:
  // both drills ask the same question of the same limit, and the shared
  // TIMEOUT_ANSWER means neither can invent its own idea of what a timeout is.
  const clock = useShotClock(settings, eyesFree, voiceOn);
  const { shotClockMs, clockSuspended, clockIdle } = clock;

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

  const next = (filter: DeviationId | 'all' = activeFilter, distractorPct: number = settings.drill.quizDistractorPct) => {
    runIdRef.current += 1;
    session.resetAnswerRefs();
    session.clearAdvanceTimer();
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
    session.resetAnswer();
    session.restartClocks();
  };

  // R7: the end of an index review, said out loud as well.
  const finishReview = () => {
    session.clearAdvanceTimer();
    clock.clear();
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

  const handleBack = () => session.leave(onBack, clock.clear);

  const handleRepeat = () => {
    session.speakNow(narrateQuizPrompt(item.cards, item.up, item.tc));
  };

  // Shared grading core (R4): the SAME gradeQuiz function backs the visual
  // buttons (ActionBar / Take-Decline), the eyes-free ZonePad taps, AND the
  // mixed-session view. R1 latency is captured here; R3 index weights
  // (real items only) + the Stats write happen inside gradeQuiz. No audio,
  // no setState -- callers layer their own feedback on top.
  const gradeQuizAnswer = (taken: string, channel: AnswerChannel = SCREEN_CHANNEL): GradedEvent => {
    // Wave A review: reading a miss's correction is not answer time.
    const elapsedMs = answerElapsedMs(performance.now() - answerClockRef.current, clockGraceRef.current);
    // Somebody is there: an answer restarts a clock stopped for idleness.
    if (taken !== TIMEOUT_ANSWER) clock.noteAnswered();
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
      answeredUnderShotClock(shotClockMs, clockSuspended, clockIdle), // V5-2: see the flashcard grader.
      srKey !== undefined && learning.isRepeat(srKey),
    );
    srDeckRef.current = result.nextDeck;
    cellBeforeRef.current = result.cellBefore;
    // R7: a right answer takes the index out of a review.
    review.answered(item.deviationId, result.event.correct);
    learning.answered(srKey ?? null, result.event.correct, learningPoolSize());
    return result.event;
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
        // E2: a withdrawn miss is not asked again either.
        learning.withdraw(prevSr.key);
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

    session.speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
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
    if (clock.takeExpiry(promptShownAtRef.current, clockGraceRef.current) === null) return;

    const event = gradeQuizAnswer(TIMEOUT_ANSWER);
    const spokenMs = session.speakCorrectionOnceGated(event, (text) =>
      eyesFree ? speak(text, speechOptsFrom(settings.audio)) : audio.say(text, { interrupt: true }),
    );
    audio.ding('bad');
    // Visual mode: to the strip, next item at once -- see FlashcardsView.
    if (!eyesFree && !voiceOn) {
      advanceWithResult(event);
      return;
    }
    session.completeTimed({ correct: false, event }, spokenMs, () => freezeResult(event), next);
  };

  useShotClockTimer(clock, session, item, review.done, handleShotClockExpiry);

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

    const taken = zoneToTaken(zone);

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    // The QUIZ gate, not the table gate: see drills/answerGate.ts. The
    // ActionBar has disabled out-of-question actions since RV3, and this
    // path -- the blind one -- was still grading them.
    const gate = gateQuizAnswer(taken, item, strategyRulesFor(activeProfile));
    if (!gate.accepted) {
      session.speakNow(gate.announcement!);
      return;
    }

    session.speakNow(narrateAnswerEcho(zoneLabel(zone)));

    // BLIND_TAP by default -- eyes off the screen, hand on the glass -- and
    // VOICE when the answer was spoken, which is a harder channel and caps
    // the SR promotion differently (drills/spacedRepetition.ts).
    const event = gradeQuizAnswer(taken, channel);

    const spokenMs = session.speakCorrectionOnceGated(event, session.speakQueued);
    audio.ding(event.correct ? 'good' : 'bad');

    session.completeTimed({ correct: event.correct, event }, spokenMs, () => freezeResult(event), next);
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
  const answerLabel = (): string => answerLabelFor(item.correct);

  /**
   * The wheel's self-check, the same shape FlashcardsView runs: a quiz answer
   * is a five-way choice and the wheel has two buttons, so it cannot state a
   * play -- but "did you have it" is binary. `SELF_REPORT_HAD/MISSED` carry it
   * through the shared grade path, which learned to grade them for this.
   */
  const revealForSelfCheck = () => session.openSelfCheck(`${narrateAnswerEcho(answerLabel())} ${DID_YOU_HAVE_IT}`);

  const submitSelfReport = (had: boolean) => {
    // SCREEN_CHANNEL, not the channel the press physically was: the app
    // checked nothing, so grading a self-report on its delivery would earn
    // the highest SR cap for the weakest evidence. See FlashcardsView.
    const event = gradeQuizAnswer(had ? SELF_REPORT_HAD : SELF_REPORT_MISSED, SCREEN_CHANNEL);
    const spokenMs = session.speakCorrectionOnceGated(event, session.speakQueued);
    audio.ding(event.correct ? 'good' : 'bad');
    session.completeTimed({ correct: event.correct, event }, spokenMs, () => freezeResult(event), next);
  };

  const voice = useAnswerInputs({
    settings,
    context: 'deviation-quiz',
    session,
    isDone: () => review.doneRef.current,
    promptKey: item,
    onRepeat: handleRepeat,
    onReveal: revealForSelfCheck,
    onSelfReport: submitSelfReport,
    onNext: () => next(),
    onVoiceAction: handleVoiceAction,
  });

  const maskNote = tableMaskNote(item, strategyRulesFor(activeProfile));

  // Desktop keyboard input (operator request): number keys feed the SAME
  // handler a tap would use -- handleAnswer in visual mode, handleZoneAnswer
  // in eyes-free mode -- so grading/stats/audio can't drift from a real tap.
  // Action items use the same 1-5 hit/stand/double/split/surrender mapping
  // as FlashcardsView; insurance items (item.cards === null) use
  // 1=Take/2=Decline instead.
  useAnswerKeys({
    feedback,
    eyesFree,
    itemKey: item,
    showChart,
    isDone: () => review.doneRef.current,
    onNext: () => next(),
    onAnswerKey: (e) => {
      if (item.cards === null) {
        insuranceKey(e, eyesFree, handleZoneAnswer, handleAnswer);
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
    },
  });

  // Wave A (s08): indexes the profile's basic chart already plays show as
  // inactive -- the quiz never asks them.
  const indexList = indexSetFor(strategyRulesFor(activeProfile)).map((d) =>
    redundantForChart(d, strategyRulesFor(activeProfile)) ? { ...d, active: false } : d,
  );

  // W2-7: the asked index, as the summary line names it.
  const pinned = activeFilter === 'all' ? undefined : indexList.find((d) => d.id === activeFilter);
  const indexName = pinned ? indexPickerText(pinned) : 'All indices';

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
    <div
      className="drill-screen"
      style={drillScreenStyle(session.padTop)}
      data-correct={isE2eAudioMode() ? item.correct : undefined}
      // ?e2e=1 only: the item's SR key, so a spec can see a re-deal (E2).
      data-item-key={isE2eAudioMode() ? (item.deviationId ?? 'distractor') : undefined}
    >
      <DrillTopBar
        title={review.active ? reviewHeading('review', review.total) : 'Deviation quiz'}
        onBack={handleBack}
        audioEnabled={settings.audio.enabled}
        onReplay={audio.replay}
      />

      <div className="drill-inline-controls" ref={session.controlsRef}>
        {/* R7 (#38, #40): a review asks its own indexes; the saved Ask/Index
            choices would describe something else, and changing them would
            rewrite the saved settings. */}
        {review.active ? (
          <ReviewStatusLine text={reviewStatus('review', review.total, review.left, 'index')} />
        ) : (
        // W2-7: folded into one line once the first answer is in.
        <ControlsSummary answered={lastResult !== null} summary={quizSummaryLine(indexName, activeProfile.rules)}>
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
        </ControlsSummary>
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

      <DealtHand cards={item.cards} up={item.up} />

      {/* Below the hand (or the insurance prompt) and above the answer, the
          same place FlashcardsView puts it. */}
      <ShotClockArea clock={clock} session={session} />

      <div className="message-strip">
        {session.selfCheckOpen && !feedback && <SelfCheckBanner testId="quiz-selfcheck" label={answerLabel()} />}
        {feedback && (
          <>
            <FeedbackVerdict
              feedback={feedback}
              eyesFree={eyesFree}
              onShowTable={item.cards ? () => session.openChartOnFeedback(item.cards, item.up, feedback.event) : undefined}
            />
            <div className="quiz-label">{item.label}</div>
            {/* Which table the question was asked for. Screen only -- see
                tableMaskNote: it is a fact about the cell, not about the
                answer, and the correction is already the longest thing the
                car has to listen to. */}
            {maskNote && <div className="quiz-table-note">{maskNote}</div>}
          </>
        )}
        {!feedback && !session.selfCheckOpen && !eyesFree && lastResult && (
          <LastResult session={session} result={lastResult} />
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
          <InsuranceBar onAnswer={handleAnswer} />
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              legal: quizLegalActions(item, strategyRulesFor(activeProfile)),
              onAction: handleAnswer }}
          />
        )
      ) : (
        <NextBar onNext={() => next()} />
      )}
      <DrillChart session={session} activeProfile={activeProfile} />
    </div>
  );
}
