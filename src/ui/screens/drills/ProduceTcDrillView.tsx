import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import {
  makeProduceTcRound,
  gradeProducedTc,
  producedTcBand,
} from '../../../drills/produceTcDrill';
import type { ProduceTcRound } from '../../../drills/produceTcDrill';
import { PlayingCard } from '../../components/PlayingCard';
import { NumPad } from '../../components/NumPad';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function formatDecks(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

type Phase = 'flashing' | 'answering' | 'result';

/**
 * V3-2 (docs/BACKLOG.md, red-team v3): the "produce a true count" drill. Unlike
 * the true-count drill (which hands you RC + decks), here you MAINTAIN the count
 * as cards flash, ESTIMATE decks-remaining from a discard tray, and PRODUCE the
 * true count from the two — the real live-table composition. Visual-only v1;
 * graded with the by-eye depth tolerance (drills/produceTcDrill.ts). Reuses the
 * count-drill length/pace settings.
 */
/**
 * V4-3 (docs/BACKLOG.md): the shoe size comes from the ACTIVE PROFILE.
 *
 * It used to be a hardcoded 6 here AND separately in the drill module, while
 * the app happily runs 1-, 2-, 6- and 8-deck profiles. A double-deck player
 * was being drilled on 6-deck conversions: the divisor range they actually
 * face is 0.5-2, and every question they ever saw ran to 6.
 */
export function ProduceTcDrillView({
  settings,
  activeProfile,
  onBack,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
}) {
  const totalDecks = activeProfile.rules.decks;
  const audio = useAudio(settings.audio);
  const [round, setRound] = useState<ProduceTcRound>(() =>
    makeProduceTcRound(
      settings.drill.countLengthCards,
      settings.drill.countGroup,
      randomSeed(),
      totalDecks,
    ),
  );
  const [phase, setPhase] = useState<Phase>('flashing');
  const [shownIndex, setShownIndex] = useState(0);
  const [answer, setAnswer] = useState<{ produced: number; correct: boolean } | null>(null);
  const runIdRef = useRef(0);

  const groups = round.round.groups;

  // Flash the groups on the configured interval, then enter the answer phase.
  useEffect(() => {
    if (phase !== 'flashing') return undefined;
    const runId = runIdRef.current;
    const isLast = shownIndex >= groups.length - 1;
    const t = setTimeout(() => {
      if (runIdRef.current !== runId) return;
      if (isLast) setPhase('answering');
      else setShownIndex((i) => i + 1);
    }, settings.drill.countIntervalMs);
    return () => clearTimeout(t);
  }, [phase, shownIndex, groups.length, settings.drill.countIntervalMs]);

  const submit = (produced: number) => {
    const correct = gradeProducedTc(produced, round);
    setAnswer({ produced, correct });
    setPhase('result');
    audio.ding(correct ? 'good' : 'bad');

    const stats = loadStats();
    saveStats({
      ...stats,
      produceTc: {
        history: [
          ...stats.produceTc.history,
          { date: new Date().toISOString(), produced, correctTc: round.correctTc, correct },
        ],
      },
    });
  };

  const next = () => {
    runIdRef.current += 1;
    setRound(
      makeProduceTcRound(
        settings.drill.countLengthCards,
        settings.drill.countGroup,
        randomSeed(),
        totalDecks,
      ),
    );
    setShownIndex(0);
    setAnswer(null);
    setPhase('flashing');
  };

  const currentGroup = shownIndex < groups.length ? groups[shownIndex] : null;
  const dealtFraction = (totalDecks - round.decksRemaining) / totalDecks;
  const fillPct = Math.min(98, Math.max(2, dealtFraction * 100));

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Produce the True Count</div>
      </div>

      {phase === 'flashing' && (
        <div className="count-flash-area">
          <div className="count-flash-cards">
            {currentGroup?.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
          <div className="count-flash-progress">
            {shownIndex + 1} / {groups.length} — keep the running count
          </div>
        </div>
      )}

      {(phase === 'answering' || phase === 'result') && (
        <>
          <div className="settings-row settings-note-row">
            Judge the tray for decks remaining, then produce the TRUE count.
          </div>
          <div className="table-discard-tray" aria-label="Discard tray">
            <span className="table-discard-label">Discard</span>
            <div className="table-discard-frame">
              <div className="table-discard-fill" style={{ width: `${fillPct}%` }} />
            </div>
          </div>
          {/* V4-3: the shoe size is the profile's now, so the tray alone is
              ambiguous -- a half-full tray is 1 deck left in a 2-deck shoe and
              3 in a 6-deck one. Same line DeckEstimationView carries. */}
          <div className="deck-tray-context deck-tray-context-flow">{totalDecks}-deck shoe</div>
        </>
      )}

      {phase === 'answering' && <NumPad label="Enter the true count" onSubmit={submit} />}

      {phase === 'result' && answer && (
        <div className="drill-result">
          <div className={answer.correct ? 'result-correct' : 'result-wrong'}>
            {answer.correct ? 'Correct!' : 'Off'}
          </div>
          <div className="result-detail">
            You produced {formatSigned(answer.produced)}; true count was {formatSigned(round.correctTc)}{' '}
            (running count {formatSigned(round.round.finalRc)} ÷ {formatDecks(round.decksRemaining)} decks).
            {(() => {
              // Say what was actually accepted, or the grade looks arbitrary:
              // the range comes from reading the tray half a deck either way,
              // and it is far wider late in the shoe than early.
              const band = producedTcBand(round);
              return band.min === band.max ? null : (
                <>
                  {' '}
                  A half-deck either way puts it between {formatSigned(band.min)} and{' '}
                  {formatSigned(band.max)}, so anything in that range counts.
                </>
              );
            })()}
          </div>
          <button type="button" className="drill-replay-btn" onClick={next}>
            Next
          </button>
          <button type="button" className="drill-back-btn" onClick={onBack}>
            Back to Drills
          </button>
        </div>
      )}
    </div>
  );
}
