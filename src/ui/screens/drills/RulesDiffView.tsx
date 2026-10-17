import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import type { RuleSet } from '../../../engine/ruleset';
import { comparisonRules, type Comparison } from '../../../engine/rulesDiff';
import {
  diffSummary,
  drawRulesQuestion,
  explainRulesQuestion,
  expectedRulesAnswer,
  gradeRulesAnswer,
  inertNotes,
  planRulesDrill,
  rulesAnswerLabel,
  rulesAnswerOptions,
  rulesQuestionPrompt,
  rulesResultLine,
  sameChartNotice,
  type RulesAnswer,
  type RulesQuestion,
} from '../../../drills/rulesDiffDrill';
import { signed } from '../../../drills/signed';
import { strategyRulesFor } from '../../../store/profiles';
import { useAudio } from '../../../audio/useAudio';
import { focusSwallowsKey } from '../../keyboardFocus';
import { answerTooSoon } from '../../answerBounce';
import { Segmented } from '../Settings';
import { PlayingCard } from '../../components/PlayingCard';
import { DiscardTray } from '../../components/DiscardTray';
import { NumPad } from '../../components/NumPad';
import { ResultStrip } from '../../components/ResultStrip';
import { DrillPrimaryBar } from '../../components/DrillPrimaryBar';
import './tcResultStrip.css';
import './betSizing.css';
import './rulesDiff.css';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

type Decks = RuleSet['decks'];
const DECK_OPTIONS: { value: string; label: string }[] = ['1', '2', '6', '8'].map((d) => ({ value: d, label: d }));
const DEALER_OPTIONS: { value: 'H17' | 'S17'; label: string }[] = [
  { value: 'H17', label: 'H17' },
  { value: 'S17', label: 'S17' },
];
const COMPARISONS: { value: Comparison; label: string }[] = [
  { value: 'h17s17', label: 'H17 ↔ S17' },
  { value: 'decks68', label: '6 ↔ 8 decks' },
  { value: 'custom', label: 'Other game' },
];

interface Feedback {
  id: number;
  ok: boolean;
  taken: RulesAnswer;
  correct: RulesAnswer;
  explain: string;
}

/**
 * Wave B B10: Rules differences. Asks only the plays that change between two
 * rulesets, each question under one side's rules (drawn at random, #56). The
 * question model and all copy are drills/rulesDiffDrill.ts. No stats are
 * recorded (the spec asks for none) and eyes-free is not read.
 */
