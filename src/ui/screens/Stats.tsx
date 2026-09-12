import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings, Stats as StatsData } from '../../store/types';
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
  evCostSummary } from '../../store/drillStats';
import type { Category, MistakeClass } from '../../engine/grade';
import { indexSetFor } from '../../engine/deviations';
import { useAudio } from '../../audio/useAudio';
import { narrateStatsSummary } from '../../audio/narrate';
import { assistedFlag } from '../peekFlag';
import {
  fatigueDrift,
  latencyDrift,
  type DatedLatency,
  type DatedResult,
} from '../../drills/fatigueDrift';
import { generateAllCells } from '../../drills/flashcards';
import { loadFlashSr, loadQuizSr } from '../../drills/gradeAnswer';
import { summarizeSrDeck, boxBarPercents, type SrDeckSummary } from '../../drills/srStatus';
import { CHANNEL_BASE_CAP, FLUENT_MS } from '../../drills/spacedRepetition';
import { formatInterval, hasCurve, retentionByGap, wilson } from '../../store/retentionCurve';
import { Stepper } from './Settings';
import './sr.css';

interface StatsProps {
  activeProfile: Profile;
  /**
   * The app's live settings, the same object every other screen is handed.
   *
   * Stats used to be the one screen that reached around App into persistence
   * for this (`loadSettings().audio` on mount), which made it the one screen
   * whose audio could disagree with the rest of the app: App holds settings in
   * state, and a screen reading storage instead is reading a different copy.
   * It also meant Stats could only notice a change by re-mounting.
   */
  settings: Settings;
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
  // RV7: this covers the play-or-sit decision on EVERY round with a spread
  // on, not only the rounds actually sat out -- so 'Wong-outs' would now name
  // a subset of what it counts.
  wong: 'Play or sit out' };

const MISTAKE_ORDER: Exclude<MistakeClass, 'correct'>[] = [
  'basic-error',
  'missed-deviation',
  'phantom-deviation',
  'wrong-anyway',
  'timeout',
];

const MISTAKE_LABELS: Record<Exclude<MistakeClass, 'correct'>, string> = {
  'basic-error': 'Basic-strategy errors',
  'missed-deviation': 'Missed deviations',
  'phantom-deviation': 'Phantom deviations',
  'wrong-anyway': 'Wrong either way',
  timeout: 'Ran out of time' };

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

interface SrStatusPanelProps {
  /** e.g. "flashcards" / "deviation-quiz items" -- used in both the
   * empty-state copy and the "N of M ... studied" headline. */
  deckLabel: string;
  summary: SrDeckSummary;
  /** Renders a lapsed item's raw key as something readable: identity for
   * flashcards (cellId strings like "hard-16-v-9" are already legible), or
   * a deviation's own label ("16 v 10: stand at TC >= 0") for the quiz deck. */
  labelForKey: (key: string) => string;
}

/**
 * Renders one deck's `SrDeckSummary` as a small Leitner box histogram plus
 * two supporting stats and a lapses ranking -- see docs/superpowers/plans/
 * 2026-08-31-C-sr-visualization.md for the full design rationale (D1-D7).
 * Read-only: takes a pre-computed summary as a prop, never touches
 * localStorage or the scheduler itself (D7) -- hand-editing a scheduler
 * from its own status view would defeat the point of having one.
 *
 * Kept as a local, non-exported component (used twice below, once per deck)
 * rather than a separate file: this feature's edit surface was scoped to a
 * fixed set of files to avoid colliding with concurrent work elsewhere in
 * the codebase, and Stats.tsx was the only screen file in that set.
 */
