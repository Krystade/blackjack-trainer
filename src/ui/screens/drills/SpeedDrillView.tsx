import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { getActiveProfile, strategyRulesFor } from '../../../store/profiles';
import { saveSettings } from '../../../store/persist';
import {
  buildSpeedEvent,
  drawSpeedQuestion,
  medianMs,
  speedKeyAnswer,
  speedModeOf,
  speedReason,
  yesNo,
  SPEED_MODES,
  SPEED_MODE_LABEL,
  SPEED_QUESTION,
  type SpeedMode,
  type SpeedQuestion,
} from '../../../drills/speedDrill';
import { PlayingCard } from '../../components/PlayingCard';
import { ResultStrip } from '../../components/ResultStrip';
import { releaseAnswerFocus, resultHandLine } from '../../handResult';
import { answerTooSoon } from '../../answerBounce';
import { signed } from '../../../drills/signed';
import { focusSwallowsKey } from '../../keyboardFocus';
import { HandDeckControls } from './HandDeckControls';
import { HandDeckGate } from './HandDeckGate';
import { handDeckFor } from './handDeckFor';
import { narrateSpeedPrompt, narrateYesNoVerdict } from '../../../drills/wheelProposition';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../../drills/answerPause';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { useWheelCommand } from '../../useWheelCommand';
import { EyesFreeCheckbox } from './EyesFreeCheckbox';
import './speedDrill.css';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Wave A: a real minus sign (U+2212); 0 reads "+0" here, as before. */
function formatSigned(n: number): string {
  return signed(n, { plusZero: true });
}

/** The answered question, frozen when graded (B1): the strip never reads the
 *  question now on screen. */
interface SpeedResult {
  id: number;
  q: SpeedQuestion;
  saidYes: boolean;
  correct: boolean;
}

function Word({ yes }: { yes: boolean }) {
  return <>{yes ? 'Yes' : 'No'}</>;
}

/** Why a mode has nothing to ask in this deck. */
function nothingToAsk(mode: SpeedMode, rulesLs: boolean): string {
  if (mode === 'surrender' && !rulesLs) return 'This table has no late surrender, so there is nothing to ask. Pick another question.';
  if (mode === 'split') return 'Split? needs pairs. Choose Pairs, or another question.';
  if (mode === 'deviation') return 'No index plays in these hands. Choose more hands, or another question.';
  return 'Nothing to ask in these hands. Choose more hands, or another question.';
}

/**
 * #15 / #19: the yes/no Speed drill. One question per mode ("Surrender?",
 * "Deviation here?", "Double?", "Split?"), two big buttons, no Next: an
 * answer deals the next hand at once and the previous one's result shows in
 * the strip.
 *
 * C-R1 (W9): eyes-free, the hand and question are SAID and the wheel answers
 * them -- forward yes, back no -- with the verdict spoken and the next
 * question after it. No microphone and no clock: a wheel press is not a
 * reaction time, so eyes-free answers are scored but not timed. Off
 * eyes-free the screen is exactly as it was.
 */
export function SpeedDrillView({
  settings,
  onSettingsChange,
  onBack,
  activeProfile,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  onBack: () => void;
  activeProfile?: Profile;
}) {
  const profile = useMemo(() => activeProfile ?? getActiveProfile(), [activeProfile]);
  return (
    <HandDeckGate title="Speed" settings={settings} activeProfile={profile} onSettingsChange={onSettingsChange} onBack={onBack}>
      <SpeedSession settings={settings} profile={profile} onSettingsChange={onSettingsChange} onBack={onBack} />
    </HandDeckGate>
  );
}

