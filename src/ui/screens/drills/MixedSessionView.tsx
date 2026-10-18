import { useEffect, useRef, useState } from 'react';
import { strategyRulesFor } from '../../../store/profiles';
import type { Profile, Settings } from '../../../store/types';
import type { Action, DeviationId } from '../../../engine/deviations';
import type { GradedEvent } from '../../../engine/grade';
import { flashCtx } from '../../../drills/flashcards';
import type { Flashcard } from '../../../drills/flashcards';
import { flashOptionsFor } from '../../../drills/flashOptions';
import { drillLegalActions, rulesChipLabels } from '../../../drills/legalActions';
import { gateDrillAnswer, gateQuizAnswer } from '../../../drills/answerGate';
import { askedIndexSet, drawQuizItem, quizLegalActions, quizRulesChip, tableMaskNote } from '../../../drills/deviationQuiz';
import type { QuizItem } from '../../../drills/deviationQuiz';
// R4: the ONE shared grade path (see FlashcardsView / src/drills/gradeAnswer.ts).
import {
  gradeFlashcardAnswer as gradeFlashcard,
  gradeQuizAnswer as gradeQuiz,
  loadFlashSr,
  loadQuizSr,
  saveFlashSr,
  saveQuizSr,
  SELF_REPORT_HAD,
  SELF_REPORT_MISSED } from '../../../drills/gradeAnswer';