export function RulesDiffView({
  settings,
  activeProfile,
  onBack,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
}) {
  const audio = useAudio(settings.audio);
  const base = useMemo(() => strategyRulesFor(activeProfile), [activeProfile]);
  const [comparison, setComparison] = useState<Comparison>('h17s17');
  const [customDecks, setCustomDecks] = useState<Decks>(activeProfile.rules.decks);
  const [customS17, setCustomS17] = useState<boolean>(!activeProfile.rules.s17);
  const plan = useMemo(
    () => planRulesDrill(...comparisonRules(base, comparison, { decks: customDecks, s17: customS17 })),
    [base, comparison, customDecks, customS17],
  );
  const identical = drawRulesQuestion(plan, 0, 0) === null;
  // A pool-less plan (6 <-> 8, same chart) still trains the bigger shoe's tray.
  const playable = !identical && (plan.pool.length > 0 || plan.trayDecks !== null);

  const [phase, setPhase] = useState<'setup' | 'question'>('setup');
  const [n, setN] = useState(0);
  const [question, setQuestion] = useState<RulesQuestion | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const resultShownAtRef = useRef(performance.now());

  const options = question ? rulesAnswerOptions(question, plan) : [];

  const ask = (k: number) => {
    setN(k);
    setQuestion(drawRulesQuestion(plan, randomSeed(), k));
    setFeedback(null);
  };

  const start = () => {
    setPhase('question');
    ask(0);
  };

  const answer = (taken: RulesAnswer) => {
    // The answers stay mounted during the result; this guard keeps a double tap to one answer.
    if (!question || feedback) return;
    const ok = gradeRulesAnswer(question, plan, taken, activeProfile.tcRounding);
    audio.ding(ok ? 'good' : 'bad');
    resultShownAtRef.current = performance.now();
    setFeedback({
      id: Date.now(),
      ok,
      taken,
      correct: expectedRulesAnswer(question, plan, activeProfile.tcRounding),
      explain: explainRulesQuestion(question, plan, activeProfile.tcRounding),
    });
  };

  const next = () => {
    if (answerTooSoon(resultShownAtRef.current)) return;
    ask(n + 1);
  };

  const changeComparison = () => {
    if (answerTooSoon(resultShownAtRef.current)) return;
    setPhase('setup');
    setQuestion(null);
    setFeedback(null);
  };

  // Keyboard: digit k answers option k (play and insurance only); Enter/Space on the result = Next.
  useEffect(() => {
    if (phase !== 'question' || !question) return;
    const onKey = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (!feedback) {
        if ((question.kind === 'play' || question.kind === 'insurance') && /^[1-9]$/.test(e.key)) {
          const opt = options[Number(e.key) - 1];
          if (opt !== undefined) {
            e.preventDefault();
            answer(opt);
          }
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, feedback, plan, activeProfile]);

  const topbar = (
    <div className="drill-topbar">
      <button type="button" className="drill-back-btn" onClick={onBack}>
        Back
      </button>
      <div className="drill-heading">Rules differences</div>
    </div>
  );

  if (phase === 'setup' || !question) {
    // An identical game gets only its own notice: sameChartNotice would read
    // "Your game and Your game use the same basic chart".
    const notice = identical ? null : sameChartNotice(plan);
    const summary = diffSummary(plan);
    const inert = inertNotes(plan);
    return (
      <div className="drill-screen rules-diff-screen">
        {topbar}
        <div className="rules-diff-controls">
          <Segmented options={COMPARISONS} value={comparison} onChange={setComparison} />
          {comparison === 'custom' && (
            <>
              <div className="rules-diff-label">Decks</div>
              <Segmented
                options={DECK_OPTIONS}
                value={String(customDecks)}
                onChange={(v) => setCustomDecks(Number(v) as Decks)}
              />
              <div className="rules-diff-label">Dealer</div>
              <Segmented
                options={DEALER_OPTIONS}
                value={customS17 ? 'S17' : 'H17'}
                onChange={(v) => setCustomS17(v === 'S17')}
              />
            </>
          )}
        </div>
        {notice !== null && <div className="rules-diff-notice">{notice}</div>}
        {summary.length > 0 && (
          <ul className="rules-diff-summary">
            {summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {inert.length > 0 && (
          <div className="rules-diff-inert">
            {inert.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {identical && <div className="rules-diff-notice">These two games play the same. Pick another comparison.</div>}
        {playable && <DrillPrimaryBar label="Start" variant="start" onPrimary={start} />}
      </div>
    );
  }

  const sideName = plan.names[question.side === 'a' ? 0 : 1];
  const qTc = question.kind === 'play' || question.kind === 'insurance' ? question.tc : null;

  return (
    <div className="drill-screen rules-diff-screen">
      {topbar}
      <div className="rules-diff-inforce">
        Under {sideName}
        {qTc !== null && ` · TC ${signed(qTc)}`}
      </div>
      <div
        className="rules-diff-question"
        data-kind={question.kind}
        data-side={question.side}
        data-cell={question.kind === 'play' ? question.cellId : question.kind}
        data-tc={qTc === null ? undefined : qTc}
        data-cards-dealt={question.kind === 'tray-decks' || question.kind === 'tray-tc' ? question.cardsDealt : undefined}
        data-rc={question.kind === 'tray-tc' ? question.rc : undefined}
      >
        <div className="rules-diff-prompt">{rulesQuestionPrompt(question)}</div>
        {question.kind === 'play' && (
          <>
            <div className="dealer-area">
              <PlayingCard card={{ rank: question.up, suit: 's' }} />
            </div>
            <div className="hands-row">
              <div className="player-hand">
                <div className="hand-cards">
                  {question.cards.map((c, i) => (
                    <PlayingCard key={i} card={c} />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
        {(question.kind === 'tray-decks' || question.kind === 'tray-tc') && (
          <div className="rules-diff-tray">
            {question.kind === 'tray-tc' && <div className="bet-rc">RC {signed(question.rc)}</div>}
            <DiscardTray cardsDealt={question.cardsDealt} decks={question.totalDecks} />
            <div className="deck-tray-context">{question.totalDecks}-deck shoe</div>
          </div>
        )}
      </div>

      {question.kind === 'tray-tc' ? (
        // Unmounted during the result so Enter there means Next, not an empty submit.
        !feedback && (
          <div className="rules-diff-numpad">
            <NumPad label="True count" onSubmit={answer} />
          </div>
        )
      ) : (
        <div
          className={`rules-diff-answers${question.kind === 'tray-decks' ? ' rules-diff-depth' : ''}${feedback ? ' rules-diff-answers--done' : ''}`}
          aria-disabled={feedback ? 'true' : undefined}
        >
          {options.map((o) => (
            <button key={String(o)} type="button" onClick={() => answer(o)}>
              {rulesAnswerLabel(question, o)}
            </button>
          ))}
        </div>
      )}

      {feedback && (
        <>
          <div className="tc-strip-wrap">
            <ResultStrip id={feedback.id} tone={feedback.ok ? 'ok' : 'miss'}>
              <div className="rules-verdict">
                {rulesResultLine(question, feedback.taken, feedback.correct, feedback.ok)}
              </div>
              <div className="rules-explain">{feedback.explain}</div>
            </ResultStrip>
          </div>
          <DrillPrimaryBar
            label="Next"
            variant="next"
            onPrimary={next}
            secondaryLabel="Change comparison"
            onSecondary={changeComparison}
          />
        </>
      )}
    </div>
  );
}
