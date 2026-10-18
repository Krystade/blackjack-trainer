import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import type { Card, Rank } from '../../../engine/cards';
import { strategyRulesFor } from '../../../store/profiles';
import {
  afterIndexAnswer,
  answerWasShown,
  drawIndexTestItem,
  NEW_INDEX_SESSION,
  type IndexTestSession,
  indexTestPlayLine,
  indexTestPrompt,
  narrateIndexTestCorrection,
  narrateIndexTestPrompt,
  type IndexTestItem,
} from '../../../drills/indexTest';
import { gradeIndexTestAnswer, loadQuizSr } from '../../../drills/gradeAnswer';
import type { AnswerChannel, SrDeck } from '../../../drills/spacedRepetition';
import { SCREEN_CHANNEL, VOICE_CHANNEL } from '../../../drills/spacedRepetition';
import { formatReviewPlain } from '../../../drills/srStatus';
import { signed } from '../../../drills/signed';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../../drills/answerPause';
import { NumPad } from '../../components/NumPad';
import { ResultStrip } from '../../components/ResultStrip';
import { PlayingCard } from '../../components/PlayingCard';
import { handText, releaseAnswerFocus } from '../../handResult';
import { answerTooSoon } from '../../answerBounce';
import { focusSwallowsKey } from '../../keyboardFocus';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { narrateReadback, NO_ANSWER_YET } from '../../../audio/narrate';
import { parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../../audio/voiceNumber';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../../audio/voiceRecognition';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { useWheelNumber } from '../../useWheelNumber';
import { useVoiceToggle, usePushToTalk, startPushToTalk } from '../../voiceSession';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { DrillModeControls } from './DrillModeControls';
import { QuizAskSwitch } from './QuizAskSwitch';
import './indexTest.css';
import './indexTestFit.css';

/** The answered item, frozen for the strip: never the live next item. */
interface IndexResult {
  id: number;
  correct: boolean;
  cards: Card[] | null;
  up: Rank;
  answer: number;
  index: number;
  playLine: string;
  review: string | null;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * B3: the Deviation quiz's "Index test". The hand is shown and the answer is
 * the index -- a signed true count, typed, spoken or pressed out on the wheel.
 * Grades through `gradeIndexTestAnswer` (the quiz's SR deck and Stats).
 */
export function IndexTestView({
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
  const rules = strategyRulesFor(activeProfile);
  const srDeckRef = useRef<SrDeck>(loadQuizSr());
  const [item, setItem] = useState<IndexTestItem>(() =>
    drawIndexTestItem(randomSeed(), rules, srDeckRef.current, Date.now()),
  );
  const [phase, setPhase] = useState<'answering' | 'feedback'>('answering');
  const phaseRef = useRef<'answering' | 'feedback'>('answering');
  // #29: the keypad's value is the one answer state -- typed, spoken or
  // pressed out on the wheel -- so OK and "yes" submit the same thing.
  const [padValue, setPadValue] = useState('');
  const pending = /\d/.test(padValue) ? parseInt(padValue, 10) : null;
  const setPending = (v: number | null) => setPadValue(v === null ? '' : String(v));
  const [result, setResult] = useState<IndexResult | null>(null);
  const resultIdRef = useRef(0);
  const correctionRef = useRef('');
  const runIdRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const promptShownAtRef = useRef(performance.now());
  // #24 (R8): what this session has answered and missed, for the draw and the review.
  const sessionRef = useRef<IndexTestSession>(NEW_INDEX_SESSION);

  const audio = useAudio(settings.audio);
  const [eyesFree, setEyesFree] = useEyesFreeToggle('deviation-quiz');
  const [voiceOn, setVoiceOn] = useVoiceToggle('deviation-quiz');
  const pushToTalkOpen = usePushToTalk();
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  const spoken = eyesFree || voiceOn;

  const say = (text: string) => speak(text, speechOptsFrom(settings.audio, { interrupt: true }));

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };
  useEffect(() => clearAdvanceTimer, []);

  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.audio.enabled]);

  useEffect(() => {
    if (eyesFree) void requestWakeLock();
    else void releaseWakeLock();
  }, [eyesFree]);
  useEffect(() => () => void releaseWakeLock(), []);

  // The question, said on every new item -- eyes-free or answering out loud.
  useEffect(() => {
    if (spoken) say(narrateIndexTestPrompt(item));
    else audio.sayFull(narrateIndexTestPrompt(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, eyesFree, voiceOn]);

  const wheelResetRef = useRef<() => void>(() => {});

  const next = () => {
    runIdRef.current += 1;
    clearAdvanceTimer();
    wheelResetRef.current();
    phaseRef.current = 'answering';
    setPhase('answering');
    setPending(null);
    setItem(drawIndexTestItem(randomSeed(), rules, srDeckRef.current, Date.now(), sessionRef.current.recent));
    promptShownAtRef.current = performance.now();
  };

  const submit = (answer: number, channel: AnswerChannel = SCREEN_CHANNEL) => {
    if (phaseRef.current !== 'answering') return;
    // Review fix (c), as in the quiz: the second touch of a bounce.
    if (answerTooSoon(promptShownAtRef.current)) return;
    const now = Date.now();
    const shown = answerWasShown(sessionRef.current, item.deviationId);
    const graded = gradeIndexTestAnswer(item, answer, srDeckRef.current, now, channel, shown);
    srDeckRef.current = graded.nextDeck;
    sessionRef.current = afterIndexAnswer(sessionRef.current, item.deviationId, graded.correct);
    resultIdRef.current += 1;
    setResult({
      id: resultIdRef.current,
      correct: graded.correct,
      cards: item.cards,
      up: item.up,
      answer,
      index: item.index,
      playLine: indexTestPlayLine(item),
      review: formatReviewPlain(graded.nextDeck[item.deviationId], now),
    });
    setPending(null);
    audio.ding(graded.correct ? 'good' : 'bad');
    if (!spoken) {
      // B1 fast advance: grade, freeze, the next item in the same handler.
      releaseAnswerFocus();
      next();
      return;
    }
    const text = narrateIndexTestCorrection(item, graded.correct);
    correctionRef.current = text;
    speak(text, speechOptsFrom(settings.audio, { interrupt: true }));
    phaseRef.current = 'feedback';
    setPhase('feedback');
    const runId = runIdRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (runIdRef.current !== runId) return;
      next();
    }, autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenPauseFor(text, settings.audio.rate)));
  };

  const repeatPrompt = () => say(narrateIndexTestPrompt(item));

  const handleBack = () => {
    cancelSpeech();
    clearAdvanceTimer();
    void releaseWakeLock();
    onBack();
  };

  /** Numbers count only while an answer is due: in feedback they are noise. */
  const onTranscript = (heard: string, offered: readonly string[] = [heard]): string | null => {
    if (phaseRef.current !== 'answering') return null;
    const readings = offered.length > 0 ? offered : [heard];
    let parsed: ReturnType<typeof parseCountSpeech> = null;
    for (const reading of readings) {
      parsed = parseCountSpeech(reading);
      if (parsed) break;
    }
    if (!parsed) return null;
    const value = parsed.kind === 'value' ? parsed.value : (pending ?? 0) + parsed.delta;
    setPending(value);
    say(narrateReadback(value));
    return `index ${speakableCount(value)}`;
  };

  const onAction = (action: VoiceAction) => {
    if (phaseRef.current === 'feedback') {
      if (action === 'yes') next();
      else if (action === 'repeat') say(correctionRef.current);
      return;
    }
    if (action === 'yes') {
      if (pending === null) say(NO_ANSWER_YET);
      else submit(pending, VOICE_CHANNEL);
    } else if (action === 'no') {
      setPending(null);
      repeatPrompt();
    } else if (action === 'repeat') {
      if (pending === null) repeatPrompt();
      else say(narrateReadback(pending));
    }
  };

  const wheelNumber = useWheelNumber({
    readback: (v) => say(narrateReadback(v)),
    commit: (v) => submit(v, VOICE_CHANNEL),
  });
  wheelResetRef.current = wheelNumber.reset;

  useWheelCommand((command) => {
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('index-test');
        audio.ding('attention');
      } else {
        repeatPrompt();
      }
      return;
    }
    if (phaseRef.current === 'answering') {
      setPending(wheelNumber.press(command));
      return;
    }
    if (command === 'forward') next();
    else say(correctionRef.current);
  });

  const voice = useVoiceControl({
    enabled: voiceOn || pushToTalkOpen,
    onAction,
    onTranscript,
    onNotUnderstood: () => audio.ding('again'),
    // C-R4: second miss on this question repeats it; later misses alternate tone and re-ask.
    escalation: {
      promptKey: [phase, item],
      reask: () => onAction('repeat'),
    },
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    onListening: () => audio.dingWhenQuiet('ready'),
    context: 'index-test',
  });

  // Enter/Space go on from a correction; while answering NumPad owns the keys.
  useEffect(() => {
    if (phase !== 'feedback') return;
    const onKey = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item]);

  return (
    <div className="drill-screen index-test-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Deviation quiz</div>
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
      </div>

      <div className="drill-inline-controls">
        <QuizAskSwitch settings={settings} onSettingsChange={onSettingsChange} />
        <DrillModeControls
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onEyesFreeChange={(on) => {
            if (!on) clearAdvanceTimer();
            setEyesFree(on);
          }}
          voiceSupported={voiceSupported}
          voiceOn={voiceOn}
          onVoiceChange={setVoiceOn}
          voiceStatus={voice.status}
        />
      </div>

      <div className="index-test-ask" data-testid="index-test-prompt" data-deviation-id={item.deviationId}>
        {indexTestPrompt(item)}
      </div>

      {item.cards !== null ? (
        // Dealer and hand side by side: the keypad needs the height.
        <div className="index-test-table">
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
        </div>
      ) : (
        <div className="quiz-insurance-prompt">Dealer shows an Ace. Insurance?</div>
      )}

      <div className="message-strip">
        {result && (
          <ResultStrip id={result.id} tone={result.correct ? 'ok' : 'miss'}>
            <div className="index-test-result" data-testid="index-test-result">
              {/* #28: two lines, not four, so a miss strip and the keypad
                  fit an 812-tall phone with its insets. */}
              {result.correct ? (
                <div className="index-test-verdict">
                  {`Correct! ${handText(result.cards, result.up)} — index ${signed(result.index)}`}
                </div>
              ) : (
                <div className="index-test-line">
                  <span className="index-test-verdict">Wrong</span>
                  <span className="index-test-hand">
                    {` · ${handText(result.cards, result.up)} · you said ${signed(result.answer)}`}
                  </span>
                </div>
              )}
              <div className="index-test-line">
                <span className="index-test-right-index" data-testid="index-test-right-index">
                  {`Index ${signed(result.index)}`}
                </span>
                {' · '}
                <span className="index-test-play-line" data-testid="index-test-play-line">
                  {result.playLine}
                </span>
              </div>
              {result.review && <div className="index-test-review">{result.review}</div>}
            </div>
          </ResultStrip>
        )}
      </div>

      {phase === 'answering' ? (
        <NumPad label="Index (true count)" value={padValue} onValueChange={setPadValue} onSubmit={(v) => submit(v)} />
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
