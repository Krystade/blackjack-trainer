import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Action, DeviationId } from '../../engine/deviations';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17, isIndexActive } from '../../engine/deviations';
import type { GradedEvent } from '../../engine/grade';
import { classifyAction, actionCategory, classifyInsurance } from '../../engine/grade';
import type { PlayContext } from '../../engine/strategy';
import { correctPlay, basicPlay } from '../../engine/strategy';
import type { RuleSet } from '../../engine/ruleset';
import { drawFlashcard } from '../../drills/flashcards';
import type { Flashcard } from '../../drills/flashcards';
import { drawQuizItem } from '../../drills/deviationQuiz';
import type { QuizItem } from '../../drills/deviationQuiz';
import { loadStats, saveStats, saveSettings } from '../../store/persist';
import { applyEvents } from '../../store/stats';
import { PlayingCard } from '../components/PlayingCard';
import { ActionBar } from '../components/ActionBar';
import { ZonePad } from '../components/ZonePad';
import { Segmented } from './Settings';
import { useAudio } from '../../audio/useAudio';
import { narrateCorrection, narrateFlashcardPrompt, narrateQuizPrompt } from '../../audio/narrate';
import { speak } from '../../audio/speech';
import { requestWakeLock, releaseWakeLock } from '../../audio/wakeLock';
import { ZONE_LABEL } from '../../audio/zones';
import type { ZoneId } from '../../audio/zones';
import { CountDrillView } from './drills/CountDrillView';
import { TrueCountDrillView } from './drills/TrueCountDrillView';
import { DeckEstimationView } from './drills/DeckEstimationView';

interface DrillsProps {
  settings: Settings;
  activeProfile: Profile;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: Settings) => void;
}

const ALL_ACTIONS: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

// Desktop keyboard input (operator request): number keys map onto the
// action-zone layout so a keypress grades identically to tapping the
// matching ActionBar button / ZonePad zone. Shared by FlashcardsView and
// DeviationQuizView's action items -- the insurance quiz variant uses its
// own 1=Take/2=Decline mapping instead (see DeviationQuizView's handler).
const KEY_TO_ACTION: Record<string, Action> = {
  '1': 'hit',
  '2': 'stand',
  '3': 'double',
  '4': 'split',
  '5': 'surrender',
};

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
  decline: 'Decline',
};

function zoneLabel(zone: ZoneId | 'take' | 'decline'): string {
  if (zone === 'take' || zone === 'decline') return INSURANCE_ZONE_LABEL[zone];
  return ZONE_LABEL[zone];
}

/* ---------------------------------------------------------------- */
/* Flashcards                                                        */
/* ---------------------------------------------------------------- */

const FLASH_WEIGHTS_KEY = 'bjtrainer.flashweights.v1';

function loadFlashWeights(): Record<string, number> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(FLASH_WEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, number>;
    return {};
  } catch {
    return {};
  }
}

function saveFlashWeights(weights: Record<string, number>): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(FLASH_WEIGHTS_KEY, JSON.stringify(weights));
  } catch {
    // best-effort persistence only
  }
}

function cellCategory(cellId: string, correct: Action): 'hard' | 'soft' | 'pairs' | 'surrender' {
  if (correct === 'surrender') return 'surrender';
  if (cellId.startsWith('hard-')) return 'hard';
  if (cellId.startsWith('soft-')) return 'soft';
  return 'pairs';
}