import type { SrCard, SrDeck } from '../../../drills/spacedRepetition';
import { restoreSrCard, SCREEN_CHANNEL } from '../../../drills/spacedRepetition';
import { drawMixedFlashcard, mixedFlashLabel, mixedPrompt, pickMixedType } from '../../../drills/mixedSession';
import type { MixedItemType } from '../../../drills/mixedSession';
import { keysOfDeck } from '../../../drills/learningRedeal';
import { useLearningRedeal } from './useLearningRedeal';
import { ActionBar } from '../../components/ActionBar';
import { ZonePad } from '../../components/ZonePad';
import { RulesChip } from '../../components/RulesChip';
import { releaseAnswerFocus, snapshotResult } from '../../handResult';
import { withMissDetail } from './drillMiss';
import type { CellTally } from '../../../store/cellStats';
import { answerTooSoon } from '../../answerBounce';
import { narrateAnswerEcho, DID_YOU_HAVE_IT } from '../../../audio/narrate';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { isE2eAudioMode, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import type { ZoneId } from '../../../audio/zones';
import { DrillModeControls } from './DrillModeControls';
import { handCarStatus } from './useAnswerSession';
import { handText } from '../../handResult';
import { shortCellLabel } from '../../../drills/missHistory';
import { DealToggles } from './DealToggles';
import { HandDeckControls } from './HandDeckControls';
import { handDeckFor } from './handDeckFor';
import { ControlsSummary } from './ControlsSummary';
import { mixedSummaryLine } from './summaryLine';
import './drillTiming.css';
import './drillActionBar.css';
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
import { insuranceKey, useAnswerInputs, useAnswerKeys, useAnswerSession } from './useAnswerSession';
import {
  DealtHand,
  DrillChart,
  DrillTopBar,
  FeedbackVerdict,
  InsuranceBar,
  LastResult,
  NextBar,
  SelfCheckBanner,
} from './HandDrillParts';

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

/** E2: a Mixed item's key in the session's one re-deal queue -- its deck, then its SR key. */
function mixedKey(c: MixedCurrent): string | null {
  if (c.type === 'flash') return `flash:${c.card.cellId}`;
  return c.item.deviationId ? `quiz:${c.item.deviationId}` : null;
}

export function MixedSessionView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange }: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  // Voice and the wheel, on the same terms as the two standalone views. A
  // mixed session is the one an operator runs in the car for twenty minutes,
  // and it had neither.
  const session = useAnswerSession(settings, 'mixed-session');
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
    lastResult,
    nextResultId,
    showResult,
    clearWrongTap,
  } = session;
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
  // E2 (drills/learningRedeal.ts): one re-deal queue for both kinds of item,
  // keyed "flash:<cell>" / "quiz:<index>" (mixedKey). A due re-deal beats the
  // type coin as well as the weighted draw, so a miss is back 3-6 items on.
  const learning = useLearningRedeal();

  // V5-1: same confusable-neighbour bias as the flashcards drill. The chain is
  // over FLASHCARDS only -- a quiz item in between does not reset it, since the
  // confusion being trained is between chart cells, not between drill types.
  // B2: from the deck the settings describe; null when it is empty.
  // E1: at a true count where no index applies (drawMixedFlashcard), so it
  // shows a count like an index item does.
  const drawMixedFlash = (
    drill: Settings['drill'],
    redeal: { redeal?: string; exclude?: ReadonlySet<string> },
  ): Flashcard | null => {
    const deck = handDeckFor(drill, activeProfile);
    if (deck.ids.length === 0) return null;
    const drawn = drawMixedFlashcard({
      scopes: deck.scopes,
      srDeck: flashSrRef.current,
      now: Date.now(),
      seed: randomSeed(),
      rules: activeProfile.rules,
      countRules: strategyRulesFor(activeProfile),
      byConfusability: drill.flashByConfusability,
      previousCellId: mixedLastCellRef.current,
      deckWeights: deck.weights,
      // #27: fallbacks only -- the count is Mixed's own, never With count's.
      options: { fallbacks: flashOptionsFor(drill, eyesFree).fallbacks, ...redeal },
    });
    mixedLastCellRef.current = drawn.cellId;
    return drawn;
  };

  /** The quiz half's pool: the pinned index, or every index the drills ask. */
  const mixedQuizIds = (): string[] => {
    const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);
    return activeFilter === 'all' ? askedIndexSet(strategyRulesFor(activeProfile)).map((d) => d.id) : [activeFilter];
  };
  /** Every item either half can deal, as re-deal keys. */
  const mixedPoolIds = (drill: Settings['drill'] = settings.drill): string[] => [
    ...handDeckFor(drill, activeProfile).ids.map((id) => `flash:${id}`),
    ...mixedQuizIds().map((id) => `quiz:${id}`),
  ];

  const drawQuizHalf = (redealId: string | null, exclude: ReadonlySet<string>): QuizItem => {
    const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);
    return drawQuizItem(
      randomSeed(),
      // E2: a due re-deal is the real index, never a fake near it.
      redealId !== null ? (redealId as DeviationId) : quizFilterArg(activeFilter),
      // THE SAME RULES THE FILTER WAS VALIDATED AGAINST, two lines up.
      // `getActiveQuizFilter` uses `strategyRulesFor`, so with surrender
      // indices on it accepts `sur15v10` -- and passing the bare rules
      // here handed that id to a draw whose index set does not contain
      // it. `drawQuizItem` throws on an unknown id, and this call is a
      // `useState` initialiser, so the throw took the whole screen.
      strategyRulesFor(activeProfile),
      redealId !== null ? 0 : settings.drill.quizDistractorPct,
      quizSrRef.current,
      Date.now(),
      exclude,
    );
  };

  const drawFor = (type: MixedItemType): MixedCurrent => {
    const plan = learning.plan(mixedPoolIds());
    let drawn: MixedCurrent | null = null;
    if ('redeal' in plan) {
      const cut = plan.redeal.indexOf(':');
      const id = plan.redeal.slice(cut + 1);
      if (plan.redeal.slice(0, cut) === 'flash') {
        const card = drawMixedFlash(settings.drill, { redeal: id });
        if (card) drawn = { type: 'flash', card };
      } else {
        drawn = { type: 'quiz', item: drawQuizHalf(id, new Set()) };
      }
    }
    if (!drawn) {
      const exclude = 'exclude' in plan ? plan.exclude : new Set<string>();
      // An empty basic-strategy deck deals the index item instead; the gate
      // replaces the screen on the same render anyway.
      const card = type === 'flash' ? drawMixedFlash(settings.drill, { exclude: keysOfDeck(exclude, 'flash') }) : null;
      drawn = card ? { type: 'flash', card } : { type: 'quiz', item: drawQuizHalf(null, keysOfDeck(exclude, 'quiz')) };
    }
    // A distractor has no key: one more item between, nothing else.
    learning.dealt(mixedKey(drawn) ?? '');
    return drawn;
  };

  const [current, setCurrent] = useState<MixedCurrent>(() => drawFor(pickMixedType(sessionSeed(), 0)));

  const isInsuranceItem = current.type === 'quiz' && current.item.cards === null;

  // E1: one prompt builder for both kinds, count included (mixedPrompt).
  const promptFor = (c: MixedCurrent): string => mixedPrompt(c);

  // Narrate each new item. Eyes-free speaks every item (its primary output
  // channel); visual mode speaks it through the quiz's verbosity-gated
  // sayFull. E1: the same sentence, count included, for both kinds -- a
  // flashcard used to be the one item that stayed silent and countless,
  // which told the ear what the eye was no longer being told.
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
    } else {
      audio.sayFull(promptFor(current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, eyesFree, voiceOn]);

  const next = () => {
    runIdRef.current += 1;
    session.resetAnswerRefs();
    session.clearAdvanceTimer();
    // Advancing invalidates the correction the chart was opened for, so the
    // overlay must not survive it: left open it re-pointed at the NEW card
    // (its cards/dealerUp are live props), and the learner closed it onto a
    // hand they had never been asked about.
    setShowChart(false);
    const idx = itemIndexRef.current + 1;
    itemIndexRef.current = idx;
    setCurrent(drawFor(pickMixedType(sessionSeed(), idx)));
    session.resetAnswer();
    session.restartClocks();
  };

  // #13: a basic-strategy hand still waiting for its answer is re-dealt
  // from the new scope, as in Flashcards; a quiz item, or an answered hand,
  // is left alone and the next draw follows the new scope.
  const changeScopes = (nextSettings: Settings) => {
    onSettingsChange(nextSettings);
    if (current.type === 'flash' && !feedbackRef.current) {
      // E2: the cells still waiting for a re-deal sit this draw out too.
      const plan = learning.plan(mixedPoolIds(nextSettings.drill));
      const exclude = keysOfDeck('exclude' in plan ? plan.exclude : [], 'flash');
      const card = drawMixedFlash(nextSettings.drill, { exclude });
      if (!card) return; // empty deck: HandDeckGate takes the screen
      learning.dealt(`flash:${card.cellId}`);
      setCurrent({ type: 'flash', card });
      session.restartClocks();
    }
  };

  const handleBack = () => session.leave(onBack);

  const handleRepeat = () => {
    session.speakNow(promptFor(current));
  };

  // THE shared grade path (R4): dispatch to gradeFlashcard or gradeQuiz by the
  // current item's type -- byte-identical to what the standalone views call.
  // R1 latency captured here; R3 weights + Stats write happen inside.
  const gradeCurrent = (taken: string): { correct: boolean; correctAction?: Action; event: GradedEvent } => {
    const elapsedMs = performance.now() - answerClockRef.current;
    clearWrongTap();
    // E2: the item's re-deal key, and whether the last answer was to it too.
    const itemKey = mixedKey(current);
    const repeat = itemKey !== null && learning.isRepeat(itemKey);
    if (current.type === 'flash') {
      // #22: the card's schedule before this answer, for "Wrong tap".
      const key = current.card.cellId;
      prevSrRef.current = { deck: 'flash', key, prev: flashSrRef.current[key] };
      const result = gradeFlashcard(
        current.card, taken as Action, activeProfile.rules, elapsedMs, flashSrRef.current, Date.now(),
        SCREEN_CHANNEL, undefined, repeat,
      );
      flashSrRef.current = result.nextDeck;
      cellBeforeRef.current = result.cellBefore;
      // E1: with a count on the card, a phantom deviation is index knowledge
      // (R9) and was reviewed in the QUIZ deck under that index (F4b), which
      // the grader wrote straight to storage. The quiz ref is re-read, or the
      // next quiz answer would save over it, and Wrong tap puts back the
      // index's card rather than the untouched cell's.
      if (result.indexReview) {
        quizSrRef.current = loadQuizSr();
        prevSrRef.current = { deck: 'quiz', key: result.indexReview.key, prev: result.indexReview.prev };
      }
      learning.answered(itemKey, result.event.correct, mixedPoolIds().length);
      return { correct: result.event.correct, correctAction: result.correctAction, event: result.event };
    }
    const quizKey = current.item.deviationId;
    prevSrRef.current = quizKey ? { deck: 'quiz', key: quizKey, prev: quizSrRef.current[quizKey] } : null;
    // ...AND GRADED AGAINST THEM TOO. The standalone quiz grades with
    // `strategyRulesFor`; grading a surrender index with the bare rules
    // marks a correct surrender wrong.
    const result = gradeQuiz(
      current.item, taken, strategyRulesFor(activeProfile), elapsedMs, quizSrRef.current, Date.now(),
      SCREEN_CHANNEL, undefined, repeat,
    );
    quizSrRef.current = result.nextDeck;
    cellBeforeRef.current = result.cellBefore;
    learning.answered(itemKey, result.event.correct, mixedPoolIds().length);
    return { correct: result.event.correct, event: result.event };
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
            // E1: asked at a count, so frozen with it, and labelled the way
            // a quiz item is.
            { cards: current.card.cards, up: current.card.up, tc: current.card.tc ?? null },
            { cellId: current.card.cellId, label: mixedFlashLabel(current.card, strategyRulesFor(activeProfile)) },
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
    const answeredKey = mixedKey(current);
    showResult(withMissDetail(snapshot, event, cellBeforeRef.current ?? null, activeProfile.rules), event, () => {
      // E2: a withdrawn miss is not dealt again either.
      if (answeredKey !== null) learning.withdraw(answeredKey);
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
    session.speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(correct ? 'good' : 'bad');
    advanceWithResult(event);
  };

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

  const handleZoneAnswer = (zone: ZoneId | 'take' | 'decline') => {
    // Insurance items expose only take/decline zones; every other item the
    // five action zones. Reject a mode/zone mismatch, exactly as the
    // standalone quiz view does.
    if (isInsuranceItem !== (zone === 'take' || zone === 'decline')) return;
    // Review fix (c): a bounce on the pad, not an answer to this item.
    if (answerTooSoon(promptShownAtRef.current)) return;
    const taken = zoneToTaken(zone);

    // A1: the ZonePad has no disabled state, so an unavailable action must be
    // REFUSED and said out loud. Silence is indistinguishable from a dead app,
    // and letting it through would grade a play that cannot exist -- into
    // Stats and the spaced-repetition deck both.
    const gate = gateCurrent(taken);
    if (!gate.accepted) {
      session.speakNow(gate.announcement!);
      return;
    }

    session.speakNow(narrateAnswerEcho(zoneLabel(zone)));

    const { correct, correctAction, event } = gradeCurrent(taken);
    const spokenMs = session.speakCorrectionOnceGated(event, session.speakQueued);
    audio.ding(correct ? 'good' : 'bad');
    session.completeTimed({ correct, correctAction, event }, spokenMs, () => freezeResult(event), next);
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
  const answerLabel = (): string =>
    answerLabelFor(current.type === 'flash' ? current.card.correct : current.item.correct);

  /**
   * The wheel's self-check. Both item types grade it through their own
   * shared path -- `gradeFlashcard` has taken the two markers since the
   * shape shipped, and `gradeQuiz` learned them for this.
   */
  const revealForSelfCheck = () => session.openSelfCheck(`${narrateAnswerEcho(answerLabel())} ${DID_YOU_HAVE_IT}`);

  const submitSelfReport = (had: boolean) => {
    const { correct, correctAction, event } = gradeCurrent(
      had ? SELF_REPORT_HAD : SELF_REPORT_MISSED,
    );
    const spokenMs = session.speakCorrectionOnceGated(event, session.speakQueued);
    audio.ding(correct ? 'good' : 'bad');
    session.completeTimed({ correct, correctAction, event }, spokenMs, () => freezeResult(event), next);
  };

  const voice = useAnswerInputs({
    settings,
    context: 'mixed-session',
    session,
    isDone: () => false,
    promptKey: current,
    onRepeat: handleRepeat,
    onReveal: revealForSelfCheck,
    onSelfReport: submitSelfReport,
    onNext: () => next(),
    onVoiceAction: handleVoiceAction,
  });

  // Keyboard: identical mapping to the standalone views -- 1-5 action keys for
  // flashcard + quiz-action items, 1=Take/2=Decline for quiz insurance items,
  // Enter/Space to advance past feedback. Routed to the eyes-free or visual
  // handler so grading/audio can't drift from a real tap.
  useAnswerKeys({
    feedback,
    eyesFree,
    itemKey: current,
    showChart,
    isDone: () => false,
    onNext: () => next(),
    onAnswerKey: (e) => {
      if (isInsuranceItem) {
        insuranceKey(e, eyesFree, handleZoneAnswer, handleAnswer);
        return;
      }

      const action = KEY_TO_ACTION[e.key];
      if (!action) return;
      e.preventDefault();
      // Same legality gate as the ActionBar buttons -- see FlashcardsView.
      if (eyesFree) handleZoneAnswer(action);
      else if (gateCurrent(action).accepted) handleAnswer(action);
    },
  });

  const currentTc = current.type === 'flash' ? (current.card.tc ?? 0) : current.item.tc;
  // A quiz item answers to the ctx it was drawn under, exactly as in the
  // standalone quiz; a flashcard is an ordinary hand.
  const legal =
    current.type === 'quiz'
      ? quizLegalActions(current.item, strategyRulesFor(activeProfile))
      : drillLegalActions(handCards ?? [], activeProfile.rules, dealerUp, current.card.ctx);

  return (
    <div
      className="drill-screen"
      style={drillScreenStyle(session.padTop)}
      // E1: which kind of item this is, for specs only -- the screen no longer says.
      data-item-type={current.type}
      data-correct={isE2eAudioMode() ? (current.type === 'flash' ? current.card.correct : current.item.correct) : undefined}
      data-item-key={isE2eAudioMode() ? (mixedKey(current) ?? 'distractor') : undefined}
    >
      <DrillTopBar title="Mixed" onBack={handleBack} audioEnabled={settings.audio.enabled} onReplay={audio.replay} />

      <div className="drill-inline-controls" ref={session.controlsRef}>
        {/* W2-7: folded into one line once the first answer is in. */}
        <ControlsSummary answered={lastResult !== null} summary={mixedSummaryLine(settings.drill, activeProfile.rules)}>
          <HandDeckControls settings={settings} onChange={changeScopes} />
        </ControlsSummary>
        <DrillModeControls
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onEyesFreeChange={session.changeEyesFree}
          voiceSupported={session.voiceSupported}
          voiceOn={voiceOn}
          onVoiceChange={session.setVoiceOn}
          voiceStatus={voice.status}
          car={handCarStatus(session, settings.drill.wheelMode, current.type === 'flash' ? shortCellLabel(current.card.cellId) : `${handText(current.item.cards, current.item.up)} · TC ${formatSigned(current.item.tc)}`, voice.status.state)}
          // #27: set once, folded away like the flashcards' options.
          options={<DealToggles settings={settings} onChange={changeScopes} />}
        />
      </div>

      {/* E1: every item shows its true count, in the same place. A flashcard
          used to show none, which told the learner which regime applied
          before they had to work it out -- the judgment Mixed trains. */}
      <div className="quiz-tc">TC {formatSigned(currentTc)}</div>
      {/* #26: the rules this item is graded under, before the answer. */}
      <RulesChip
        labels={
          current.type === 'quiz'
            ? quizRulesChip(current.item, strategyRulesFor(activeProfile))
            : rulesChipLabels(flashCtx(current.card), activeProfile.rules, current.card)
        }
      />

      <DealtHand cards={handCards} up={dealerUp} />

      <div className="message-strip">
        {session.selfCheckOpen && !feedback && <SelfCheckBanner testId="mixed-selfcheck" label={answerLabel()} />}
        {feedback && (
          <>
            <FeedbackVerdict
              feedback={feedback}
              eyesFree={eyesFree}
              onShowTable={handCards ? () => session.openChartOnFeedback(handCards, dealerUp, feedback.event) : undefined}
            />
            {/* E1: one label shape for both kinds -- a flashcard reads like the
                quiz's own "no index applies" item, which is what it is. */}
            <div className="quiz-label" data-cell-id={current.type === 'flash' ? current.card.cellId : undefined}>
              {current.type === 'flash'
                ? mixedFlashLabel(current.card, strategyRulesFor(activeProfile))
                : current.item.label}
            </div>
          </>
        )}
        {!feedback && !session.selfCheckOpen && !eyesFree && lastResult && (
          <LastResult session={session} result={lastResult} />
        )}
      </div>

      {!feedback ? (
        eyesFree ? (
          <ZonePad
            mode={isInsuranceItem ? 'insurance' : 'action'}
            onAnswer={handleZoneAnswer}
            onRepeat={handleRepeat}
            visible={!settings.audio.dimZones}
            legal={legal}
          />
        ) : isInsuranceItem ? (
          <InsuranceBar onAnswer={handleAnswer} />
        ) : (
          <ActionBar mode={{ kind: 'actions', legal, onAction: handleAnswer }} />
        )
      ) : (
        <NextBar onNext={() => next()} />
      )}
      <DrillChart session={session} activeProfile={activeProfile} />
    </div>
  );
}
