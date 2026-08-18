import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Screen } from '../App';
import type { AudioSettings, Profile, Settings, Stats as StatsData } from '../../store/types';
import { EMPTY_STATS } from '../../store/types';
import { filterByRange, RANGE_LABEL } from '../../store/timeRange';
import type { RangeId, TimeRange } from '../../store/timeRange';
import { loadStats, saveStats, loadSettings, exportAll, importAll } from '../../store/persist';
import {
  summarize,
  bestSecondsPerDeck,
  signedErrorBreakdown,
  medianLatency,
  distractionSummary,
} from '../../store/drillStats';
import type { Category, MistakeClass } from '../../engine/grade';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17 } from '../../engine/deviations';
import { useAudio } from '../../audio/useAudio';
import { narrateStatsSummary } from '../../audio/narrate';
import { assistedFlag } from '../peekFlag';
import { fatigueDrift, type DatedResult } from '../../drills/fatigueDrift';
import { Stepper } from './Settings';

interface StatsProps {
  activeProfile: Profile;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: Settings) => void;
}

const CATEGORY_ORDER: Category[] = ['hard', 'soft', 'pairs', 'surrender', 'insurance', 'bet', 'countCheck', 'wong'];

const CATEGORY_LABELS: Record<Category, string> = {
  hard: 'Hard totals',
  soft: 'Soft totals',
  pairs: 'Pairs',
  surrender: 'Surrender',
  insurance: 'Insurance',
  bet: 'Bet sizing',
  countCheck: 'Count checks',
  wong: 'Wong-outs',
};

const MISTAKE_ORDER: Exclude<MistakeClass, 'correct'>[] = [
  'basic-error',
  'missed-deviation',
  'phantom-deviation',
  'wrong-anyway',
];

const MISTAKE_LABELS: Record<Exclude<MistakeClass, 'correct'>, string> = {
  'basic-error': 'Basic-strategy errors',
  'missed-deviation': 'Missed deviations',
  'phantom-deviation': 'Phantom deviations',
  'wrong-anyway': 'Wrong either way',
};