function SpeedSession({
  settings,
  profile,
  onSettingsChange,
  onBack,
}: {
  settings: Settings;
  profile: Profile;
  onSettingsChange: (next: Settings) => void;
  onBack: () => void;
}) {
  const mode = speedModeOf(settings.drill);
  const rules = useMemo(() => strategyRulesFor(profile), [profile]);
  const deck = useMemo(() => handDeckFor(settings.drill, profile), [settings.drill, profile]);

  const [question, setQuestion] = useState<SpeedQuestion | null>(() => drawSpeedQuestion(mode, deck, rules, randomSeed()));
  const [last, setLast] = useState<SpeedResult | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [times, setTimes] = useState<number[]>([]);
  const shownAtRef = useRef(performance.now());
  const idRef = useRef(0);
  const audio = useAudio(settings.audio);
  const [eyesFree, setEyesFree] = useEyesFreeToggle('speed');
  /** Eyes-free only: the verdict is being said; the next question waits. */
  const feedbackRef = useRef<{ verdict: string; prev: string } | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const clearAdvance = () => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  };
  useEffect(() => clearAdvance, []);

  // A new mode or deck is a new session.
  const sessionKey = `${mode}|${deck.source}|${deck.ids.join(',')}|${rules.ls}|${rules.s17}|${rules.surrenderIndices}|${rules.decks}|${rules.bjaExtras}`;
  const firstKey = useRef(sessionKey);
  useEffect(() => {
    if (firstKey.current === sessionKey) return;
    firstKey.current = sessionKey;
    setQuestion(drawSpeedQuestion(mode, deck, rules, randomSeed()));
    setLast(null);
    setScore({ right: 0, total: 0 });
    setTimes([]);
    shownAtRef.current = performance.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const say = (text: string) => speak(text, speechOptsFrom(settings.audio, { interrupt: true }));

  // Eyes-free: say each question as it comes up (and on switching it on).
  useEffect(() => {
    if (!eyesFree) {
      // Switched off over a verdict: go on, as the timer would have.
      if (feedbackRef.current) nextAfterVerdict();
      return;
    }
    if (question && !feedbackRef.current) say(narrateSpeedPrompt(question));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, eyesFree]);

  const nextAfterVerdict = () => {
    const fb = feedbackRef.current;
    if (!fb) return;
    clearAdvance();
    feedbackRef.current = null;
    setQuestion(drawSpeedQuestion(mode, deck, rules, randomSeed(), fb.prev));
    shownAtRef.current = performance.now();
  };

  const answer = (saidYes: boolean) => {
    if (!question || feedbackRef.current) return;
    // Review fix (c): a bounce's second touch lands on the next hand.
    if (answerTooSoon(shownAtRef.current)) return;
    const elapsedMs = performance.now() - shownAtRef.current;
    const event = buildSpeedEvent(question, saidYes, elapsedMs, Date.now());
    // Wave A F20: NOT written to Stats. "Double? No" on A,7 v 9 says nothing
    // about whether you hit or stand it, yet it counted as a full chart
    // answer: it cleared weak cells, could satisfy Home's index gate, and its
    // 0.4s taps became the Surrender median. Speed keeps its own session score.
    idRef.current += 1;
    setLast({ id: idRef.current, q: question, saidYes, correct: event.correct });
    setScore((s) => ({ right: s.right + (event.correct ? 1 : 0), total: s.total + 1 }));
    if (eyesFree) {
      // The verdict, then the next question once it has been said (or at
      // once on forward). Not timed: see the component comment.
      const verdict = narrateYesNoVerdict(event.correct, question.answer);
      audio.ding(event.correct ? 'good' : 'bad');
      say(verdict);
      feedbackRef.current = { verdict, prev: question.cellId };
      clearAdvance();
      advanceTimerRef.current = window.setTimeout(
        nextAfterVerdict,
        autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenPauseFor(verdict, settings.audio.rate)),
      );
      return;
    }
    // #30: idle answers are graded but not timed.
    if (event.elapsedMs !== undefined) setTimes((t) => [...t, event.elapsedMs!]);
    setQuestion(drawSpeedQuestion(mode, deck, rules, randomSeed(), question.cellId));
    shownAtRef.current = performance.now();
    releaseAnswerFocus();
  };

  // C-R1: the wheel, eyes-free only. Both buttons answer (there is no
  // microphone here, so push-to-talk has nothing to open); on a verdict,
  // forward goes on and back says it again.
  useWheelCommand((command) => {
    const fb = feedbackRef.current;
    if (fb) {
      if (command === 'forward') nextAfterVerdict();
      else say(fb.verdict);
      return;
    }
    answer(command === 'forward');
  }, eyesFree);

  const handleBack = () => {
    clearAdvance();
    if (eyesFree) cancelSpeech();
    onBack();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      const yes = speedKeyAnswer(e.key);
      if (yes === null) return;
      e.preventDefault();
      answer(yes);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, mode, deck, rules]);

  const pickMode = (next: SpeedMode) => {
    if (next === mode) return;
    const updated = { ...settings, drill: { ...settings.drill, speedMode: next } };
    saveSettings(updated);
    onSettingsChange(updated);
  };

  const median = medianMs(times);

  return (
    <div className="drill-screen speed-drill">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Speed</div>
        <div className="speed-stats" data-testid="speed-stats">
          <span data-testid="speed-score">
            {score.right}/{score.total}
          </span>
          <span className="speed-median" data-testid="speed-median">
            {median === null ? '–' : `${(median / 1000).toFixed(1)}s`}
          </span>
        </div>
      </div>

      <div className="drill-inline-controls">
        <div className="speed-modes" role="group" aria-label="Question">
          {SPEED_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`speed-mode-chip${m === mode ? ' speed-mode-chip-on' : ''}`}
              aria-pressed={m === mode}
              data-testid={`speed-mode-${m}`}
              onClick={() => pickMode(m)}
            >
              {SPEED_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <HandDeckControls settings={settings} onChange={onSettingsChange} />
        <EyesFreeCheckbox settings={settings} onSettingsChange={onSettingsChange} eyesFree={eyesFree} onChange={setEyesFree} />
      </div>

      {question ? (
        <>
          <div className="speed-question" data-testid="speed-question">
            {SPEED_QUESTION[mode]}
            {question.tc !== null && (
              <span className="speed-tc" data-testid="speed-tc">
                TC {formatSigned(question.tc)}
              </span>
            )}
          </div>
          <div className="dealer-area">
            <PlayingCard card={{ rank: question.up, suit: 's' }} />
          </div>
          <div className="hands-row">
            <div className="hand-cards" data-testid="speed-hand" data-cell-id={question.cellId}>
              {question.cards.map((c, i) => (
                <PlayingCard key={i} card={c} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="empty-deck" role="status" data-testid="speed-nothing">
          {nothingToAsk(mode, rules.ls)}
        </p>
      )}

      <div className="message-strip">
        {last && (
          <ResultStrip id={last.id} tone={last.correct ? 'ok' : 'miss'}>
            <div className="speed-result" data-testid="speed-result" data-cell-id={last.q.cellId}>
              {last.correct ? (
                <div className="result-correct">
                  Correct! {resultHandLine(last.q)} — <Word yes={last.q.answer} />
                </div>
              ) : (
                <div className="speed-result-miss">
                  {resultHandLine(last.q)}: you said <Word yes={last.saidYes} />, answer{' '}
                  <strong>
                    <Word yes={last.q.answer} />
                  </strong>
                </div>
              )}
              <div className="speed-result-reason" data-testid="speed-result-reason">
                {speedReason(last.q)}
              </div>
            </div>
          </ResultStrip>
        )}
      </div>

      <div className="action-bar speed-answer-bar">
        <button
          type="button"
          className="speed-answer speed-answer-no"
          data-testid="speed-no"
          data-answer={yesNo(false)}
          disabled={!question}
          onClick={() => answer(false)}
        >
          No
        </button>
        <button
          type="button"
          className="speed-answer speed-answer-yes"
          data-testid="speed-yes"
          data-answer={yesNo(true)}
          disabled={!question}
          onClick={() => answer(true)}
        >
          Yes
        </button>
      </div>
    </div>
  );
}
