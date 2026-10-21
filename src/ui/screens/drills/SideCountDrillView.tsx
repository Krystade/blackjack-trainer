import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { loadStats, saveStats } from '../../../store/persist';
import { addSideDrillRun } from '../../../store/sideBetStats';
import { BET_NAMES, SIDE_BET_IDS, payTablesFor } from '../../../engine/sideBets/payTables';
import type { SideBetId } from '../../../engine/sideBets/payTables';
import { describeTags } from '../../../engine/sideBets/counts';
import { sidePlan } from '../../../engine/sideBets/plan';
import type { SidePlan } from '../../../engine/sideBets/plan';
import { decksText, gradeSideAnswer, makeSideCountRun, startSideCount } from '../../../drills/sideCountDrill';
import type { SideCountRun, SideQuestion } from '../../../drills/sideCountDrill';
import type { CheckpointFreq } from '../../../drills/countCheckpoints';
import { signed } from '../../../drills/signed';
import { PlayingCard } from '../../components/PlayingCard';
import { NumPad } from '../../components/NumPad';
import { Segmented, Stepper } from '../Settings';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, speak, speakAsync } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { narrateCards, narrateCountAnswer, narrateReadback, NO_COUNT_YET, SAY_YES_AGAIN } from '../../../audio/narrate';
import { parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../../audio/voiceNumber';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../../audio/voiceRecognition';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { useWheelNumber } from '../../useWheelNumber';
import { useVoiceToggle } from '../../voiceSession';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { VoiceStatusBar } from '../../components/VoiceStatusBar';
import { enableAudioNow } from '../../audioGate';
import { profileSideBet } from '../../sideBetConfig';
import { cutDecksOf } from '../../profileOptions';
import {
  HILO_COUNT_PROMPT,
  SIDE_COUNT_PROMPT,
  SIDE_SAYS_BET,
  SIDE_SAYS_SKIP,
  narrateBetSidePrompt,
  narrateSideStart,
  triggerText,
} from '../../sideBetFeedback';
import './sideCountDrill.css';

/**
 * Wave L: the side count drill -- the count drill's run, kept with a side
 * bet's count (and, if asked, Hi-Lo beside it), closed by "bet the side?".
 *
 * Eyes-free like the count drill: the cards are said (with their suits when
 * the count is a suit count), every question is said, a number is answered
 * by voice (read back, confirmed with "yes") or walked on the wheel (forward
 * +1, back −1, quiet commits), and the bet question is the wheel's two
 * verdicts: forward bet, back no bet -- as "yes" and "no" are by voice.
 *
 * Review S6: a run is usually picked up mid-shoe (sideCountDrill.ts), so it
 * opens on the 'start' phase: the counts so far and the decks left, shown and
 * said, held until "yes" / wheel forward / the button -- the counts have to
 * be taken in before the first card.
 */

type Phase = 'setup' | 'start' | 'flashing' | 'asking' | 'result';

const SUIT_GLYPHS = ['♠', '♥', '♦', '♣'];

interface Answered {
  q: SideQuestion;
  answer: number | boolean;
  correct: boolean;
  cardsShown: number;
}

const PACES = [600, 900, 1200, 1800, 2500];

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** `?seed=N` (as Play takes it): run k of the visit is seeded N + k, so a test can know every card. */
function urlSeed(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The bets with a count at this game (some pay table of it is countable or always worth it). */
function countableBets(profile: Profile): { bet: SideBetId; payTable: string; plan: SidePlan }[] {
  const out: { bet: SideBetId; payTable: string; plan: SidePlan }[] = [];
  const own = profileSideBet(profile);
  for (const bet of SIDE_BET_IDS) {
    const tables = payTablesFor(bet).map((t) => t.id);
    if (own?.bet === bet) tables.unshift(own.payTable);
    for (const id of tables) {
      const plan = sidePlan(bet, id, profile.rules.decks, profile.rules.s17);
      if (plan?.count) {
        out.push({ bet, payTable: id, plan });
        break;
      }
    }
  }
  return out;
}

function questionLabel(q: SideQuestion): string {
  if (q.kind === 'bet') return `${decksText(q.decksLeft)} ${q.decksLeft === 1 ? 'deck' : 'decks'} left — bet the side?`;
  return q.count === 'hilo' ? 'Hi-Lo running count?' : 'Side running count?';
}

function questionSpeech(q: SideQuestion): string {
  if (q.kind === 'bet') return narrateBetSidePrompt(q.decksLeft);
  return q.count === 'hilo' ? HILO_COUNT_PROMPT : SIDE_COUNT_PROMPT;
}

export function SideCountDrillView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange: (s: Settings) => void;
}) {
  const audio = useAudio(settings.audio);
  const bets = useMemo(() => countableBets(activeProfile), [activeProfile]);
  // The profile's own side bet first, when it is countable here.
  const [betIdx, setBetIdx] = useState(() => {
    const own = profileSideBet(activeProfile);
    return Math.max(0, own ? bets.findIndex((b) => b.bet === own.bet) : 0);
  });
  const choice = bets[betIdx] ?? null;
  const [cards, setCards] = useState(26);
  const [paceMs, setPaceMs] = useState(1200);
  const [checkpoints, setCheckpoints] = useState<CheckpointFreq>('one');
  const [withHiLo, setWithHiLo] = useState(false);
  const [eyesFree, setEyesFree] = useEyesFreeToggle('side-count-drill');
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  const [voiceOn, setVoiceOn] = useVoiceToggle('side-count-drill');

  const [phase, setPhase] = useState<Phase>('setup');
  const phaseRef = useRef<Phase>('setup');
  const [run, setRun] = useState<SideCountRun | null>(null);
  const [shown, setShown] = useState(-1);
  const [stopIdx, setStopIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<Answered[]>([]);
  // The keypad's text; a spoken or wheeled number writes through to it, so the
  // screen shows what is standing (as the count drill does).
  const [padText, setPadText] = useState('');
  const pending = /\d/.test(padText) ? parseInt(padText, 10) : null;
  const setPending = (n: number | null) => setPadText(n === null ? '' : String(n));
  const runIdRef = useRef(0);
  const runsRef = useRef(0);
  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const sayBack = (text: string, interrupt = false) => {
    speak(text, speechOptsFrom(settings.audio, interrupt ? { interrupt: true } : {}));
  };
  const spoken = eyesFree || voiceOn;

  const stop = run?.stops[stopIdx] ?? null;
  const question = stop?.questions[qIdx] ?? null;
  const detail = choice?.plan.count?.kind === 'suit' ? 'full' : 'rank';

  const start = () => {
    if (!choice?.plan.count) return;
    const fixed = urlSeed();
    const seed = fixed === null ? randomSeed() : fixed + runsRef.current;
    runsRef.current += 1;
    const r = makeSideCountRun({
      count: choice.plan.count,
      plan: { always: choice.plan.always, count: choice.plan.count, trigger: choice.plan.trigger, betBelow: choice.plan.betBelow },
      decks: activeProfile.rules.decks,
      cards,
      groupSize: 1,
      checkpoints,
      withHiLo,
      seed,
      cutDecks: cutDecksOf(activeProfile),
    });
    runIdRef.current += 1;
    setRun(r);
    setShown(-1);
    setStopIdx(0);
    setQIdx(0);
    setAnswers([]);
    setPending(null);
    go(r.start.dealt > 0 ? 'start' : 'flashing');
  };

  const begin = () => {
    if (phaseRef.current === 'start') go('flashing');
  };

  // The start, said (eyes-free or by voice) when it is shown.
  useEffect(() => {
    if (phase !== 'start' || !run) return;
    if (spoken) sayBack(narrateSideStart(run.start, withHiLo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run]);

  // The flash: one group per beat, held for the pace; eyes-free, each group
  // is said and the next follows the line. A stop is reached once its group
  // has been shown (and said), and the questions follow.
  useEffect(() => {
    if (phase !== 'flashing' || !run) return;
    const id = runIdRef.current;
    const target = run.stops[stopIdx]!.atGroup;
    const resumedAt = stopIdx > 0 ? run.stops[stopIdx - 1]!.atGroup : -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      if (runIdRef.current !== id) return;
      if (shown >= target) go('asking');
      else setShown(shown + 1);
    };
    if (eyesFree && shown >= 0 && shown !== resumedAt) {
      void speakAsync(narrateCards(run.groups[shown]!, detail), speechOptsFrom(settings.audio)).then(() => {
        timer = setTimeout(step, 150);
      });
    } else {
      timer = setTimeout(step, shown < 0 || shown === resumedAt ? 300 : paceMs);
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shown, run, stopIdx]);

  // Each question, said when it is asked (eyes-free or by voice).
  useEffect(() => {
    if (phase !== 'asking' || !question) return;
    if (spoken) sayBack(questionSpeech(question));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stopIdx, qIdx]);

  const finish = (all: Answered[]) => {
    go('result');
    if (!choice) return;
    const stats = loadStats();
    saveStats(
      addSideDrillRun(stats, {
        date: new Date().toISOString(),
        bet: choice.bet,
        withHiLo,
        checkpoints: all.length,
        correct: all.filter((a) => a.correct).length,
      }),
    );
    if (spoken) sayBack(SAY_YES_AGAIN);
  };

  const answer = (value: number | boolean) => {
    if (phaseRef.current !== 'asking' || !question || !stop || !run) return;
    const correct = gradeSideAnswer(question, value);
    audio.ding(correct ? 'good' : 'bad');
    if (!correct && spoken) {
      sayBack(question.kind === 'bet' ? (question.actual ? SIDE_SAYS_BET : SIDE_SAYS_SKIP) : narrateCountAnswer(question.actual), true);
    }
    const all = [...answers, { q: question, answer: value, correct, cardsShown: stop.cardsShown }];
    setAnswers(all);
    setPending(null);
    wheel.reset();
    if (qIdx + 1 < stop.questions.length) {
      setQIdx(qIdx + 1);
      return;
    }
    if (stopIdx + 1 < run.stops.length) {
      setStopIdx(stopIdx + 1);
      setQIdx(0);
      go('flashing');
      return;
    }
    finish(all);
  };

  const wheel = useWheelNumber({
    readback: (value) => sayBack(narrateReadback(value), true),
    commit: (value) => {
      setPending(null);
      answer(value);
    },
  });

  const handleVoice = (action: VoiceAction) => {
    const p = phaseRef.current;
    if (p === 'start') {
      if (action === 'yes') begin();
      else if (action === 'repeat' && run) sayBack(narrateSideStart(run.start, withHiLo), true);
      return;
    }
    if (p === 'setup' || p === 'result') {
      if (action === 'yes') start();
      else if (action === 'repeat' && p === 'result') sayBack(SAY_YES_AGAIN, true);
      return;
    }
    if (p !== 'asking' || !question) return;
    if (question.kind === 'bet') {
      if (action === 'yes') answer(true);
      else if (action === 'no') answer(false);
      else if (action === 'repeat') sayBack(questionSpeech(question), true);
      return;
    }
    if (action === 'yes') {
      if (pending === null) sayBack(NO_COUNT_YET, true);
      else answer(pending);
    } else if (action === 'no') {
      setPending(null);
      sayBack(questionSpeech(question), true);
    } else if (action === 'repeat') {
      sayBack(pending === null ? questionSpeech(question) : narrateReadback(pending), true);
    }
  };

  const interpretSpeech = (heard: string, offered: readonly string[] = [heard]): string | null => {
    if (phaseRef.current !== 'asking' || question?.kind !== 'count') return null;
    let parsed: ReturnType<typeof parseCountSpeech> = null;
    for (const reading of offered.length > 0 ? offered : [heard]) {
      parsed = parseCountSpeech(reading);
      if (parsed) break;
    }
    if (!parsed) return null;
    const next = parsed.kind === 'value' ? parsed.value : (pending ?? 0) + parsed.delta;
    setPending(next);
    sayBack(narrateReadback(next), true);
    return `count ${speakableCount(next)}`;
  };

  // The wheel: a number is walked; the bet question is its two verdicts;
  // elsewhere forward starts and back repeats.
  useWheelCommand((command) => {
    if (phaseRef.current === 'asking' && question?.kind === 'count') {
      setPending(wheel.press(command));
      return;
    }
    if (phaseRef.current === 'asking' && question?.kind === 'bet') {
      answer(command === 'forward');
      return;
    }
    handleVoice(command === 'forward' ? 'yes' : 'repeat');
  });

  const voice = useVoiceControl({
    enabled: voiceOn,
    onAction: handleVoice,
    onTranscript: interpretSpeech,
    onNotUnderstood: () => audio.ding('again'),
    escalation: { promptKey: [phase, stopIdx, qIdx], reask: () => handleVoice('repeat') },
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    onListening: () => audio.dingWhenQuiet('ready'),
    context: 'side-count-drill',
  });

  useEffect(() => () => cancelSpeech(), []);

  const leave = () => {
    runIdRef.current += 1;
    cancelSpeech();
    onBack();
  };

  const plan = choice?.plan ?? null;
  const shownCards = run && shown >= 0 ? run.groups[shown] : null;
  const right = answers.filter((a) => a.correct).length;

  return (
    <div className="drill-screen side-count-drill" data-testid="side-count-drill" data-phase={phase}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={leave}>
          Back
        </button>
        <div className="drill-heading">Side count</div>
      </div>

      {voiceOn && <VoiceStatusBar status={voice.status} hint={<>Say: the count, &ldquo;yes&rdquo; to confirm &middot; &ldquo;yes&rdquo; / &ldquo;no&rdquo; to bet</>} />}

      {phase === 'setup' && (
        <div className="count-setup">
          {bets.length === 0 ? (
            <p className="stats-detail">No side bet is countable at {activeProfile.rules.decks} decks.</p>
          ) : (
            <>
              <div className="settings-row">
                <span className="settings-label">Bet</span>
                <select
                  className="settings-select"
                  value={String(betIdx)}
                  data-testid="side-drill-bet"
                  onChange={(e) => setBetIdx(Number(e.target.value))}
                >
                  {bets.map((b, i) => (
                    <option key={b.bet} value={i}>
                      {BET_NAMES[b.bet]}
                    </option>
                  ))}
                </select>
              </div>
              {plan?.count && (
                <p className="stats-detail side-drill-count" data-testid="side-drill-count">
                  {plan.count.name}
                  {plan.count.kind === 'tags' && plan.count.tags ? ` — ${describeTags(plan.count.tags)}` : ' — most cards of one suit minus fewest'}
                  . Bet {triggerText(plan)} (true count, floored; {activeProfile.rules.decks} decks).
                </p>
              )}
              <Stepper label="Cards" value={cards} min={8} max={Math.max(8, activeProfile.rules.decks * 52 - 26)} step={2} onChange={setCards} />
              <div className="settings-row">
                <span className="settings-label">Pace</span>
                <Segmented
                  options={PACES.map((p) => ({ value: String(p), label: `${(p / 1000).toFixed(1)}s` }))}
                  value={String(paceMs)}
                  onChange={(v) => setPaceMs(Number(v))}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">Checkpoints</span>
                <Segmented
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'one', label: 'One' },
                    { value: 'few', label: 'Two' },
                  ]}
                  value={checkpoints}
                  onChange={(v) => setCheckpoints(v as CheckpointFreq)}
                />
              </div>
              <label className="count-toggle">
                <input type="checkbox" checked={withHiLo} onChange={(e) => setWithHiLo(e.target.checked)} />
                Keep Hi-Lo too
              </label>
              <label className="count-toggle">
                <input
                  type="checkbox"
                  checked={eyesFree}
                  onChange={(e) => {
                    if (e.target.checked && !settings.audio.enabled) enableAudioNow(settings, onSettingsChange);
                    setEyesFree(e.target.checked);
                  }}
                />
                Eyes-free audio
              </label>
              {voiceSupported && (
                <label className="count-toggle">
                  <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
                  Voice answers
                </label>
              )}
              <button type="button" className="drill-primary-btn drill-start-btn" data-testid="side-drill-start" onClick={start}>
                Start
              </button>
            </>
          )}
        </div>
      )}

      {phase === 'start' && run && (
        <div className="side-drill-start" data-testid="side-drill-start-panel">
          <div className="side-drill-start-head">Picking up a shoe</div>
          <div className="side-drill-start-decks" data-testid="side-drill-start-decks">
            {decksText(run.start.decksLeft)} {run.start.decksLeft === 1 ? 'deck' : 'decks'} left
          </div>
          <div className="side-drill-start-dealt">{run.start.dealt} cards dealt, not shown</div>
          <dl className="side-drill-start-counts">
            {run.start.suits ? (
              <div className="side-drill-start-fig">
                <dt>Suits seen, above the fewest</dt>
                <dd className="side-drill-suits" data-testid="side-drill-start-suits">
                  {run.start.suits.map((n, i) => (
                    <span key={i} className="side-drill-suit" data-suit={i}>
                      <span aria-hidden="true">{SUIT_GLYPHS[i]}</span> {n}
                    </span>
                  ))}
                  <span className="side-drill-suit-spread">spread {startSideCount(run.start)}</span>
                </dd>
              </div>
            ) : (
              <div className="side-drill-start-fig">
                <dt>Side count</dt>
                <dd data-testid="side-drill-start-side">{signed(run.start.sideRc, { plusZero: true })}</dd>
              </div>
            )}
            {withHiLo && (
              <div className="side-drill-start-fig">
                <dt>Hi-Lo</dt>
                <dd data-testid="side-drill-start-hilo">{signed(run.start.hiLoRc, { plusZero: true })}</dd>
              </div>
            )}
          </dl>
          <button type="button" className="drill-primary-btn drill-start-btn side-drill-begin" data-testid="side-drill-begin" onClick={begin}>
            Start counting
          </button>
        </div>
      )}

      {phase === 'flashing' && (
        <div className="side-drill-flash" data-testid="side-drill-flash">
          {/* The count drill's card stage (cardSize.css): the same card size. */}
          {shownCards && !eyesFree ? (
            <div className="count-flash-cards">
              {shownCards.map((c, i) => (
                <PlayingCard key={`${shown}-${i}`} card={c} />
              ))}
            </div>
          ) : (
            <div className="side-drill-blank" />
          )}
          <div className="side-drill-progress">
            {Math.max(0, shown + 1)} / {run?.groups.length ?? 0}
          </div>
        </div>
      )}

      {phase === 'asking' && question && (
        <div className="side-drill-ask" data-testid="side-drill-ask" data-kind={question.kind}>
          <div className="side-drill-question" data-testid="side-drill-question">
            {question.kind === 'count' ? `After ${stop!.cardsShown} ${run && run.start.dealt > 0 ? 'more ' : ''}cards` : questionLabel(question)}
          </div>
          {question.kind === 'count' ? (
            <NumPad
              label={questionLabel(question)}
              onSubmit={answer}
              value={padText}
              onValueChange={setPadText}
            />
          ) : (
            <div className="side-drill-bet-buttons">
              <button type="button" className="action-btn" data-testid="side-drill-yes" onClick={() => answer(true)}>
                Bet
              </button>
              <button type="button" className="action-btn" data-testid="side-drill-no" onClick={() => answer(false)}>
                No bet
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'result' && (
        <div className="side-drill-result" data-testid="side-drill-result">
          <div className="side-drill-score">
            {right} of {answers.length} right
          </div>
          <ul className="side-drill-answers">
            {answers.map((a, i) => (
              <li key={i} className={a.correct ? 'result-correct' : 'result-wrong'} data-testid="side-drill-answer">
                {a.q.kind === 'bet'
                  ? `Bet? ${a.answer ? 'bet' : 'no bet'} — ${a.q.actual ? 'bet it' : 'no bet'} at true count ${signed(a.q.tc, { plusZero: true })}`
                  : `${a.q.count === 'hilo' ? 'Hi-Lo' : 'Side'} after ${a.cardsShown} cards: ${signed(a.answer as number, { plusZero: true })}${a.correct ? '' : ` — was ${signed(a.q.actual, { plusZero: true })}`}`}
              </li>
            ))}
          </ul>
          <button type="button" className="drill-primary-btn drill-replay-btn" onClick={start}>
            Again
          </button>
        </div>
      )}
    </div>
  );
}