function FlashcardsView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  const weightsRef = useRef<Record<string, number>>(loadFlashWeights());
  const [card, setCard] = useState<Flashcard>(() =>
    drawFlashcard(settings.drill.flashCategory, weightsRef.current, randomSeed(), activeProfile.rules),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction: Action } | null>(null);
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 9): local UI state, not persisted, per the
  // CountDrillView precedent (a per-session choice scoped to this screen).
  const [eyesFree, setEyesFree] = useState(false);
  // Bumped every time a new card is drawn so a stale auto-advance timer
  // from a previous card can recognize itself as stale and no-op, even
  // though its own effect cleanup already clears it on unmount/early exit.
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  // Spoken "Correct." is only wanted once per drill session -- after that,
  // correct answers still chime but skip the spoken text. `useRef(false)`
  // is fresh on every mount, and this view is unmounted/remounted each time
  // it's (re)entered from the picker (see the Drills switch below), so a
  // new session always starts with this false; no extra reset effect needed.
  const spokenCorrectOnceRef = useRef(false);

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
    if (!eyesFree) return;
    speak(narrateFlashcardPrompt(card.cards, card.up), {
      interrupt: true,
      rate: settings.audio.rate,
      voiceURI: settings.audio.voiceURI,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, eyesFree]);

  const next = (category: Settings['drill']['flashCategory'] = settings.drill.flashCategory) => {
    runIdRef.current += 1;
    clearAdvanceTimer();
    setCard(drawFlashcard(category, weightsRef.current, randomSeed(), activeProfile.rules));
    setFeedback(null);
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
    void releaseWakeLock();
    onBack();
  };

  const handleRepeat = () => {
    speak(narrateFlashcardPrompt(card.cards, card.up), {
      interrupt: true,
      rate: settings.audio.rate,
      voiceURI: settings.audio.voiceURI,
    });
  };

  const scheduleAutoAdvance = () => {
    clearAdvanceTimer();
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, settings.audio.answerPauseMs);
  };

  // Shared grading core: the SAME function backs both the visual ActionBar
  // taps and the eyes-free ZonePad taps, so the two paths cannot drift.
  // Pure aside from the weight/stats writes it always performed; no audio,
  // no setState -- callers layer their own feedback on top.
  const gradeFlashcardAnswer = (taken: Action): { event: GradedEvent; correctAction: Action } => {
    const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
    const withCount = correctPlay(card.cards, card.up, 0, ctx, activeProfile.rules);
    const basicOnly = basicPlay(card.cards, card.up, ctx, activeProfile.rules);
    const { classification, correct } = classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0, activeProfile.rules);

    if (!correct) {
      weightsRef.current = { ...weightsRef.current, [card.cellId]: (weightsRef.current[card.cellId] ?? 0) + 1 };
      saveFlashWeights(weightsRef.current);
    }

    const event: GradedEvent = {
      kind: 'action',
      category: cellCategory(card.cellId, card.correct),
      correct,
      classification,
      taken,
      expected: card.correct,
      reason: card.cellId,
      tc: 0,
      hand: card.cellId,
    };
    saveStats(applyEvents(loadStats(), [event]));

    return { event, correctAction: withCount.action };
  };

  // Gates the SPOKEN "Correct." text (never the chime, never wrong-answer
  // speech, never the visible badge) to once per drill session: the first
  // correct answer speaks in full and flips the ref; every correct answer
  // after that skips `doSpeak` entirely so only the chime plays. Shared by
  // both handlers below so the visual and eyes-free paths can't drift.
  const speakCorrectionOnceGated = (event: GradedEvent, doSpeak: (text: string) => void) => {
    if (event.correct && spokenCorrectOnceRef.current) return;
    doSpeak(narrateCorrection(event));
    if (event.correct) spokenCorrectOnceRef.current = true;
  };

  const handleAction = (taken: Action) => {
    const { event, correctAction } = gradeFlashcardAnswer(taken);

    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct, correctAction });
  };

  // Eyes-free zone tap: ZoneId and Action are the identical five-member
  // literal union (hit/stand/double/split/surrender), so the tapped zone
  // maps straight onto the grading function's `taken` param with no
  // translation layer to drift out of sync. ZonePad's onAnswer type also
  // covers the insurance 'take'/'decline' variant it never produces in
  // 'action' mode -- narrow it away rather than widening this handler.
  const handleZoneAnswer = (zone: ZoneId | 'take' | 'decline') => {
    if (zone === 'take' || zone === 'decline') return;

    speak(`${zoneLabel(zone)}…`, {
      interrupt: true,
      rate: settings.audio.rate,
      voiceURI: settings.audio.voiceURI,
    });

    const { event, correctAction } = gradeFlashcardAnswer(zone);

    speakCorrectionOnceGated(event, (text) =>
      speak(text, { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI }),
    );
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct, correctAction });
    scheduleAutoAdvance();
  };

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
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (!feedback) {
        const action = KEY_TO_ACTION[e.key];
        if (!action) return;
        e.preventDefault();
        if (eyesFree) {
          handleZoneAnswer(action);
        } else {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, eyesFree]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Flashcards</div>
      </div>

      <div className="drill-inline-controls">
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

        <label className="count-toggle">
          <input
            type="checkbox"
            checked={eyesFree}
            disabled={!settings.audio.enabled}
            onChange={(e) => setEyesFree(e.target.checked)}
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
        {!settings.audio.enabled && (
          <div className="settings-row settings-note-row">
            Enable audio in Settings to use eyes-free mode.
          </div>
        )}
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

      <div className="message-strip">
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : `Wrong — correct: ${feedback.correctAction.toUpperCase()}`}
            </div>
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
          <ActionBar mode={{ kind: 'actions', legal: ALL_ACTIONS, onAction: handleAction }} />
        )
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={() => next()}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Deviation Quiz                                                     */
/* ---------------------------------------------------------------- */

