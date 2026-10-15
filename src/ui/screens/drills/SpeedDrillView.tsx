import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { getActiveProfile, strategyRulesFor } from '../../../store/profiles';
import { saveSettings } from '../../../store/persist';
import { persistGrade } from '../../../drills/gradeAnswer';
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
import { focusSwallowsKey } from '../../keyboardFocus';
import { HandDeckControls } from './HandDeckControls';
import { HandDeckGate } from './HandDeckGate';
import { handDeckFor } from './handDeckFor';
import './speedDrill.css';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
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
 * the strip. Visual-only (no voice / wheel path), like Mastery.
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

  // A new mode or deck is a new session.
  const sessionKey = `${mode}|${deck.source}|${deck.ids.join(',')}|${rules.ls}|${rules.s17}|${rules.surrenderIndices}|${rules.decks}`;
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

  const answer = (saidYes: boolean) => {
    if (!question) return;
    // Review fix (c): a bounce's second touch lands on the next hand.
    if (answerTooSoon(shownAtRef.current)) return;
    const elapsedMs = performance.now() - shownAtRef.current;
    const event = buildSpeedEvent(question, saidYes, elapsedMs, Date.now());
    persistGrade(event, null);
    idRef.current += 1;
    setLast({ id: idRef.current, q: question, saidYes, correct: event.correct });
    setScore((s) => ({ right: s.right + (event.correct ? 1 : 0), total: s.total + 1 }));
    // #30: idle answers are graded but not timed.
    if (event.elapsedMs !== undefined) setTimes((t) => [...t, event.elapsedMs!]);
    setQuestion(drawSpeedQuestion(mode, deck, rules, randomSeed(), question.cellId));
    shownAtRef.current = performance.now();
    releaseAnswerFocus();
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
        <button type="button" className="drill-back-btn" onClick={onBack}>
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
