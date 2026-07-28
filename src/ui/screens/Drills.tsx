import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Action, DeviationId } from '../../engine/deviations';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17, isIndexActive } from '../../engine/deviations';
import type { GradedEvent } from '../../engine/grade';
import { drawFlashcard } from '../../drills/flashcards';
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
  loadFlashWeights,
  loadQuizWeights,
} from '../../drills/gradeAnswer';
import { pickMixedType } from '../../drills/mixedSession';
import type { MixedItemType } from '../../drills/mixedSession';
import { saveSettings } from '../../store/persist';
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

  // Shared grading core (R4): the SAME gradeFlashcard function backs the
  // visual ActionBar taps, the eyes-free ZonePad taps, AND the mixed-session
  // view, so none of them can drift. R1 latency is captured here (BEFORE any
  // classification work) and passed in; R3 weights + the Stats write happen
  // inside gradeFlashcard. No audio, no setState -- callers layer their own
  // feedback on top.
  const gradeFlashcardAnswer = (taken: Action): { event: GradedEvent; correctAction: Action } => {
    const elapsedMs = performance.now() - promptShownAtRef.current;
    const result = gradeFlashcard(card, taken, activeProfile.rules, elapsedMs, weightsRef.current);
    weightsRef.current = result.nextWeights;
    return { event: result.event, correctAction: result.correctAction };
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
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Flashcards</div>
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

  // R3 (docs/BACKLOG.md, spaced-repetition): per-index miss-weight map,
  // loaded once per mount exactly like FlashcardsView's weightsRef.
  const weightsRef = useRef<Record<string, number>>(loadQuizWeights());

  const [item, setItem] = useState<QuizItem>(() =>
    drawQuizItem(
      randomSeed(),
      quizFilterArg(activeFilter),
      activeProfile.rules,
      settings.drill.quizDistractorPct,
      weightsRef.current,
    ),
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
    setItem(drawQuizItem(randomSeed(), quizFilterArg(filter), activeProfile.rules, distractorPct, weightsRef.current));
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

  // Shared grading core (R4): the SAME gradeQuiz function backs the visual
  // buttons (ActionBar / Take-Decline), the eyes-free ZonePad taps, AND the
  // mixed-session view. R1 latency is captured here; R3 index weights
  // (real items only) + the Stats write happen inside gradeQuiz. No audio,
  // no setState -- callers layer their own feedback on top.
  const gradeQuizAnswer = (taken: string): GradedEvent => {
    const elapsedMs = performance.now() - promptShownAtRef.current;
    const result = gradeQuiz(item, taken, activeProfile.rules, elapsedMs, weightsRef.current);
    weightsRef.current = result.nextWeights;
    return result.event;
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
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Deviation Quiz</div>
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
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
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (settings: Settings) => void;
}) {
  // R3 weight maps -- one per drill, held exactly as the standalone views do
  // so a mixed session's misses/decays feed the same persisted weighting.
  const flashWeightsRef = useRef<Record<string, number>>(loadFlashWeights());
  const quizWeightsRef = useRef<Record<string, number>>(loadQuizWeights());

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
        card: drawFlashcard(settings.drill.flashCategory, flashWeightsRef.current, randomSeed(), activeProfile.rules),
      };
    }
    const activeFilter = getActiveQuizFilter(settings.drill.quizIndex, activeProfile);
    return {
      type,
      item: drawQuizItem(
        randomSeed(),
        quizFilterArg(activeFilter),
        activeProfile.rules,
        settings.drill.quizDistractorPct,
        quizWeightsRef.current,
      ),
    };
  };

  const [current, setCurrent] = useState<MixedCurrent>(() => drawFor(pickMixedType(sessionSeed(), 0)));
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAction?: Action } | null>(null);
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
      ? narrateFlashcardPrompt(c.card.cards, c.card.up)
      : narrateQuizPrompt(c.item.cards, c.item.up, c.item.tc);

  // Narrate each new item. Eyes-free speaks every item (its primary output
  // channel); visual mode mirrors each drill's standalone behavior -- the
  // quiz's verbosity-gated sayFull, and the flashcard's silence -- reusing
  // the same prompt builders (the quiz prompt includes the spoken TC, the
  // flashcard prompt never does, making the discrimination audible too).
  useEffect(() => {
    if (eyesFree) {
      speak(promptFor(current), { interrupt: true, rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });
    } else if (current.type === 'quiz') {
      audio.sayFull(narrateQuizPrompt(current.item.cards, current.item.up, current.item.tc));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, eyesFree]);

  const next = () => {
    runIdRef.current += 1;
    clearAdvanceTimer();
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
    void releaseWakeLock();
    onBack();
  };

  const handleRepeat = () => {
    speak(promptFor(current), { interrupt: true, rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });
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

  // THE shared grade path (R4): dispatch to gradeFlashcard or gradeQuiz by the
  // current item's type -- byte-identical to what the standalone views call.
  // R1 latency captured here; R3 weights + Stats write happen inside.
  const gradeCurrent = (taken: string): { correct: boolean; correctAction?: Action; event: GradedEvent } => {
    const elapsedMs = performance.now() - promptShownAtRef.current;
    if (current.type === 'flash') {
      const result = gradeFlashcard(current.card, taken as Action, activeProfile.rules, elapsedMs, flashWeightsRef.current);
      flashWeightsRef.current = result.nextWeights;
      return { correct: result.event.correct, correctAction: result.correctAction, event: result.event };
    }
    const result = gradeQuiz(current.item, taken, activeProfile.rules, elapsedMs, quizWeightsRef.current);
    quizWeightsRef.current = result.nextWeights;
    return { correct: result.event.correct, event: result.event };
  };

  const speakCorrectionOnceGated = (event: GradedEvent, doSpeak: (text: string) => void) => {
    if (event.correct && spokenCorrectOnceRef.current) return;
    doSpeak(narrateCorrection(event));
    if (event.correct) spokenCorrectOnceRef.current = true;
  };

  const handleAnswer = (taken: string) => {
    const { correct, correctAction, event } = gradeCurrent(taken);
    speakCorrectionOnceGated(event, (text) => audio.say(text, { interrupt: true }));
    audio.ding(correct ? 'good' : 'bad');
    setFeedback({ correct, correctAction });
  };

  const handleZoneAnswer = (zone: ZoneId | 'take' | 'decline') => {
    // Insurance items expose only take/decline zones; every other item the
    // five action zones. Reject a mode/zone mismatch, exactly as the
    // standalone quiz view does.
    if (isInsuranceItem !== (zone === 'take' || zone === 'decline')) return;
    const taken = zone === 'take' ? 'take-insurance' : zone === 'decline' ? 'decline-insurance' : zone;

    speak(`${zoneLabel(zone)}…`, { interrupt: true, rate: settings.audio.rate, voiceURI: settings.audio.voiceURI });

    const { correct, correctAction, event } = gradeCurrent(taken);
    speakCorrectionOnceGated(event, (text) => speak(text, { rate: settings.audio.rate, voiceURI: settings.audio.voiceURI }));
    audio.ding(correct ? 'good' : 'bad');
    setFeedback({ correct, correctAction });
    scheduleAutoAdvance();
  };

  // Keyboard: identical mapping to the standalone views -- 1-5 action keys for
  // flashcard + quiz-action items, 1=Take/2=Decline for quiz insurance items,
  // Enter/Space to advance past feedback. Routed to the eyes-free or visual
  // handler so grading/audio can't drift from a real tap.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

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
        if (eyesFree) handleZoneAnswer(action);
        else handleAnswer(action);
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
  }, [feedback, eyesFree, current]);

  const dealerUp = current.type === 'flash' ? current.card.up : current.item.up;
  const handCards = current.type === 'flash' ? current.card.cards : current.item.cards;

  return (
    <div className="drill-screen" style={drillScreenStyle(padTop)}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Mixed</div>
      </div>

      <div className="drill-inline-controls" ref={controlsRef}>
        <div className="settings-row settings-note-row">
          Basic-strategy and count-dependent hands, interleaved.
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
        {feedback &&
          (current.type === 'flash' ? (
            <>
              <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
                {feedback.correct ? 'Correct!' : `Wrong — correct: ${feedback.correctAction?.toUpperCase()}`}
              </div>
              <div className="feedback-cell">{current.card.cellId}</div>
            </>
          ) : (
            <>
              <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
                {feedback.correct ? 'Correct!' : 'Wrong'}
              </div>
              <div className="quiz-label">{current.item.label}</div>
            </>
          ))}
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
  const [mode, setMode] = useState<'picker' | 'count' | 'truecount' | 'deckest' | 'flash' | 'quiz' | 'mixed'>('picker');

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
        <button type="button" className="drills-nav-btn" onClick={() => setMode('mixed')}>
          Mixed
        </button>
      </div>
      <button type="button" className="drills-back-btn" onClick={() => onNavigate('home')}>
        Back to Home
      </button>
    </div>
  );
}
