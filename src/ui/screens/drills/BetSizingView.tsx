import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import {
  appendBetSizingRow,
  betAnswerLabel,
  betSizingOptions,
  betSizingRow,
  betSizingWorking,
  correctBetAnswer,
  gradeBetSizing,
  makeBetSizingScenario,
  scenarioTc,
  trayFloorDecks,
  type BetAnswer,
  type BetSizingScenario,
} from '../../../drills/betSizing';
import { signed } from '../../../drills/signed';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';
import { focusSwallowsKey } from '../../keyboardFocus';
import { answerTooSoon } from '../../answerBounce';
import { DiscardTray } from '../../components/DiscardTray';
import { ResultStrip } from '../../components/ResultStrip';
import { DrillPrimaryBar } from '../../components/DrillPrimaryBar';
import './tcResultStrip.css';
import './betSizing.css';
import { BET_SIZING_DRILL, BET_SIZING_INTRO } from './betSizingCopy';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

interface Feedback {
  id: number;
  ok: boolean;
  correct: BetAnswer;
  working: string;
}

/**
 * Wave B B4: the Bet sizing drill, replacing Bet or sit. The player sees what
 * Play's table shows before a deal (running count, discard tray) and bets a
 * rung of their own spread, or sits out. Grading is drills/betSizing.ts, which
 * calls the same engine functions Play does.
 *
 * Eyes-free is deliberately not read: there is no audio path beyond the ding,
 * so the screen renders the same either way.
 */
export function BetSizingView({
  settings,
  activeProfile,
  onBack,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
}) {
  const totalDecks = activeProfile.rules.decks;
  // #17: no tray deeper than this profile's cut card lets Play deal.
  const floor = trayFloorDecks(activeProfile);
  const audio = useAudio(settings.audio);
  const options = betSizingOptions(activeProfile.spread);
  const [scenario, setScenario] = useState<BetSizingScenario>(() =>
    makeBetSizingScenario(randomSeed(), totalDecks, activeProfile.spread, floor),
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const resultShownAtRef = useRef(performance.now());

  const answer = (taken: BetAnswer) => {
    // The grid stays mounted during the result; this guard is what keeps a
    // double tap to one recorded answer.
    if (feedback) return;
    const tc = scenarioTc(scenario, activeProfile.tcRounding);
    const ok = gradeBetSizing(taken, tc, activeProfile);
    saveStats(appendBetSizingRow(loadStats(), betSizingRow(scenario, activeProfile, taken, new Date().toISOString())));
    audio.ding(ok ? 'good' : 'bad');
    resultShownAtRef.current = performance.now();
    setFeedback({
      id: Date.now(),
      ok,
      correct: correctBetAnswer(tc, activeProfile.spread),
      working: betSizingWorking(scenario, activeProfile),
    });
  };

  const next = () => {
    if (answerTooSoon(resultShownAtRef.current)) return;
    setScenario(makeBetSizingScenario(randomSeed(), totalDecks, activeProfile.spread, floor));
    setFeedback(null);
  };

  const back = () => {
    if (answerTooSoon(resultShownAtRef.current)) return;
    onBack();
  };

  // Keyboard: digit k answers options[k-1]; Enter/Space on the result = Next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      if (!feedback) {
        if (/^[1-9]$/.test(e.key)) {
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
  }, [feedback, scenario, activeProfile]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">{BET_SIZING_DRILL}</div>
      </div>

      <div className="settings-row settings-note-row">
        {BET_SIZING_INTRO}
      </div>

      <div
        className="bet-sizing-snapshot"
        data-rc={scenario.rc}
        data-cards-dealt={scenario.cardsDealt}
        data-decks={scenario.totalDecks}
      >
        <div className="bet-rc">RC {signed(scenario.rc)}</div>
        <DiscardTray cardsDealt={scenario.cardsDealt} decks={scenario.totalDecks} />
        <div className="deck-tray-context">{scenario.totalDecks}-deck shoe</div>
      </div>

      <div
        className={`bet-sizing-answers${feedback ? ' bet-sizing-answers--done' : ''}`}
        aria-disabled={feedback ? 'true' : undefined}
      >
        {options.map((o) => (
          <button key={String(o)} type="button" className="bet-sizing-btn" onClick={() => answer(o)}>
            {betAnswerLabel(o)}
          </button>
        ))}
      </div>

      {feedback && (
        <>
          <div className="tc-strip-wrap">
            <ResultStrip id={feedback.id} tone={feedback.ok ? 'ok' : 'miss'}>
              <div className="bet-verdict">
                {feedback.ok ? 'Correct' : `Wrong — ${betAnswerLabel(feedback.correct)}`}
              </div>
              <div className="bet-working">{feedback.working}</div>
              {activeProfile.coverBets && (
                <div className="bet-cover">Cover bets on: one rung either side counts.</div>
              )}
            </ResultStrip>
          </div>
          <DrillPrimaryBar label="Next" variant="next" onPrimary={next} secondaryLabel="Back to Drills" onSecondary={back} />
        </>
      )}
    </div>
  );
}
