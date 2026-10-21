import { useEffect, useMemo, useRef, useState } from 'react';
import { sayMomentAtPause } from '../../../habits/moment';
import { mulberry32 } from '../../../engine/cards';
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
import { betVerdictText } from '../../../drills/betVerdict';
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
import './betSizingTaken.css';
import { BET_SIZING_DRILL, BET_SIZING_INTRO } from './betSizingCopy';
import {
  betPropositionLabel,
  betPropositionRow,
  betPropositionVerdictText,
  narrateBetProposition,
  narrateBetVerdict,
  proposeBet,
} from '../../../drills/wheelProposition';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../../drills/answerPause';
import { cancelSpeech, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { useWheelCommand } from '../../useWheelCommand';
import { EyesFreeCheckbox } from './EyesFreeCheckbox';
import { RungProgressLine } from './RungProgressLine';
import { DRILL_RUNG } from './rungProgress';
import './betProposition.css';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

interface Feedback {
  id: number;
  ok: boolean;
  taken: BetAnswer;
  correct: BetAnswer;
  working: string;
  /** C-R1: a yes/no on a proposed bet, when answered eyes-free. */
  saidYes?: boolean;
  /** The spoken verdict, for the wheel's "say it again". */
  spoken?: string;
}

/**
 * Wave B B4: the Bet sizing drill, replacing Bet or sit. The player sees what
 * Play's table shows before a deal (running count, discard tray) and bets a
 * rung of their own spread, or sits out. Grading is drills/betSizing.ts, which
 * calls the same engine functions Play does.
 *
 * C-R1 (W9): eyes-free, the app PROPOSES a bet out loud ("Running count plus
 * three. Two decks remaining. Bet four units?") and the wheel answers it --
 * forward yes, back no -- graded and recorded like a tapped answer, with the
 * verdict spoken. No microphone, no clock. Off eyes-free the screen is the
 * rung grid it always was.
 */
export function BetSizingView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  onSettingsChange?: (settings: Settings) => void;
}) {
  const totalDecks = activeProfile.rules.decks;
  // #17: no tray deeper than this profile's cut card lets Play deal.
  const floor = trayFloorDecks(activeProfile);
  const audio = useAudio(settings.audio);
  const options = betSizingOptions(activeProfile.spread);
  const [scenario, setScenario] = useState<BetSizingScenario>(() =>
    makeBetSizingScenario(randomSeed(), totalDecks, activeProfile.spread, floor, activeProfile.wongExitTc),
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const resultShownAtRef = useRef(performance.now());
  const [eyesFree, setEyesFree] = useEyesFreeToggle('bet-sizing');
  // The proposal's own seed, drawn with each scenario, so a re-render never
  // changes the bet already proposed.
  const [proposalSeed, setProposalSeed] = useState(randomSeed);
  // D-R4: keyed on what grades the bet, not on the profile object's identity.
  // A profile replaced with the same ramp (a settings save, another tab's
  // write) is a new object; it must not re-propose, or re-say, the same bet.
  const gradeKey = JSON.stringify([
    activeProfile.spread,
    activeProfile.coverBets ?? false,
    activeProfile.tcRounding ?? null,
    activeProfile.wongExitTc ?? null,
  ]);
  const proposal = useMemo(
    () => proposeBet(mulberry32(proposalSeed), scenarioTc(scenario, activeProfile.tcRounding), activeProfile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposalSeed, scenario, gradeKey],
  );
  const advanceTimerRef = useRef<number | null>(null);
  const clearAdvance = () => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  };
  useEffect(() => clearAdvance, []);
  const say = (text: string) => speak(text, speechOptsFrom(settings.audio, { interrupt: true }));

  // Eyes-free: propose each scenario's bet out loud, once. D-R4: the last
  // proposal said is remembered, so a re-render that lands on the same
  // scenario and bet (a replaced profile) says nothing again.
  const spokenRef = useRef<{ scenario: BetSizingScenario; proposed: BetAnswer } | null>(null);
  useEffect(() => {
    if (!eyesFree) {
      spokenRef.current = null;
      return;
    }
    if (feedback) return;
    const last = spokenRef.current;
    if (last && last.scenario === scenario && last.proposed === proposal.proposed) return;
    spokenRef.current = { scenario, proposed: proposal.proposed };
    say(narrateBetProposition(scenario, proposal.proposed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, proposal, eyesFree]);

  const nextScenario = () => {
    clearAdvance();
    setScenario(makeBetSizingScenario(randomSeed(), totalDecks, activeProfile.spread, floor, activeProfile.wongExitTc));
    setProposalSeed(randomSeed());
    setFeedback(null);
  };

  /** C-R1: yes (forward) or no (back) to the proposed bet. */
  const answerProposal = (saidYes: boolean) => {
    if (feedback) return;
    const row = betPropositionRow(scenario, activeProfile, proposal.proposed, saidYes, new Date().toISOString());
    saveStats(appendBetSizingRow(loadStats(), row));
    audio.ding(row.ok ? 'good' : 'bad');
    const spoken = narrateBetVerdict(row.ok, row.correct);
    say(spoken);
    resultShownAtRef.current = performance.now();
    setFeedback({
      id: Date.now(),
      ok: row.ok,
      taken: proposal.proposed,
      correct: row.correct,
      working: betSizingWorking(scenario, activeProfile),
      saidYes,
      spoken,
    });
    clearAdvance();
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      nextScenario();
    }, autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenPauseFor(spoken, settings.audio.rate) + sayMomentAtPause(settings.audio)));
  };

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
      taken,
      correct: correctBetAnswer(tc, activeProfile.spread, activeProfile.wongExitTc),
      working: betSizingWorking(scenario, activeProfile),
    });
  };

  const next = () => {
    if (answerTooSoon(resultShownAtRef.current)) return;
    nextScenario();
  };

  const leave = () => {
    clearAdvance();
    if (eyesFree) cancelSpeech();
    onBack();
  };

  const back = () => {
    if (answerTooSoon(resultShownAtRef.current)) return;
    leave();
  };

  // C-R1: the wheel, eyes-free only. On a proposal both buttons answer it;
  // on a verdict, forward goes on and back says it again.
  useWheelCommand((command) => {
    if (feedback) {
      if (command === 'forward') nextScenario();
      else if (feedback.spoken) say(feedback.spoken);
      return;
    }
    answerProposal(command === 'forward');
  }, eyesFree);

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
        <button type="button" className="drill-back-btn" onClick={leave}>
          Back
        </button>
        <div className="drill-heading">{BET_SIZING_DRILL}</div>
      </div>

      <div className="settings-row settings-note-row">
        {BET_SIZING_INTRO}
      </div>

      <div className="settings-row bet-eyes-free-row">
        <EyesFreeCheckbox
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onChange={(on) => {
            if (!on) clearAdvance();
            setEyesFree(on);
          }}
        />
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

      {eyesFree ? (
        <div className="bet-proposition" data-testid="bet-proposition" data-proposed={String(proposal.proposed)}>
          <div className="bet-proposition-ask">{betPropositionLabel(proposal.proposed)}</div>
          <div className={`bet-proposition-answers${feedback ? ' bet-sizing-answers--done' : ''}`}>
            <button type="button" className="bet-proposition-btn" disabled={!!feedback} onClick={() => answerProposal(false)}>
              No
            </button>
            <button type="button" className="bet-proposition-btn" disabled={!!feedback} onClick={() => answerProposal(true)}>
              Yes
            </button>
          </div>
        </div>
      ) : (
      <div
        className={`bet-sizing-answers${feedback ? ' bet-sizing-answers--done' : ''}`}
        aria-disabled={feedback ? 'true' : undefined}
      >
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            className={`bet-sizing-btn${feedback?.taken === o ? ' bet-sizing-btn--taken' : ''}`}
            aria-pressed={feedback ? feedback.taken === o : undefined}
            onClick={() => answer(o)}
          >
            {betAnswerLabel(o)}
          </button>
        ))}
      </div>
      )}

      {feedback && (
        <>
          <div className="tc-strip-wrap">
            <ResultStrip id={feedback.id} tone={feedback.ok ? 'ok' : 'miss'}>
              <div className="bet-verdict">
                {feedback.saidYes === undefined
                  ? betVerdictText(feedback.taken, feedback.correct, feedback.ok)
                  : betPropositionVerdictText(feedback.taken, feedback.saidYes, feedback.correct, feedback.ok)}
              </div>
              <div className="bet-working">{feedback.working}</div>
              {activeProfile.coverBets && (
                <div className="bet-cover">Cover bets on: one rung either side counts.</div>
              )}
            </ResultStrip>
            {/* L-3: the Home ladder rung this drill feeds. */}
            <RungProgressLine rung={DRILL_RUNG.betsizing} profile={activeProfile} />
          </div>
          <DrillPrimaryBar label="Next" variant="next" onPrimary={next} secondaryLabel="Back to Drills" onSecondary={back} />
        </>
      )}
    </div>
  );
}