function pct(right: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((right / total) * 100)}%`;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/**
 * R1 (docs/BACKLOG.md, decision-latency telemetry): render a median
 * elapsedMs figure in seconds, one decimal place -- matching the existing
 * `Xs / deck` / `Xs` conventions already used for the timed-count and
 * count-drill sections below. `null` (no captured latency for this
 * category yet) renders as the same "no data" dash used everywhere else.
 */
function formatLatency(ms: number | null): string {
  if (ms === null) return dash();
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** em-dash for "no data" — used throughout the per-profile header. */
function dash(): string {
  return '—';
}

export function Stats({ activeProfile, onNavigate, onSettingsChange }: StatsProps) {
  const [stats, setStats] = useState<StatsData>(() => loadStats());
  const [message, setMessage] = useState<string | null>(null);

  // Time range (operator request). Read-side only: every history entry already
  // carries an ISO `date`, so narrowing the window needs no schema change and
  // no migration. `now` is captured once per render and threaded in, so every
  // section is filtered against the SAME instant instead of each re-reading
  // the clock and disagreeing at a boundary.
  const [range, setRange] = useState<TimeRange>({ id: 'all' });
  const now = Date.now();
  const inRange = <T extends { date?: string }>(xs: readonly T[]): T[] =>
    filterByRange(xs, range, now);
  // ET5: the session-gap for the fatigue-drift analysis is configurable (a gap
  // longer than this splits practice sessions). Local to this screen.
  const [fatigueGapMin, setFatigueGapMin] = useState(30);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Stats isn't handed `settings` as a prop, so it reads audio settings
  // directly from persistence (same pattern as loadStats() above). Refreshed
  // on import in case the imported blob changed audio settings.
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => loadSettings().audio);
  const audio = useAudio(audioSettings);

  const refresh = () => setStats(loadStats());

  const handleSpeakSummary = () => {
    audio.say(narrateStatsSummary(stats), { interrupt: true });
  };

  const handleExport = () => {
    const json = exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bjtrainer-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage('Exported.');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (!window.confirm('Import will overwrite current stats and settings. Continue?')) return;
      const result = importAll(text);
      if (result.ok) {
        refresh();
        onSettingsChange(loadSettings());
        setAudioSettings(loadSettings().audio);
        setMessage('Import successful.');
      } else {
        setMessage(`Import failed: ${result.error ?? 'unknown error'}`);
      }
    };
    reader.onerror = () => setMessage('Import failed: could not read file');
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (!window.confirm('Reset all stats? This cannot be undone.')) return;
    saveStats(structuredClone(EMPTY_STATS));
    refresh();
    setMessage('Stats reset.');
  };

  const countHistory = inRange(stats.countDrill.history);
  const correctHistory = countHistory.filter((h) => h.correct);
  const bestCleanRun =
    correctHistory.length === 0
      ? null
      : correctHistory.reduce((best, cur) => (cur.intervalMs < best.intervalMs ? cur : best));
  const recentRuns = countHistory.slice(-5).reverse();
  const sessions = [...inRange(stats.sessions)].reverse();

  // Cycle-4 per-drill telemetry (docs/research/2026-07-21-priority-list.md
  // item 8): same slice(-5).reverse() "recent runs" idiom as the count
  // drill's recentRuns above, one precomputed block per new drill.
  const trueCountSummary = summarize(stats.trueCount.history);
  const trueCountBreakdown = signedErrorBreakdown(stats.trueCount.history);
  const trueCountRecent = stats.trueCount.history.slice(-5).reverse();

  const deckEstSummary = summarize(stats.deckEstimation.history);
  const deckEstRecent = stats.deckEstimation.history.slice(-5).reverse();

  const timedCountSummary = summarize(stats.timedCount.history);
  const timedCountBest = bestSecondsPerDeck(stats.timedCount.history);
  const timedCountRecent = stats.timedCount.history.slice(-5).reverse();

  // D1 part 2 (docs/BACKLOG.md, distraction training): answer accuracy and
  // count-survival are reported separately -- see distractionSummary's own
  // header comment for why they're independent failure modes.
  const distractionSum = distractionSummary(stats.distraction.history);

  // R8/TS#6 (docs/BACKLOG.md, pair-cancellation): overall accuracy plus a
  // dedicated figure for genuine cancelling pairs (the canonical chunk) --
  // nailing a +2/-2 reinforcing pair is easier than recognizing a +1/-1 that
  // cancels to 0, so the two are worth seeing apart.
  const pairCancelHistory = inRange(stats.pairCancel.history);
  const pairCancelAttempts = pairCancelHistory.length;
  const pairCancelCorrect = pairCancelHistory.filter((h) => h.correct).length;
  const pairCancelCancelling = pairCancelHistory.filter((h) => h.cancelling);
  const pairCancelCancelCorrect = pairCancelCancelling.filter((h) => h.correct).length;

  // RV4 (docs/BACKLOG.md, spaced-repetition): RETAINED accuracy — how you do on
  // items recalled after their SR interval elapsed (a real gap), as distinct
  // from raw in-drill accuracy which is inflated by massed same-session repeats.
  // Retained accuracy is the honest read on whether it will still be there at
  // the table; it only accrues across real days of use, so it can legitimately
  // be empty for a while.
  const retentionHistory = inRange(stats.retention.history);
  const retentionReviews = retentionHistory.length;
  const retentionCorrect = retentionHistory.filter((h) => h.correct).length;

  // ET3 (docs/BACKLOG.md, bet/sit/leave): overall accuracy + a dedicated LEAVE
  // figure — leaving is the novel, hardest axis (R5's wong-out only covers
  // bet vs sit), so it's worth seeing on its own.
  const bslHistory = stats.betSitLeave.history;
  const bslAttempts = bslHistory.length;
  const bslCorrect = bslHistory.filter((h) => h.correct).length;
  const bslLeaveRows = bslHistory.filter((h) => h.correctAction === 'leave');
  const bslLeaveCorrect = bslLeaveRows.filter((h) => h.correct).length;

  // ET1 (V3-1): downswing sessions ridden out + spread-conformity through them.
  const downswingHistory = stats.downswing.history;
  const downswingSessions = downswingHistory.length;
  const downswingConformCorrect = downswingHistory.reduce((s, h) => s + h.correct, 0);
  const downswingConformTotal = downswingHistory.reduce((s, h) => s + h.total, 0);

  // ET5: fatigue drift over the COUNTING runs you've logged (count drill + timed
  // challenge — both dated per-run accuracy), grouped into sessions by the
  // configurable gap. Front-half vs back-half accuracy within a session reveals
  // the vigilance decrement — does your count slip late in a long session?
  const countingResults: DatedResult[] = [
    ...stats.countDrill.history.map((h) => ({ date: h.date, correct: h.correct })),
    ...stats.timedCount.history.map((h) => ({ date: h.date, correct: h.correct })),
  ];
  const fatigue = fatigueDrift(countingResults, { gapMs: fatigueGapMin * 60 * 1000, minPerSession: 6 });
  const fatigueVerdict =
    fatigue.drift === null
      ? null
      : fatigue.drift <= -0.05
        ? 'slips late (fatigue)'
        : fatigue.drift >= 0.05
          ? 'holds up / warms up'
          : 'steady';

  // Per-profile header (Cycle-1 Task 13): CVCX numbers (when the profile has
  // them) alongside actual results computed from this profile's own sessions
  // only (sessions persisted before profileId existed never match, and are
  // simply excluded rather than mis-attributed).
  const profileSessions = stats.sessions.filter((s) => s.profileId === activeProfile.id);
  const totalGraded = profileSessions.reduce((sum, s) => sum + s.graded, 0);
  const totalCorrect = profileSessions.reduce((sum, s) => sum + s.correct, 0);
  const totalRounds = profileSessions.reduce((sum, s) => sum + s.rounds, 0);
  const totalBankrollDelta = profileSessions.reduce((sum, s) => sum + s.bankrollDelta, 0);
  const actualAccuracyPct = totalGraded === 0 ? null : (totalCorrect / totalGraded) * 100;
  // R7 (docs/BACKLOG.md, count-peek accountability / RT#5): the "actual play
  // accuracy" number is uninterpretable if it was silently peek-assisted, so
  // flag the aggregate whenever ANY of this profile's sessions used a peek.
  const totalPeeks = profileSessions.reduce((sum, s) => sum + (s.peeks ?? 0), 0);
  const actualAccuracyAssisted = assistedFlag(totalPeeks);
  // units won / rounds * assumed rounds-per-hour, per spec §4.
  const unitsPerHourProxy = totalRounds === 0 ? null : (totalBankrollDelta / totalRounds) * 80;
  const cvcx = activeProfile.cvcx;

  return (
    <div className="stats-screen">
      <div className="stats-topbar">
        <button type="button" className="stats-back-btn" onClick={() => onNavigate('home')}>
          Back to Home
        </button>
        <div className="stats-heading">Stats</div>
      </div>

      <div className="stats-range">
        <div className="stats-range-options" role="group" aria-label="Time range">
          {(['all', '7d', '30d', '90d', 'since'] as RangeId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`stats-range-btn${range.id === id ? ' stats-range-btn-active' : ''}`}
              aria-pressed={range.id === id}
              onClick={() => setRange((r) => ({ id, since: r.since }))}
            >
              {RANGE_LABEL[id]}
            </button>
          ))}
        </div>
        {range.id === 'since' && (
          <label className="stats-range-since">
            <span className="u-note">From</span>
            <input
              type="date"
              className="settings-select"
              value={range.since ?? ''}
              onChange={(e) => setRange({ id: 'since', since: e.target.value })}
            />
          </label>
        )}
        <p className="u-note">
          {range.id === 'all'
            ? 'Lifetime totals. Category accuracy and the index table are lifetime — they are running tallies, not dated events.'
            : 'Dated sections only. Category accuracy and the index table stay lifetime.'}
        </p>
      </div>

      <section className="stats-section">
        <h2 className="stats-section-title">Profile: {activeProfile.name}</h2>
        <ul className="mistake-list">
          <li className="mistake-row">
            <span>CVCX score</span>
            <span>{cvcx?.score !== undefined ? cvcx.score : dash()}</span>
          </li>
          <li className="mistake-row">
            <span>CVCX EV/hr</span>
            <span>{cvcx?.evPerHour !== undefined ? formatSigned(cvcx.evPerHour) : dash()}</span>
          </li>
          <li className="mistake-row">
            <span>CVCX risk of ruin</span>
            <span>{cvcx?.riskOfRuin !== undefined ? `${cvcx.riskOfRuin}%` : dash()}</span>
          </li>
          <li className="mistake-row">
            <span>CVCX sim note</span>
            <span>{cvcx?.simNote ? cvcx.simNote : dash()}</span>
          </li>
          <li className="mistake-row">
            <span>Actual play accuracy{actualAccuracyAssisted ? ` (${actualAccuracyAssisted})` : ''}</span>
            <span>{actualAccuracyPct === null ? dash() : `${Math.round(actualAccuracyPct)}%`}</span>
          </li>
          <li className="mistake-row">
            <span>Actual units/hr (assumes 80 rounds/hr)</span>
            <span>{unitsPerHourProxy === null ? dash() : formatSigned(Math.round(unitsPerHourProxy * 10) / 10)}</span>
          </li>
        </ul>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Accuracy by category</h2>
        <div className="category-list">
          {CATEGORY_ORDER.map((cat) => {
            const tally = stats.categories[cat];
            const total = tally.right + tally.wrong;
            const pctNum = total === 0 ? 0 : (tally.right / total) * 100;
            // R1: median decision time for this category, sourced from
            // whichever drills currently capture elapsedMs (flashcards +
            // deviation quiz) -- entries lacking it (e.g. table play) never
            // reach latencyHistory at all (see stats.ts applyEvents), so no
            // extra filtering is needed here beyond matching the category.
            const latencyMs = medianLatency(stats.latencyHistory.filter((e) => e.category === cat));
            return (
              <div className="category-row" key={cat}>
                <div className="category-row-top">
                  <span className="category-label">{CATEGORY_LABELS[cat]}</span>
                  <span className="category-fraction">
                    {tally.right}/{total} ({pct(tally.right, total)})
                  </span>
                </div>
                <div className="category-bar-track">
                  <div className="category-bar-fill" style={{ width: `${pctNum}%` }} />
                </div>
                <div className="category-latency">Median decision: {formatLatency(latencyMs)}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Illustrious 18</h2>
        <table className="index-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Right</th>
              <th>Wrong</th>
            </tr>
          </thead>
          <tbody>
            {(activeProfile.rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18).map((dev) => {
              const tally = stats.perIndex[dev.id];
              return (
                <tr key={dev.id}>
                  <td>{dev.label}</td>
                  <td>{tally ? tally.right : '—'}</td>
                  <td>{tally ? tally.wrong : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Mistake types</h2>
        <ul className="mistake-list">
          {MISTAKE_ORDER.map((cls) => (
            <li className="mistake-row" key={cls}>
              <span>{MISTAKE_LABELS[cls]}</span>
              <span>{stats.mistakes[cls]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Count drill</h2>
        <p className="stats-detail">
          Best clean run:{' '}
          {bestCleanRun === null ? '—' : `${bestCleanRun.cards} cards @ ${bestCleanRun.intervalMs}ms`}
        </p>
        {recentRuns.length === 0 ? (
          <p className="stats-detail">No count-drill runs yet.</p>
        ) : (
          <ul className="count-history-list">
            {recentRuns.map((run, i) => (
              <li className="count-history-row" key={i}>
                <span>{formatDate(run.date)}</span>
                <span>{run.cards} cards</span>
                <span>{run.intervalMs}ms</span>
                <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                  {run.correct ? 'correct' : 'wrong'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Timed count challenge</h2>
        <p className="stats-detail">
          {timedCountSummary.attempts === 0
            ? 'No timed runs yet.'
            : `${timedCountSummary.correct}/${timedCountSummary.attempts} correct (${pct(timedCountSummary.correct, timedCountSummary.attempts)})`}
        </p>
        <p className="stats-detail">
          Best clean speed: {timedCountBest === null ? '—' : `${timedCountBest.toFixed(1)}s / deck`}
        </p>
        {timedCountRecent.length === 0 ? (
          <p className="stats-detail">No timed runs yet.</p>
        ) : (
          <ul className="count-history-list">
            {timedCountRecent.map((run, i) => (
              <li className="count-history-row" key={i}>
                <span>{formatDate(run.date)}</span>
                <span>{run.cards} cards</span>
                <span>{run.secondsPerDeck.toFixed(1)}s/deck</span>
                <span>{run.tier}</span>
                <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                  {run.correct ? 'correct' : 'wrong'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Distraction</h2>
        {distractionSum.attempts === 0 ? (
          <p className="stats-detail">No distraction interruptions yet.</p>
        ) : (
          <ul className="mistake-list">
            <li className="mistake-row">
              <span>Attempts</span>
              <span>{distractionSum.attempts}</span>
            </li>
            <li className="mistake-row">
              <span>Answer accuracy</span>
              <span>
                {distractionSum.answerAccuracyPct === null
                  ? dash()
                  : `${Math.round(distractionSum.answerAccuracyPct)}%`}
              </span>
            </li>
            <li className="mistake-row">
              <span>Count kept</span>
              <span>
                {distractionSum.countKeptPct === null ? dash() : `${Math.round(distractionSum.countKeptPct)}%`}
              </span>
            </li>
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Pair cancellation</h2>
        {pairCancelAttempts === 0 ? (
          <p className="stats-detail">No pair-cancellation attempts yet.</p>
        ) : (
          <ul className="mistake-list">
            <li className="mistake-row">
              <span>Attempts</span>
              <span>{pairCancelAttempts}</span>
            </li>
            <li className="mistake-row">
              <span>Accuracy</span>
              <span>{pct(pairCancelCorrect, pairCancelAttempts)}</span>
            </li>
            <li className="mistake-row">
              <span>Cancelling pairs</span>
              <span>
                {pairCancelCancelling.length === 0
                  ? dash()
                  : pct(pairCancelCancelCorrect, pairCancelCancelling.length)}
              </span>
            </li>
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Retention</h2>
        {retentionReviews === 0 ? (
          <p className="stats-detail">
            No spaced reviews yet — retention accrues as items come due again after a real gap
            (come back tomorrow).
          </p>
        ) : (
          <>
            <p className="stats-detail">
              Accuracy on items recalled after a spaced gap — the honest read on what will still be
              there at the table, distinct from in-drill accuracy.
            </p>
            <ul className="mistake-list">
              <li className="mistake-row">
                <span>Spaced reviews</span>
                <span>{retentionReviews}</span>
              </li>
              <li className="mistake-row">
                <span>Retained accuracy</span>
                <span>{pct(retentionCorrect, retentionReviews)}</span>
              </li>
            </ul>
          </>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Bet / sit / leave</h2>
        {bslAttempts === 0 ? (
          <p className="stats-detail">No bet/sit/leave decisions yet.</p>
        ) : (
          <ul className="mistake-list">
            <li className="mistake-row">
              <span>Decisions</span>
              <span>{bslAttempts}</span>
            </li>
            <li className="mistake-row">
              <span>Accuracy</span>
              <span>{pct(bslCorrect, bslAttempts)}</span>
            </li>
            <li className="mistake-row">
              <span>Leave calls</span>
              <span>{bslLeaveRows.length === 0 ? dash() : pct(bslLeaveCorrect, bslLeaveRows.length)}</span>
            </li>
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Downswing (tilt inoculation)</h2>
        {downswingSessions === 0 ? (
          <p className="stats-detail">No downswing sessions yet.</p>
        ) : (
          <ul className="mistake-list">
            <li className="mistake-row">
              <span>Sessions ridden out</span>
              <span>{downswingSessions}</span>
            </li>
            <li className="mistake-row">
              <span>Spread-conformity (bets held to the ramp)</span>
              <span>{pct(downswingConformCorrect, downswingConformTotal)}</span>
            </li>
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Endurance / fatigue</h2>
        <Stepper
          label="Session gap"
          value={fatigueGapMin}
          min={5}
          max={120}
          step={5}
          format={(v) => `${v} min`}
          onChange={setFatigueGapMin}
        />
        {fatigue.drift === null ? (
          <p className="stats-detail">
            Not enough back-to-back counting runs yet — do several count / timed runs in one sitting
            and this compares your early-session vs late-session accuracy.
          </p>
        ) : (
          <>
            <p className="stats-detail">
              Front-half vs back-half accuracy within a session — does your count hold up late, or
              slip? ({fatigue.sessions} session{fatigue.sessions === 1 ? '' : 's'}, {fatigue.samples} runs)
            </p>
            <ul className="mistake-list">
              <li className="mistake-row">
                <span>Early-session</span>
                <span>{pct(Math.round((fatigue.frontAccuracy ?? 0) * 1000), 1000)}</span>
              </li>
              <li className="mistake-row">
                <span>Late-session</span>
                <span>{pct(Math.round((fatigue.backAccuracy ?? 0) * 1000), 1000)}</span>
              </li>
              <li className="mistake-row">
                <span>Drift</span>
                <span>
                  {(fatigue.drift > 0 ? '+' : '') + Math.round(fatigue.drift * 100)}%{' '}
                  {fatigueVerdict ? `(${fatigueVerdict})` : ''}
                </span>
              </li>
            </ul>
          </>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">True count drill</h2>
        <p className="stats-detail">
          {trueCountSummary.attempts === 0
            ? 'No true-count attempts yet.'
            : `${trueCountSummary.correct}/${trueCountSummary.attempts} correct (${pct(trueCountSummary.correct, trueCountSummary.attempts)})`}
        </p>
        {trueCountSummary.attempts > 0 && (
          <ul className="mistake-list">
            <li className="mistake-row">
              <span>Guessed too high</span>
              <span>{trueCountBreakdown.tooHigh}</span>
            </li>
            <li className="mistake-row">
              <span>Guessed too low</span>
              <span>{trueCountBreakdown.tooLow}</span>
            </li>
            <li className="mistake-row">
              <span>Exact</span>
              <span>{trueCountBreakdown.exact}</span>
            </li>
          </ul>
        )}
        {trueCountRecent.length === 0 ? (
          <p className="stats-detail">No true-count attempts yet.</p>
        ) : (
          <ul className="count-history-list">
            {trueCountRecent.map((run, i) => (
              <li className="count-history-row" key={i}>
                <span>{formatDate(run.date)}</span>
                <span>
                  RC {formatSigned(run.runningCount)} / {run.decksRemaining} decks
                </span>
                <span>guess {formatSigned(run.guess)}</span>
                <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                  {run.correct ? 'correct' : 'wrong'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Deck estimation drill</h2>
        <p className="stats-detail">
          {deckEstSummary.attempts === 0
            ? 'No deck-estimation attempts yet.'
            : `${deckEstSummary.correct}/${deckEstSummary.attempts} correct (${pct(deckEstSummary.correct, deckEstSummary.attempts)})`}
        </p>
        {deckEstRecent.length === 0 ? (
          <p className="stats-detail">No deck-estimation attempts yet.</p>
        ) : (
          <ul className="count-history-list">
            {deckEstRecent.map((run, i) => (
              <li className="count-history-row" key={i}>
                <span>{formatDate(run.date)}</span>
                <span>guessed {run.guess}</span>
                <span>actual {run.actualDecks.toFixed(2)}</span>
                <span>off by {run.errorDecks.toFixed(2)}</span>
                <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                  {run.correct ? 'correct' : 'wrong'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="stats-detail">No sessions yet.</p>
        ) : (
          <ul className="session-list">
            {sessions.map((s, i) => (
              <li className="session-row" key={i}>
                <span>{formatDate(s.date)}</span>
                <span>{s.profileName ?? dash()}</span>
                <span>{s.rounds} rounds</span>
                <span>
                  {pct(s.correct, s.graded)}
                  {/* R7: a peek-assisted session's accuracy is labelled so it
                      can't be read as unassisted (RT#5). Omitted for the common
                      0-peek session to keep the row uncluttered. */}
                  {assistedFlag(s.peeks) && (
                    <span className="session-assisted"> · {assistedFlag(s.peeks)}</span>
                  )}
                </span>
                <span className={s.bankrollDelta >= 0 ? 'result-correct' : 'result-wrong'}>
                  {formatSigned(s.bankrollDelta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section stats-actions">
        <div className="stats-action-row">
          <button type="button" className="stats-action-btn" onClick={handleExport}>
            Export
          </button>
          <button type="button" className="stats-action-btn" onClick={handleImportClick}>
            Import
          </button>
          <button type="button" className="stats-action-btn" onClick={handleSpeakSummary}>
            Speak summary
          </button>
          <button type="button" className="stats-action-btn stats-danger-btn" onClick={handleReset}>
            Reset stats
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="stats-file-input"
          onChange={handleFileChange}
        />
        {message && <p className="stats-message">{message}</p>}
      </section>
    </div>
  );
}