function buildQuizEvent(item: QuizItem, taken: string, rules: RuleSet): GradedEvent {
  if (item.cards === null) {
    const take = taken === 'take-insurance';
    const { classification, correct } = classifyInsurance(take, item.tc);
    return {
      kind: 'insurance',
      category: 'insurance',
      correct,
      classification,
      taken: take ? 'take' : 'decline',
      expected: item.correct === 'take-insurance' ? 'take' : 'decline',
      reason: item.label,
      deviationId: item.deviationId,
      tc: item.tc,
      hand: 'dealer A',
    };
  }

  // canSurrender: false must match drawQuizItem's ctx (deviationQuiz.ts) so the
  // grader agrees with item.correct — see the deviation-quiz surrender-masking fix.
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
  const withCount = correctPlay(item.cards, item.up, item.tc, ctx, rules);
  const basicOnly = basicPlay(item.cards, item.up, ctx, rules);
  const { classification, correct } = classifyAction(taken as Action, withCount, basicOnly, item.cards, item.up, item.tc, rules);

  return {
    kind: 'action',
    category: actionCategory(item.cards, item.correct as Action),
    correct,
    classification,
    taken,
    expected: item.correct,
    reason: item.label,
    deviationId: item.deviationId,
    tc: item.tc,
    hand: item.label,
  };
}

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
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  // Use the active filter (falls back to 'all' if saved index is inactive)
  const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);

  const [item, setItem] = useState<QuizItem>(() =>
    drawQuizItem(randomSeed(), quizFilterArg(activeFilter), activeProfile.rules, settings.drill.quizDistractorPct),
  );
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const audio = useAudio(settings.audio);

  // Eyes-free audio (Task 9): local UI state, not persisted, per the
  // CountDrillView precedent (a per-session choice scoped to this screen).
  const [eyesFree, setEyesFree] = useState(false);
  // Bumped every time a new item is drawn so a stale auto-advance timer
  // from a previous item can recognize itself as stale and no-op, even
  // though its own effect cleanup already clears it on unmount/early exit.
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  // Spoken "Correct." is only wanted once per drill session -- after that,
  // correct answers still chime but skip the spoken text. `useRef(false)`
  // is fresh on every mount, and this view is unmounted/remounted each time
  // it's (re)entered from the picker (see the Drills switch below), so a
  // new session always starts with this false; no extra reset effect needed.
  const spokenCorrectOnceRef = useRef(false);

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
      speak(narrateQuizPrompt(item.cards, item.up, item.tc), {
        interrupt: true,
        rate: settings.audio.rate,
        voiceURI: settings.audio.voiceURI,
      });
    } else {
      audio.sayFull(narrateQuizPrompt(item.cards, item.up, item.tc));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, eyesFree]);

  const next = (filter: DeviationId | 'all' = activeFilter, distractorPct: number = settings.drill.quizDistractorPct) => {
    runIdRef.current += 1;
    clearAdvanceTimer();
    setItem(drawQuizItem(randomSeed(), quizFilterArg(filter), activeProfile.rules, distractorPct));
    setFeedback(null);
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
    void releaseWakeLock();
    onBack();
  };

  const handleRepeat = () => {
    speak(narrateQuizPrompt(item.cards, item.up, item.tc), {
      interrupt: true,
      rate: settings.audio.rate,
      voiceURI: settings.audio.voiceURI,
    });
  };

  const scheduleAutoAdvance = () => {
    clearAdvanceTimer();
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, settings.audio.answerPauseMs);
  };

  // Shared grading core: the SAME function backs both the visual buttons
  // (ActionBar / Take-Decline) and the eyes-free ZonePad taps, so the two
  // paths cannot drift. No audio, no setState -- callers layer their own
  // feedback on top.
  const gradeQuizAnswer = (taken: string): GradedEvent => {
    const event = buildQuizEvent(item, taken, activeProfile.rules);
    saveStats(applyEvents(loadStats(), [event]));
    return event;
  };

  // Gates the SPOKEN "Correct." text (never the chime, never wrong-answer
  // speech, never the visible badge) to once per drill session: the first
  // correct answer speaks in full and flips the ref; every correct answer
  // after that skips `doSpeak` entirely so only the chime plays. Shared by
  // both handlers below so the visual and eyes-free paths can't drift.
  const speakCorrectionOnceGated = (event: GradedEvent, doSpeak: (text: string) => void) => {
    if (event.correct && spokenCorrectOnceRef.current) return;
    doSpeak(narrateCorrection(event));
    if (event.correct) spokenCorrectOnceRef.current = true;
  };

  const handleAnswer = (taken: string) => {
    const event = gradeQuizAnswer(taken);

    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct });
  };

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

    speak(`${zoneLabel(zone)}…`, {
      interrupt: true,
      rate: settings.audio.rate,
      voiceURI: settings.audio.voiceURI,
    });

    const event = gradeQuizAnswer(taken);

    speakCorrectionOnceGated(event, (text) =>
      speak(text, { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI }),
    );
    audio.ding(event.correct ? 'good' : 'bad');

    setFeedback({ correct: event.correct });
    scheduleAutoAdvance();
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
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

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
        if (eyesFree) {
          handleZoneAnswer(action);
        } else {
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
  }, [feedback, eyesFree, item]);

  const indexList = activeProfile.rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18;

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Deviation Quiz</div>
      </div>

      <div className="drill-inline-controls">
        <label className="settings-row">
          <span className="settings-label">Index</span>
          <select
            className="quiz-index-select"
            value={activeFilter}
            onChange={(e) => changeIndex(e.target.value as DeviationId | 'all')}
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
            disabled={!settings.audio.enabled}
            onChange={(e) => setEyesFree(e.target.checked)}
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
        {!settings.audio.enabled && (
          <div className="settings-row settings-note-row">
            Enable audio in Settings to use eyes-free mode.
          </div>
        )}
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

      <div className="message-strip">
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : 'Wrong'}
            </div>
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
          <ActionBar mode={{ kind: 'actions', legal: ALL_ACTIONS, onAction: handleAnswer }} />
        )
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={() => next()}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Picker                                                             */
/* ---------------------------------------------------------------- */

export function Drills({ settings, activeProfile, onNavigate, onSettingsChange }: DrillsProps) {
  const [mode, setMode] = useState<'picker' | 'count' | 'truecount' | 'deckest' | 'flash' | 'quiz'>('picker');

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
    return <TrueCountDrillView settings={settings} onBack={() => setMode('picker')} />;
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

  return (
    <div className="drills-picker">
      <h1 className="drills-title">Drills</h1>
      <div className="drills-nav">
        <button type="button" className="drills-nav-btn" onClick={() => setMode('count')}>
          Count Drill
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('truecount')}>
          True Count Drill
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('deckest')}>
          Deck Estimation
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('flash')}>
          Flashcards
        </button>
        <button type="button" className="drills-nav-btn" onClick={() => setMode('quiz')}>
          Deviation Quiz
        </button>
      </div>
      <button type="button" className="drills-back-btn" onClick={() => onNavigate('home')}>
        Back to Home
      </button>
    </div>
  );
}