function SrStatusPanel({ deckLabel, summary, labelForKey }: SrStatusPanelProps) {
  const reviewed = summary.universeSize - summary.unseen;

  // D3: an empty deck is the very first thing a fresh-install operator
  // sees, so it renders one clear sentence and NOTHING else -- no row of
  // seven zero-height bars (which reads as "broken", not "nothing yet"),
  // no "Due now: 0" / "Due soon: 0" printed as meaningless zeroes.
  if (reviewed === 0) {
    return <p className="stats-detail">No {deckLabel} studied yet — status will appear as you drill.</p>;
  }

  // FIX (review round 1): the bar row shows ONLY the six Leitner boxes,
  // scaled against each other via boxBarPercents() -- Unseen is
  // deliberately NOT one of the seven bars. An earlier version rendered
  // Unseen as a seventh bar sharing the same 0..max scale as the boxes;
  // measured live with a representative 15-card deck against the real
  // 330-cell universe (Unseen=315, every box=2-3), that made all six box
  // bars render at ~3px in a 64px track -- the entire Leitner distribution
  // this panel exists to show was practically invisible, and it only gets
  // WORSE the more of the deck has actually been studied. Unseen is
  // already conveyed exactly by the headline just above ("N of M
  // studied"), so dropping it here loses no information and fixes the
  // scale. See boxBarPercents' own doc comment (src/drills/srStatus.ts)
  // for the full account and its pure-module ratio tests.
  const barPcts = boxBarPercents(summary.byBox);

  return (
    <div className="sr-panel">
      <div className="stats-headline">
        <span className="stats-headline-value">{reviewed}</span>
        <span className="stats-headline-label">
          of {summary.universeSize} {deckLabel} studied
        </span>
      </div>

      <div className="sr-bar-row">
        {summary.byBox.map((count, box) => (
          <div className="sr-bar-col" key={box}>
            {/* The count is printed ABOVE the bar, not inside/overlaid on
                its colour fill (Design Decision D4: colour/height alone
                never carries the value) -- see sr.css's header comment for
                why this also sidesteps a per-ramp-stop text-contrast check. */}
            <span className="sr-bar-count">{count}</span>
            <div className="sr-bar-track">
              <div className="sr-bar-fill" data-box={box} style={{ height: `${barPcts[box]}%` }} />
            </div>
            <span className="sr-bar-label">Box {box}</span>
          </div>
        ))}
      </div>

      {(summary.dueNow > 0 || summary.dueSoon > 0) && (
        <ul className="mistake-list">
          {summary.dueNow > 0 && (
            <li className="mistake-row">
              <span>Due now</span>
              <span>{summary.dueNow}</span>
            </li>
          )}
          {summary.dueSoon > 0 && (
            <li className="mistake-row">
              <span>Due soon (24h)</span>
              <span>{summary.dueSoon}</span>
            </li>
          )}
        </ul>
      )}

      {/*
        WHY THE BOXES STOP WHERE THEY DO.
        The scheduler will not push a cell to the top of the ladder on the
        strength of answers read off the screen and tapped in
        (drills/spacedRepetition.ts, CHANNEL_BASE_CAP). Without this readout
        that ceiling is invisible and looks like a stuck histogram, so the
        panel says out loud how much of the deck has been proven the hard
        way -- and how fast, since a correct-but-slow answer holds its box
        too. Hidden entirely on a deck written before channels were tracked:
        a wall of zeroes there would be a lie, not a status.
      */}
      {summary.channelKnown > 0 && (
        <ul className="mistake-list">
          <li className="mistake-row">
            <span>Answered without looking</span>
            <span>
              {summary.provenEyesFree} of {summary.channelKnown}
            </span>
          </li>
          <li className="mistake-row">
            <span>Answered without touching</span>
            <span>
              {summary.provenHandsFree} of {summary.channelKnown}
            </span>
          </li>
          {summary.screenOnly > 0 && (
            <li className="mistake-row">
              <span>On-screen only — capped at box {CHANNEL_BASE_CAP}</span>
              <span>{summary.screenOnly}</span>
            </li>
          )}
          {summary.medianPaceMs !== null && (
            <li className="mistake-row">
              <span>Typical answer time</span>
              <span className="mistake-value">
                {(summary.medianPaceMs / 1000).toFixed(1)}s
                {summary.medianPaceMs >= FLUENT_MS ? ' — hesitant' : ''}
              </span>
            </li>
          )}
        </ul>
      )}

      {summary.mostLapsed.length > 0 && (
        <div>
          <h3 className="sr-lapses-title">Most often forgotten</h3>
          <ul className="mistake-list">
            {summary.mostLapsed.map((entry) => (
              <li className="mistake-row" key={entry.key}>
                <span>{labelForKey(entry.key)}</span>
                <span>
                  {entry.lapses} lapse{entry.lapses === 1 ? '' : 's'} (box {entry.box})
                </span>
              </li>
            ))}
          </ul>
          {summary.moreLapsedCount > 0 && (
            <p className="stats-detail sr-more-lapsed">+{summary.moreLapsedCount} more</p>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Stats tabs (C5).
 *
 * Fifteen equal-weight sections in one 3115px column meant the answer to any
 * question was somewhere in a scroll, and most sections read "No X yet" on a
 * fresh install. The split follows how the data is EARNED -- at the table, in
 * the drills, or over time -- because that is how you decide what to look at.
 */
type StatsTab = 'play' | 'drills' | 'progress';

const TAB_LABEL: Record<StatsTab, string> = {
  play: 'Play',
  drills: 'Drills',
  progress: 'Progress' };

/** Which tab each section title belongs to. */
const SECTION_TAB: Record<string, StatsTab> = {
  'Accuracy by category': 'play',
  'Illustrious 18': 'play',
  'Mistake types': 'play',
  'Cost of mistakes': 'play',
  'Bet / sit / leave': 'play',
  'Flashcards': 'drills',
  'Count drill': 'drills',
  'Timed count challenge': 'drills',
  'Distraction': 'drills',
  'Pair cancellation': 'drills',
  'True count drill': 'drills',
  'Deck estimation drill': 'drills',
  'Spaced repetition — Flashcards': 'progress',
  'Spaced repetition — Deviation quiz': 'progress',
  'Retention': 'progress',
  'Downswing (tilt inoculation)': 'progress',
  'Endurance / fatigue': 'progress',
  'Sessions': 'progress' };

/**
 * Turn whatever a GradedEvent carried as `hand` into something readable.
 *
 * The flashcard drill passes a cell id ("hard-19-v-6"); the deviation quiz
 * passes its own prose label, which is already readable and is left alone. A
 * shape this function does not recognise is printed verbatim rather than
 * mangled -- an unfamiliar id is better read raw than reformatted wrongly.
 */
function handLabel(hand: string | undefined): string {
  if (!hand) return 'Unidentified hand';
  const m = /^(hard|soft|pair)-([0-9]+|A)-v-([0-9]+|A)$/.exec(hand);
  if (!m) return hand;
  const kind = m[1];
  const value = m[2];
  const up = m[3];
  // "8,8 v 10" is how a pair is written everywhere else in the app, and it
  // sidesteps pluralising "a pair of As".
  if (kind === 'pair') return `${value},${value} v ${up}`;
  return `${kind === 'hard' ? 'Hard' : 'Soft'} ${value} v ${up}`;
}

export function Stats({ activeProfile, settings, onNavigate, onSettingsChange }: StatsProps) {
  const [stats, setStats] = useState<StatsData>(() => loadStats());
  const [message, setMessage] = useState<string | null>(null);

  // Time range (operator request). Read-side only: every history entry already
  // carries an ISO `date`, so narrowing the window needs no schema change and
  // no migration. `now` is captured once per render and threaded in, so every
  // section is filtered against the SAME instant instead of each re-reading
  // the clock and disagreeing at a boundary.
  const [tab, setTab] = useState<StatsTab>('play');
  const [range, setRange] = useState<TimeRange>({ id: 'all' });
  const now = Date.now();
  const inRange = <T extends { date?: string }>(xs: readonly T[]): T[] =>
    filterByRange(xs, range, now);
  // V3-5: latency rows carry a date now, so they answer the range picker like
  // everything else. One filtered view, shared by the per-category median and
  // the pace-drift readout -- two separate filters here could disagree about
  // which answers are in the window.
  const latencyRows = inRange(stats.latencyHistory);
  // ET5: the session-gap for the fatigue-drift analysis is configurable (a gap
  // longer than this splits practice sessions). Local to this screen.
  const [fatigueGapMin, setFatigueGapMin] = useState(30);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audio = useAudio(settings.audio);

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
        // One hop now: this lifts the imported settings into App, which hands
        // them straight back down as the `settings` prop. The old second call
        // existed only because this screen kept its own copy.
        onSettingsChange(loadSettings());
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
  // RT#12: runs that were actually MEASURED mid-count. A run with checkpoints
  // off carries neither field, and is left out rather than counted as clean --
  // "not measured" is not the same as "nothing went wrong".
  const checkpointRuns = countHistory.filter((h) => h.checkpointsTotal !== undefined);
  const checkpointsAsked = checkpointRuns.reduce((n, h) => n + (h.checkpointsTotal ?? 0), 0);
  const checkpointsHeld = checkpointRuns.reduce((n, h) => n + (h.checkpointsCorrect ?? 0), 0);
  // The RT#12 case itself: the final count was right and a checkpoint was not.
  // These are the runs the old final-count-only grading called perfect.
  const cancelledRuns = checkpointRuns.filter(
    (h) => h.correct && (h.checkpointsCorrect ?? 0) < (h.checkpointsTotal ?? 0),
  ).length;
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

  // V3-8 (docs/BACKLOG.md, "decision drills grade strictly binary"): what the
  // mistakes actually COST, ranked by total units lost rather than by how
  // spectacular each one was -- see evCostSummary's own header for why that
  // ranking is the useful one.
  //
  // V3-5: these rows now carry a date (GradedEvent.at, stamped by the calling
  // component -- applyEvents is pure and still has no clock of its own), so the
  // section finally answers the range picker like the rest of the screen.
  // Rows written before V3-5 have no date; filterByRange keeps them on "all
  // time" and drops them from a bounded range, and `evCostUndated` below says
  // how many were dropped so a narrowed window cannot look like a cheap month.
  //
  // `unpricedMistakes` is stated alongside so the list never reads as the whole
  // picture: a missed deviation is a real mistake with no honest price (the EV
  // engine is count-blind), and it is counted under Mistake types above but
  // cannot appear here.
  const evCostRows = inRange(stats.evCost.history);
  const evCostUndated =
    range.id === 'all' ? 0 : stats.evCost.history.filter((r) => !r.date).length;
  const evCost = evCostSummary(evCostRows);
  const totalMistakes = MISTAKE_ORDER.reduce((sum, cls) => sum + stats.mistakes[cls], 0);
  const unpricedMistakes = Math.max(0, totalMistakes - evCost.priced);

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
  // V3-6: one pooled percentage cannot show a decay curve, and cannot show its
  // own precision either. `gapMs` has been on every row since RV4 and was
  // never read; these two turn it into the shape and the error bar.
  const retentionPooled = wilson(retentionCorrect, retentionReviews);
  const retentionBands = retentionByGap(retentionHistory);
  const retentionHasCurve = hasCurve(retentionBands);

  // Spaced-repetition status (operator request: "the ability to view the
  // status of my spaced repetition somehow visualized"). Unlike every other
  // number on this screen, these are NOT filtered by the selected time
  // range -- a Leitner box histogram is a snapshot of the deck's CURRENT
  // state, not a log of dated events, so "last 7 days" has no meaning here.
  // `generateAllCells().length` (not a hardcoded literal -- see srStatus.ts's
  // own header comment) is the flashcard universe's live size, so this
  // denominator can never silently drift if the cell universe's shape ever
  // changes; the quiz universe is always `indexSetFor(...).length` (18,
  // stable across rulesets). Reuses the same `now` every other section on
  // this screen already agrees on (declared once, above).
  const flashSrSummary = summarizeSrDeck(loadFlashSr(), generateAllCells().length, now);
  const quizSrSummary = summarizeSrDeck(loadQuizSr(), indexSetFor(activeProfile.rules).length, now);
  const quizLabelFor = (key: string) =>
    indexSetFor(activeProfile.rules).find((d) => d.id === key)?.label ?? key;

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
  // V3-7: the play half. Sessions recorded before V3-7 have no play fields at
  // all -- the drill was a stand-only wall then, with no decision to grade --
  // so they are excluded from BOTH sides of this fraction rather than counted
  // as a perfect or a failed session they never played.
  const downswingPlayCorrect = downswingHistory.reduce((s, h) => s + (h.playCorrect ?? 0), 0);
  const downswingPlayTotal = downswingHistory.reduce((s, h) => s + (h.playTotal ?? 0), 0);

  // ET5: fatigue drift over the COUNTING runs you've logged (count drill + timed
  // challenge — both dated per-run accuracy), grouped into sessions by the
  // configurable gap. Front-half vs back-half accuracy within a session reveals
  // the vigilance decrement — does your count slip late in a long session?
  const countingResults: DatedResult[] = [
    ...stats.countDrill.history.map((h) => ({ date: h.date, correct: h.correct })),
    ...stats.timedCount.history.map((h) => ({ date: h.date, correct: h.correct })),
  ];
  const fatigueOpts = { gapMs: fatigueGapMin * 60 * 1000, minPerSession: 6 };
  const fatigue = fatigueDrift(countingResults, fatigueOpts);
  // V3-5: the other half of the vigilance decrement. Accuracy is the LATE
  // signal -- what goes first is pace, and a session you finished perfectly but
  // two seconds slower was already costing you. Only dated latency rows can be
  // grouped into sessions, so this reads empty until V3-5 answers accumulate,
  // which is the honest state rather than a drift computed from nothing.
  const datedLatency: DatedLatency[] = latencyRows.flatMap((r) =>
    r.date === undefined ? [] : [{ date: r.date, elapsedMs: r.elapsedMs }],
  );
  const pace = latencyDrift(datedLatency, fatigueOpts);
  const paceVerdict =
    pace.driftMs === null
      ? null
      : pace.driftMs >= 500
        ? 'slower late'
        : pace.driftMs <= -500
          ? 'faster late'
          : 'holds pace';
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
    <div className="stats-screen" data-active-tab={tab}>
      <div className="stats-topbar">
        <button type="button" className="stats-back-btn" onClick={() => onNavigate('home')}>
          Back to Home
        </button>
        <div className="stats-heading">Stats</div>
      </div>

      <div className="stats-tabs" role="tablist" aria-label="Stats view">
        {(['play', 'drills', 'progress'] as StatsTab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`stats-tab${tab === id ? ' stats-tab-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
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

      <section className="stats-section" data-tab={SECTION_TAB['Accuracy by category']}>
        <h2 className="stats-section-title">Accuracy by category</h2>
        <div className="category-list">
          {CATEGORY_ORDER.map((cat) => {
            const tally = stats.categories[cat];
            const total = tally.right + tally.wrong;
            const pctNum = total === 0 ? 0 : (tally.right / total) * 100;
            // R1: median decision time for this category, sourced from
            // whichever drills currently capture elapsedMs (flashcards +
            // deviation quiz) -- entries lacking it (e.g. table play) never
            // reach latencyHistory at all (see stats.ts applyEvents), so the
            // only filtering needed is the category and, since V3-5, the
            // selected range. Undated rows predate V3-5 and are kept on "all
            // time" only, so this figure no longer disagrees with the accuracy
            // printed on the same line.
            const latencyMs = medianLatency(latencyRows.filter((e) => e.category === cat));
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

      {/*
        Flashcards had NO section at all, and worse, no way to have one: every
        graded decision -- flashcards, deviation quiz and live table play --
        was pooled into `stats.categories`, so a 70% on "soft" could not be
        attributed to any of them. `bySource` splits the tally; this reads the
        flashcard slice only.

        `bySource` is optional (blobs written before it exists lack it), so an
        absent branch renders the empty state rather than throwing.
      */}
      <section className="stats-section" data-tab={SECTION_TAB['Flashcards']}>
        <h2 className="stats-section-title">Flashcards</h2>
        {(() => {
          const bucket = stats.bySource?.flashcard;
          const rows = CATEGORY_ORDER.map((cat) => ({ cat, tally: bucket?.[cat] ?? { right: 0, wrong: 0 } }))
            .filter((r) => r.tally.right + r.tally.wrong > 0);
          const answered = rows.reduce((n, r) => n + r.tally.right + r.tally.wrong, 0);
          const right = rows.reduce((n, r) => n + r.tally.right, 0);

          if (answered === 0) {
            return (
              <p className="stats-detail">No flashcards answered yet.</p>
            );
          }

          return (
            <>
              <div className="stats-headline">
                <span className="stats-headline-value">{pct(right, answered)}</span>
                <span className="stats-headline-label">
                  {right}/{answered} correct
                </span>
              </div>
              <div className="category-list">
                {rows.map(({ cat, tally }) => {
                  const total = tally.right + tally.wrong;
                  const pctNum = (tally.right / total) * 100;
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
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </section>

      {/*
        V5-2 (docs/BACKLOG.md): under-the-clock accuracy and no-clock accuracy
        are DIFFERENT MEASUREMENTS, so they get two numbers rather than one.
        Vékony et al. found speed instruction moves what a learner can express
        without moving what they know; pooling the two would make the headline
        figure drift with the shotClockMs setting instead of with progress.

        Only rendered once BOTH buckets have answers -- one alone says nothing
        about the gap, and a spurious "100% untimed" off two cards would invite
        exactly the wrong conclusion.
      */}
      <section className="stats-section" data-tab={SECTION_TAB['Flashcards']}>
        <h2 className="stats-section-title">Clock vs no clock</h2>
        {(() => {
          const split = stats.shotClockSplit;
          const t = split?.timed ?? { right: 0, wrong: 0 };
          const u = split?.untimed ?? { right: 0, wrong: 0 };
          const tn = t.right + t.wrong;
          const un = u.right + u.wrong;
          if (tn === 0 || un === 0) {
            return (
              <p className="stats-detail">
                Answer some hand drills both with the shot clock on and with it off, and this
                compares them. What you can produce under a deadline and what you know are
                different things, and only the second one keeps.
              </p>
            );
          }
          const gap = Math.round((u.right / un - t.right / tn) * 100);
          return (
            <>
              <div className="category-list">
                {[
                  { label: 'Under the clock', tally: t, total: tn },
                  { label: 'No clock', tally: u, total: un },
                ].map((row) => (
                  <div className="category-row" key={row.label}>
                    <div className="category-row-top">
                      <span className="category-label">{row.label}</span>
                      <span className="category-fraction">
                        {row.tally.right}/{row.total} ({pct(row.tally.right, row.total)})
                      </span>
                    </div>
                    <div className="category-bar-track">
                      <div
                        className="category-bar-fill"
                        style={{ width: `${(row.tally.right / row.total) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="stats-detail">
                {gap > 0
                  ? `You are ${gap} points better without the clock. That gap is the part of your
                     score the deadline is taking, not the part you have yet to learn.`
                  : gap < 0
                    ? `You are ${-gap} points better WITH the clock — unusual, and usually a
                       sign the untimed sample is small or came from a different stretch of
                       practice.`
                    : 'The clock is costing you nothing measurable.'}
              </p>
            </>
          );
        })()}
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Illustrious 18']}>
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
            {indexSetFor(activeProfile.rules).map((dev) => {
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

      <section className="stats-section" data-tab={SECTION_TAB['Mistake types']}>
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

      <section className="stats-section" data-tab={SECTION_TAB['Cost of mistakes']}>
        <h2 className="stats-section-title">Cost of mistakes</h2>
        {evCost.priced === 0 ? (
          <p className="stats-detail">
            No priced mistakes yet. Basic-strategy errors in the flashcard and deviation drills get
            a price in units of your base bet; keep drilling and the expensive habits will show up
            here.
          </p>
        ) : (
          <>
            <p className="stats-detail">
              {evCost.priced} priced {evCost.priced === 1 ? 'mistake' : 'mistakes'}, costing{' '}
              <strong>{evCost.unitsTotal.toFixed(2)} units</strong> in total —{' '}
              {evCost.meanUnits!.toFixed(3)} each on average.
            </p>
            <ul className="mistake-list">
              {evCost.worst.map((row) => (
                <li className="mistake-row" key={row.key}>
                  <span>
                    {handLabel(row.hand)}: {row.taken} instead of {row.expected}
                    {row.times > 1 ? ` (×${row.times})` : ''}
                  </span>
                  <span className="mistake-value">{row.unitsTotal.toFixed(3)} u</span>
                </li>
              ))}
            </ul>
            <p className="stats-detail">
              Ranked by total cost, so a cheap habit repeated outranks one spectacular slip. Prices
              are exact for an infinite deck at a neutral count.
              {unpricedMistakes > 0
                ? ` ${unpricedMistakes} further ${unpricedMistakes === 1 ? 'mistake is' : 'mistakes are'} counted above but unpriced: a missed or mistimed index has no honest number here, because this arithmetic cannot see the count.`
                : ''}{' '}
              {evCostUndated > 0
                ? ` ${evCostUndated} priced ${evCostUndated === 1 ? 'mistake predates' : 'mistakes predate'} decision dating and cannot be placed in this range; widen it to "All time" to include ${evCostUndated === 1 ? 'it' : 'them'}.`
                : ''}
            </p>
          </>
        )}
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Count drill']}>
        <h2 className="stats-section-title">Count drill</h2>
        <p className="stats-detail">
          Best clean run:{' '}
          {bestCleanRun === null ? '—' : `${bestCleanRun.cards} cards @ ${bestCleanRun.intervalMs}ms`}
        </p>
        {checkpointsAsked > 0 && (
          <>
            <p className="stats-detail">
              Checkpoints held: {checkpointsHeld}/{checkpointsAsked} (
              {pct(checkpointsHeld, checkpointsAsked)}) over {checkpointRuns.length}{' '}
              {checkpointRuns.length === 1 ? 'run' : 'runs'}
            </p>
            <p className="stats-detail">
              {cancelledRuns === 0
                ? 'No run has ended on the right count after drifting.'
                : `${cancelledRuns} ${cancelledRuns === 1 ? 'run' : 'runs'} ended on the RIGHT count after drifting — errors that cancelled out, which a final-count-only score would call perfect.`}
            </p>
          </>
        )}
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

      <section className="stats-section" data-tab={SECTION_TAB['Timed count challenge']}>
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

      <section className="stats-section" data-tab={SECTION_TAB['Distraction']}>
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

      <section className="stats-section" data-tab={SECTION_TAB['Pair cancellation']}>
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

      <section className="stats-section" data-tab={SECTION_TAB['Spaced repetition — Flashcards']}>
        <h2 className="stats-section-title">Spaced repetition — Flashcards</h2>
        <SrStatusPanel deckLabel="flashcards" summary={flashSrSummary} labelForKey={(k) => k} />
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Spaced repetition — Deviation quiz']}>
        <h2 className="stats-section-title">Spaced repetition — Deviation quiz</h2>
        <SrStatusPanel deckLabel="deviation-quiz items" summary={quizSrSummary} labelForKey={quizLabelFor} />
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Retention']}>
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
              {/*
                HOW FAR OFF THAT FIGURE IS.
                A percentage off nine reviews and one off nine hundred print
                identically, and the first is noise. The 95% interval is the
                only thing on the row that distinguishes them, so it sits
                directly under the number it qualifies rather than in a
                footnote nobody reads.
              */}
              <li className="mistake-row">
                <span>Could honestly be</span>
                <span className="mistake-value">{formatInterval(retentionPooled)}</span>
              </li>
            </ul>
            {retentionHasCurve ? (
              <>
                <h3 className="sr-lapses-title">By how long the gap was</h3>
                <p className="stats-detail">
                  Retention is a decay curve. Pooling every gap length into one figure averages a
                  three-day recall together with a five-week one, which is the one shape a single
                  number cannot show.
                </p>
                <ul className="mistake-list">
                  {retentionBands
                    .filter((band) => band.reviews > 0)
                    .map((band) => (
                      <li className="mistake-row" key={band.label}>
                        <span>
                          {band.label} — {band.reviews} {band.reviews === 1 ? 'review' : 'reviews'}
                        </span>
                        <span className="mistake-value">
                          {pct(band.correct, band.reviews)} ({formatInterval(band)})
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="stats-detail">
                Every spaced review so far sits at one gap length, so there is no curve to draw
                yet — it appears once items start coming due at longer intervals.
              </p>
            )}
          </>
        )}
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Bet / sit / leave']}>
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

      <section className="stats-section" data-tab={SECTION_TAB['Downswing (tilt inoculation)']}>
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
            {/*
              Reported apart from the bet, because chasing with your money and
              chasing with your play are different failures with different
              fixes. Hidden entirely when no session has graded a decision --
              a 0% there would read as having played every stiff wrong, when
              in fact none was ever dealt.
            */}
            {downswingPlayTotal > 0 && (
              <li className="mistake-row">
                <span>Correct play (stiff hands under pressure)</span>
                <span>
                  {pct(downswingPlayCorrect, downswingPlayTotal)} ({downswingPlayCorrect}/
                  {downswingPlayTotal})
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Endurance / fatigue']}>
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

        {/*
          V3-5: PACE, over the same sessions.
          Accuracy is the late signal. What goes first as you tire is how long
          each answer takes, so a session finished at the same accuracy and two
          seconds slower is a decrement the block above cannot see. This reads
          from the timed drills (flashcards, deviation quiz), which is a
          different population from the counting runs above -- so it gets its
          own sample counts rather than borrowing that block's.
        */}
        {pace.driftMs === null ? (
          <p className="stats-detail">
            No dated answer times in this range yet — pace drift needs several timed flashcard or
            quiz answers in one sitting.
          </p>
        ) : (
          <>
            <p className="stats-detail">
              Early vs late ANSWER TIME within a session — the decrement that shows up before
              accuracy does. ({pace.sessions} session{pace.sessions === 1 ? '' : 's'},{' '}
              {pace.samples} answers)
            </p>
            <ul className="mistake-list">
              <li className="mistake-row">
                <span>Early-session pace</span>
                <span>{formatLatency(pace.frontMedianMs)}</span>
              </li>
              <li className="mistake-row">
                <span>Late-session pace</span>
                <span>{formatLatency(pace.backMedianMs)}</span>
              </li>
              <li className="mistake-row">
                <span>Pace drift</span>
                <span className="mistake-value">
                  {(pace.driftMs > 0 ? '+' : '') + (pace.driftMs / 1000).toFixed(1)}s{' '}
                  {paceVerdict ? `(${paceVerdict})` : ''}
                </span>
              </li>
            </ul>
          </>
        )}
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['True count drill']}>
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
                <span>
                  {run.guess === undefined ? 'self-reported' : `guess ${formatSigned(run.guess)}`}
                </span>
                <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                  {run.correct ? 'correct' : 'wrong'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section" data-tab={SECTION_TAB['Deck estimation drill']}>
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

      <section className="stats-section" data-tab={SECTION_TAB['Sessions']}>
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
