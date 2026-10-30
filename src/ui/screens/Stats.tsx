import { useRef, useState } from 'react';
import { playLabel } from '../playLabel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { YouHeader } from '../components/YouHeader';
import { SideBetStatsSection } from '../components/SideBetStatsSection';
import type { ChangeEvent } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings, Stats as StatsData } from '../../store/types';
import { EMPTY_STATS } from '../../store/types';
import { filterByRange, rangeStart, RANGE_LABEL } from '../../store/timeRange';
import { latencyRowsStart, rangedAccuracy } from '../../store/latencyRange';
import { HISTORY_CAP } from '../../store/retention';
import { pct, pctOfPercent, clockGap, formatUnits, costHandLabel, trendLine, signed } from './statsFormat';
import './costOfMistakes.css';
import type { RangeId, TimeRange } from '../../store/timeRange';
import {
  loadStats,
  saveStats,
  loadSettings,
  exportAll,
  importAll,
  inspectBackup,
  restoreSnapshot,
  snapshotBackedUp,
  summarizeBackupBlob,
  quarantinedBackupLabels,
} from '../../store/persist';
import {
  backupDateText,
  canKeepUndo,
  lastBackupText,
  clearUndo,
  importConfirmText,
  liveUndo,
  practiceMark,
  storeUndo,
  type ImportUndo,
} from './backupText';
import { backupFileName, saveTextFile, type SaveResult } from '../../platform/saveFile';
import { useTabSettings } from '../tabSettingsContext';
import { lastBackupAt, noteBackupHandedOver } from '../../store/backupStatus';
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
import { assistedFlag, signedFixed } from '../peekFlag';
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
import './countHistory.css';
import { strategyRulesFor } from '../../store/profiles';
import { CATEGORY_LABELS } from './categoryLabels';
import { betSizingRows } from './ladderRules';
import { activeIndices } from './readiness';
import { drillIndexDirection, drillPerIndex, playFigures } from './playStats';
import { IndexTable } from '../components/IndexTable';
import { bestCleanCountRuns, formatCountRun } from '../../drills/countSpeed';
import { CATEGORY_TARGET, HAND_CATEGORIES, MIN_CATEGORY_ANSWERS, goalPct, handCategoryProgress, pctDown } from './handProgress';
import type { HandCategoryProgress } from './handProgress';
import './statsGoal.css';
import './statsHistory.css';
import './statsSessions.css';
import { dismissQuarantineNotice, quarantineNoticeDue } from '../../store/quarantineNotice';
import './statsBackup.css';
import './statsLatency.css';
import './sessionTag.css';
import { betMissText, formatLossValue, sessionsBetMisses, sessionsLossPer100, sessionsPlayAccuracy, sessionTag } from '../sessionFigures';
import { dealerErrorsValue, sessionsDealerErrors } from '../dealerErrorCopy';

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

// Wave J: `wongIn` (back-count entries) is listed only once there is one.
const CATEGORY_ORDER: Category[] = ['hard', 'soft', 'pairs', 'surrender', 'insurance', 'bet', 'countCheck', 'wong', 'wongIn'];

/** #25: rows shown before "Show all". */
const COST_ROWS_SHOWN = 5;

/** s04: history rows shown before "Show all", and dots in the results strip. */
const HISTORY_ROWS_SHOWN = 5;
const RESULT_DOTS = 40;

const MISTAKE_ORDER: Exclude<MistakeClass, 'correct'>[] = [
  'basic-error',
  'missed-deviation',
  'phantom-deviation',
  'wrong-anyway',
  'timeout',
];

/**
 * D-R2 follow-up: an admitted miss is a drill answer (the eyes-free "did you
 * have it?" self-report); the Play table never files one. Its row sits with
 * the drills' figures on the Drills tab, read from the pooled tally, not in
 * Play's table-only Mistake types where it could only ever read 0.
 */
const MISTAKE_LABELS: Record<Exclude<MistakeClass, 'correct'>, string> = {
  'basic-error': 'Basic strategy errors',
  'missed-deviation': 'Missed deviations',
  'phantom-deviation': 'Phantom deviations',
  'wrong-anyway': 'Wrong either way',
  timeout: 'Out of time',
  'self-report': 'Admitted misses (eyes-free)' };

/** s06: Play's non-hand misses, which the engine files under 'basic-error'. */
type NonHandMiss = 'bet' | 'wong' | 'wongIn' | 'countCheck';
const NON_HAND_MISSES: readonly NonHandMiss[] = ['bet', 'wong', 'wongIn', 'countCheck'];
const NON_HAND_MISS_LABEL: Record<NonHandMiss, string> = {
  bet: 'Bet size mistakes (when playing)',
  // Wave J toggle rework: exits (you were In) and entries (you were Out).
  wong: 'Stay in or get out mistakes',
  wongIn: 'Stay out or get in mistakes',
  countCheck: 'Count check misses',
};

/** "a", "a and b", "a, b and c". */
function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** A signed figure with a real minus sign (U+2212); zero shows as "+0" as before. */
function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : signed(n);
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
   * a deviation's own label ("16 v 10: stand at TC ≥ 0") for the quiz deck. */
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
    return <p className="stats-detail">No {deckLabel} studied yet. Progress shows up here as you drill.</p>;
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
              <span>Due in the next 24 hours</span>
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
              <span>Answered only on screen (held at box {CHANNEL_BASE_CAP})</span>
              <span>{summary.screenOnly}</span>
            </li>
          )}
          {summary.medianPaceMs !== null && (
            <li className="mistake-row">
              <span>Median answer time</span>
              <span className="mistake-value">
                {(summary.medianPaceMs / 1000).toFixed(1)}s
                {summary.medianPaceMs >= FLUENT_MS ? ' (slow)' : ''}
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
                  forgotten {entry.lapses} {entry.lapses === 1 ? 'time' : 'times'} · box {entry.box}
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
 * s04: a drill's results as a row of dots, oldest left, with the headline
 * accuracy and the last-ten trend -- a story of progress, which a list of the
 * five newest rows (all "correct" once the early misses scrolled off) is not.
 */
function ResultTrend({ history, noun }: { history: readonly { correct: boolean }[]; noun: string }) {
  if (history.length === 0) return null;
  const right = history.filter((h) => h.correct).length;
  const trend = trendLine(history);
  const dots = history.slice(-RESULT_DOTS);
  return (
    <div className="result-trend" data-testid={`trend-${noun}`}>
      <p className="stats-detail">
        Correct: {right}/{history.length} {noun} ({pct(right, history.length)})
        {trend ? ` \u00b7 ${trend}` : ''}
      </p>
      <div
        className="result-dots"
        role="img"
        aria-label={`Last ${dots.length} ${noun}, oldest first: ${dots.filter((d) => d.correct).length} right`}
      >
        {dots.map((d, i) => (
          <span key={i} className={`result-dot${d.correct ? ' result-dot-right' : ' result-dot-wrong'}`} />
        ))}
      </div>
    </div>
  );
}

/** s04: how a count run was dealt, from the fields the run actually stored. */
function countRunMode(run: StatsData['countDrill']['history'][number]): string {
  const base = run.manual ? 'On tap' : 'Auto';
  return run.checkpointsTotal !== undefined ? `${base} \u00b7 checkpoints` : base;
}

/**
 * W3 / s02: one hand category against the 90% goal, with the figure Home
 * judges it on. The bar carries a tick at the target, and the row says when
 * the goal is met, so 89% and 92% no longer look the same.
 */
function HandGoalRow({ row, latencyText, rangeText }: { row: HandCategoryProgress; latencyText: string; rangeText: string | null }) {
  const gap = pctDown(CATEGORY_TARGET) - pctDown(row.pct);
  const status = row.thin
    ? `${row.n} of ${MIN_CATEGORY_ANSWERS} answers needed to judge`
    : row.onTarget
      ? 'On target'
      : `${gap} point${gap === 1 ? '' : 's'} to the ${pctDown(CATEGORY_TARGET)}% goal`;
  return (
    <div className="category-row" data-hand={row.prefix} data-on-target={row.onTarget ? 'true' : 'false'}>
      <div className="category-row-top">
        <span className="category-label">{row.label}</span>
        <span className="category-fraction">
          {row.recent ? `last ${row.judgedN}: ` : ''}
          {row.judgedRight}/{row.judgedN} ({row.judgedN === 0 ? '—' : goalPct(row.pct)})
        </span>
      </div>
      <div className="category-bar-track goal-bar-track">
        <div className="category-bar-fill" style={{ width: `${row.pct * 100}%` }} />
        <div className="goal-bar-target" style={{ left: `${CATEGORY_TARGET * 100}%` }} aria-hidden="true" />
      </div>
      <div className="category-latency">
        {row.onTarget ? '✓ ' : ''}
        {status}
        {row.recent && !row.legacy ? ` · all time ${row.right}/${row.n}` : ''} · Median decision time: {latencyText}
      </div>
      {/* The goal reads per-cell answers, which have no backfill: a returning
          user's older answers show here rather than vanish (see handProgress). */}
      {row.legacy && (
        <div className="category-legacy" data-testid={`legacy-${row.prefix}`}>
          All time {row.allRight}/{row.allN} ({pct(row.allRight, row.allN)}), with answers from before per-hand
          tracking. The goal counts only answers since.
        </div>
      )}
      {rangeText !== null && <div className="category-in-range">{rangeText}</div>}
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

// Wave W: the third reads "Over time", not "Progress" -- the You tab's
// switch above it says Progress for the streaks and achievements screen.
const TAB_LABEL: Record<StatsTab, string> = {
  play: 'Play',
  drills: 'Drills',
  progress: 'Over time' };

/** Which tab each section title belongs to. */
const SECTION_TAB: Record<string, StatsTab> = {
  'Accuracy by category': 'play',
  'Indexes': 'play',
  'Mistake types': 'play',
  'Cost of mistakes': 'play',
  'Bet or sit': 'play',
  'Flashcards': 'drills',
  'Bet sizing drill': 'drills',
  'Basic strategy goal': 'progress',
  'Count drill': 'drills',
  'Timed count challenge': 'drills',
  'Distraction': 'drills',
  'Pair cancellation': 'drills',
  'Side bets': 'play',
  'True count drill': 'drills',
  'Produce TC': 'drills',
  'Deviation quiz': 'drills',
  'Deck estimation drill': 'drills',
  'Spaced repetition — Flashcards': 'progress',
  'Spaced repetition — Deviation quiz': 'progress',
  'Retention': 'progress',
  'Fatigue': 'progress',
  'Table sessions': 'progress' };

const EXPORT_MESSAGE: Record<SaveResult, string> = {
  shared: 'Backup saved.',
  downloaded: 'Backup downloaded. Check it is in Files before you delete the app.',
  cancelled: 'Backup not saved: the share sheet was closed.',
  failed: 'Backup failed: nothing was saved.',
};

export function Stats({ activeProfile, settings, onSettingsChange, onNavigate }: StatsProps) {
  const [stats, setStats] = useState<StatsData>(() => loadStats());
  const [message, setMessage] = useState<string | null>(null);

  // Time range (operator request). Read-side only: every history entry already
  // carries an ISO `date`, so narrowing the window needs no schema change and
  // no migration. `now` is captured once per render and threaded in, so every
  // section is filtered against the SAME instant instead of each re-reading
  // the clock and disagreeing at a boundary.
  const [tab, setTab] = useState<StatsTab>('play');
  const [range, setRange] = useState<TimeRange>({ id: 'all' });
  // #25: the five dearest habits by default, the rest behind "Show all".
  const [showAllCosts, setShowAllCosts] = useState(false);
  // s04: every count run in range, not only the newest five.
  const [showAllRuns, setShowAllRuns] = useState(false);
  const now = Date.now();
  // The rules the app GRADES with, which is the profile's rules plus its
  // surrender-index flag. Read once so the sections below cannot disagree
  // with each other about which set of indices this profile studies.
  const gradedRules = strategyRulesFor(activeProfile);
  const inRange = <T extends { date?: string }>(xs: readonly T[]): T[] =>
    filterByRange(xs, range, now);
  // V3-5: latency rows carry a date now, so they answer the range picker like
  // everything else. One filtered view, shared by the per-category median and
  // the pace-drift readout -- two separate filters here could disagree about
  // which answers are in the window.
  const latencyRows = inRange(stats.latencyHistory);
  // B6: the median and pace readouts read only the kept rows; say where they
  // start when the range reaches back past it.
  const rowsStart = latencyRowsStart(stats);
  const rangeFrom = rangeStart(range, now);
  const latencyCut =
    rowsStart !== null && (rangeFrom === null || Date.parse(rowsStart) > rangeFrom) ? backupDateText(rowsStart).split(',')[0]! : null;
  /*
   * s10: hand accuracy that answers the range picker. The category tallies
   * are undated counters; the dated latency rows carry `correct` since Wave A
   * (one row per timed graded answer -- drills, not table play), so a bounded
   * range reads its accuracy from them. Null on "All time".
   */
  const inRangeText = (cat: Category): string | null => {
    if (range.id === 'all') return null;
    // Table-only categories (bet sizing, play or sit, count checks) never
    // write a timed row; "no timed answers" under them in every range is noise.
    // R8: or whose rows the history cap has all folded into daily counts.
    const folded = Object.values(stats.latencyDaily ?? {}).some((d) => (d?.[cat]?.n ?? 0) > 0);
    if (!folded && !stats.latencyHistory.some((r) => r.category === cat)) return null;
    const label = range.id === 'since' ? `Since ${range.since ?? '…'}` : RANGE_LABEL[range.id];
    // B6: the kept rows plus the daily counts the cap folded older rows into.
    const { right, total } = rangedAccuracy(stats, range, now, cat);
    if (total === 0) return `${label}: no timed answers`;
    return `${label}: ${right}/${total} (${pct(right, total)}) timed answers`;
  };
  // ET5: the session-gap for the fatigue-drift analysis is configurable (a gap
  // longer than this splits practice sessions). Local to this screen.
  const [fatigueGapMin, setFatigueGapMin] = useState(30);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audio = useAudio(settings.audio);

  const refresh = () => setStats(loadStats());

  const handleSpeakSummary = () => {
    // F14: the summary follows the range picker, and says which range it read.
    const graded = rangedAccuracy(stats, range, now);
    const summary =
      range.id === 'all'
        ? narrateStatsSummary(stats)
        : narrateStatsSummary(stats, {
            label: range.id === 'since' ? `Since ${range.since ?? 'the date you picked'}` : RANGE_LABEL[range.id],
            right: graded.right,
            total: graded.total,
          });
    audio.say(summary, { interrupt: true });
  };

  // B1/B3/B10: through the shared share-or-download helper, and the message
  // says what actually happened -- "exported" whatever happened was how a
  // dismissed share sheet or an empty iOS preview read as a backup.
  const handleExport = () => {
    const at = new Date();
    void saveTextFile(exportAll(), backupFileName(at)).then((r) => {
      // B7: remembered only once a file was really handed over; R9: a
      // download only rests the reminder, it is not shown as a backup.
      noteBackupHandedOver(r, at);
      setLastBackup(lastBackupAt());
      setMessage(EXPORT_MESSAGE[r]);
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const [lastBackup, setLastBackup] = useState<string | null>(() => lastBackupAt());
  // B4: the undo for the last import.
  // R1: only while nothing has been practised since, and for 24 hours at most.
  const [undo, setUndo] = useState<ImportUndo | null>(() => liveUndo());
  const tabSettings = useTabSettings();
  // B13: a quarantine used to be silent. Read on every render: cheap, and an
  // import or undo changes it.
  const setAside = quarantinedBackupLabels();
  // R4: dismissable; back only when what is set aside changes.
  const [, setNoticeDismissed] = useState(0);
  const showSetAside = setAside.length > 0 && quarantineNoticeDue();

  // After an import or its undo: everything above re-reads the stores.
  const afterReplace = () => {
    refresh();
    // One hop now: this lifts the imported settings into App, which hands
    // them straight back down as the `settings` prop.
    onSettingsChange(loadSettings());
    // B2/B28: and the shell's ACTIVE PROFILE, which only a Profiles visit or
    // a relaunch re-read -- until then Play, the drills and Charts graded
    // against the pre-import rules while storage held the imported ones.
    tabSettings?.applyProfile(null);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // B4: READ IT BEFORE ASKING. A file that is not a backup is refused
      // here, and the question shows when the file was made and what it
      // holds beside what this phone holds -- several backups in Files used
      // to be indistinguishable, and the wrong one replaced everything.
      const inspected = inspectBackup(text);
      if (!inspected.ok) {
        setMessage(`Import failed: ${inspected.error}`);
        return;
      }
      // R2: IN MEMORY until the import commits. Picking a second file just
      // to read its date, then cancelling, used to overwrite the first
      // import's undo and then delete it.
      const snap = snapshotBackedUp();
      const undoPossible = canKeepUndo();
      // B22: the sentence names what THIS file replaces, from the keys it carries.
      const phone = summarizeBackupBlob(JSON.parse(exportAll()) as Record<string, unknown>);
      if (!window.confirm(importConfirmText(inspected, phone, undoPossible))) return;
      const at = new Date().toISOString();
      const result = importAll(text);
      if (result.ok) {
        // R2: replaced only now, by an import that committed.
        const kept = undoPossible && storeUndo({ at, snap, mark: practiceMark() });
        // An older undo would put back a phone from before the PREVIOUS import.
        if (!kept) clearUndo();
        afterReplace();
        setUndo(kept ? liveUndo() : null);
        setMessage(kept ? 'Backup imported.' : 'Backup imported. There was no room to keep an undo.');
      } else {
        // R2: a failed import leaves the undo as it was -- unless putting the
        // previous data back failed too, when this copy is the only one.
        if (result.rollbackFailed && undoPossible) storeUndo({ at, snap, mark: practiceMark() });
        setUndo(liveUndo());
        setMessage(`Import failed: ${result.error ?? 'unknown error'}`);
      }
    };
    reader.onerror = () => setMessage('Import failed: couldn\'t read the file.');
    reader.readAsText(file);
  };

  const handleUndoImport = () => {
    const u = liveUndo();
    if (!u) {
      setUndo(null);
      setMessage('The undo is no longer available: something changed since the import (an answer, a setting, a profile, the casino log), or it is over 24 hours old.');
      return;
    }
    if (!window.confirm(`Put back what this phone held before the import of ${backupDateText(u.at)}?`)) return;
    const ok = restoreSnapshot(u.snap);
    if (ok) {
      clearUndo();
      setUndo(null);
    } else {
      // R2: a half-done undo keeps its snapshot, so it can be tried again.
      const again = { ...u, mark: practiceMark() };
      setUndo(storeUndo(again) ? again : null);
    }
    afterReplace();
    setMessage(ok ? 'Import undone.' : 'Undo failed part way: storage is full or unavailable. Free some space and try Undo again.');
  };

  const handleReset = () => {
    if (!window.confirm('Reset all stats? This cannot be undone.')) return;
    saveStats(structuredClone(EMPTY_STATS));
    refresh();
    setMessage('Stats reset.');
  };

  const countHistory = inRange(stats.countDrill.history);
  // #20: auto and manual runs are ranked apart -- a manual run was never
  // dealt at an interval, so its pace is its measured mean tap gap.
  const bestCleanRun = bestCleanCountRuns(countHistory);
  const allRunsNewestFirst = [...countHistory].reverse();
  const recentRuns = showAllRuns ? allRunsNewestFirst : allRunsNewestFirst.slice(0, HISTORY_ROWS_SHOWN);
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
  // THROUGH THE RANGE PICKER, like everything around them.
  //
  // These six read their full history while the sections above and below
  // them were filtered, so "Last 7 days" produced a screen where some
  // figures answered the question and some answered a different one, with
  // nothing on screen saying which was which. Every row here has carried a
  // `date` since it was first written; only the read was missing.
  const trueCountRows = inRange(stats.trueCount.history);
  const trueCountSummary = summarize(trueCountRows);
  const trueCountBreakdown = signedErrorBreakdown(trueCountRows);
  // s05: the misses are what a counter learns from, and five newest rows
  // (all right after a good streak) hid every one.
  const trueCountRecent = trueCountRows.filter((r) => !r.correct).slice(-HISTORY_ROWS_SHOWN).reverse();
  const produceTcRows = inRange(stats.produceTc.history);
  const produceTcSummary = summarize(produceTcRows);
  const produceTcMisses = produceTcRows.filter((r) => !r.correct).slice(-HISTORY_ROWS_SHOWN).reverse();
  // s05: the deviation quiz's own tally (bySource.quiz), all time like Flashcards.
  const quizBucket = stats.bySource?.quiz;
  const quizRight = quizBucket ? Object.values(quizBucket).reduce((n, t) => n + t.right, 0) : 0;
  const quizTotal = quizBucket ? Object.values(quizBucket).reduce((n, t) => n + t.right + t.wrong, 0) : 0;

  const deckEstRows = inRange(stats.deckEstimation.history);
  const deckEstSummary = summarize(deckEstRows);
  const deckEstRecent = deckEstRows.slice(-5).reverse();

  const timedCountRows = inRange(stats.timedCount.history);
  const timedCountSummary = summarize(timedCountRows);
  const timedCountBest = bestSecondsPerDeck(timedCountRows);
  const timedCountRecent = timedCountRows.slice(-5).reverse();

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
  // D-R2 (#4): the Play tab is the table's decisions only (playStats.ts).
  const play = playFigures(stats);
  // F5 (W2-17): table decisions only -- the drills' answer times are theirs.
  const playDecisionMs = medianLatency(inRange(play.decisionRows));
  const evCostRows = inRange(play.evCostRows);
  const evCostUndated =
    range.id === 'all' ? 0 : play.evCostRows.filter((r) => !r.date).length;
  const evCost = evCostSummary(evCostRows);
  const totalMistakes = MISTAKE_ORDER.reduce((sum, cls) => sum + play.mistakes[cls], 0);
  /*
   * s06: the table's bet-sizing, play-or-sit and count-check misses are all
   * classified 'basic-error' by the engine, so "Basic strategy errors" counted
   * 36 sit-out calls as hand mistakes. Their category tallies say how many
   * there are; they are shown on their own rows and taken out of that one.
   */
  const nonHandMisses: Record<NonHandMiss, number> = {
    bet: play.categories.bet.wrong,
    wong: play.categories.wong.wrong,
    wongIn: play.categories.wongIn.wrong,
    countCheck: play.categories.countCheck.wrong,
  };
  const nonHandMissTotal = NON_HAND_MISSES.reduce((n, k) => n + nonHandMisses[k], 0);
  const handBasicErrors = Math.max(0, play.mistakes['basic-error'] - nonHandMissTotal);
  /*
   * ONLY ON "ALL TIME", because only there do the two numbers describe the
   * same set of answers.
   *
   * `stats.mistakes` is an undated tally -- a running counter, not a log --
   * so it cannot be windowed, while `evCost.priced` counts the priced rows
   * INSIDE the selected range. Subtracting one from the other in a bounded
   * range reported most of a lifetime of mistakes as "further mistakes"
   * belonging to the last seven days, and the narrower the window the worse
   * the overstatement got.
   */
  const unpricedMistakes =
    range.id === 'all' ? Math.max(0, totalMistakes - evCost.priced) : 0;
  // s06: the unpriced note names its kinds instead of calling them all index mistakes.
  const unpricedHand = Math.max(0, unpricedMistakes - nonHandMissTotal);
  const unpricedNote = (() => {
    if (unpricedMistakes === 0) return '';
    const parts: string[] = [];
    if (nonHandMisses.bet > 0) parts.push(`${nonHandMisses.bet} bet-sizing`);
    if (nonHandMisses.wong > 0) parts.push(`${nonHandMisses.wong} stay-in-or-get-out`);
    if (nonHandMisses.wongIn > 0) parts.push(`${nonHandMisses.wongIn} stay-out-or-get-in`);
    if (nonHandMisses.countCheck > 0) parts.push(`${nonHandMisses.countCheck} count-check`);
    const kinds = parts.length === 0 ? '' : ` ${joinList(parts)} ${nonHandMissTotal === 1 ? 'mistake is' : 'mistakes are'} not hand plays, so they have no price.`;
    const hand =
      unpricedHand === 0
        ? ''
        : ` ${unpricedHand} further ${unpricedHand === 1 ? 'mistake is' : 'mistakes are'} counted above but not priced: index mistakes depend on the count, which this pricing can't see.`;
    return kinds + hand;
  })();

  // D1 part 2 (docs/BACKLOG.md, distraction training): answer accuracy and
  // count-survival are reported separately -- see distractionSummary's own
  // header comment for why they're independent failure modes.
  const distractionSum = distractionSummary(inRange(stats.distraction.history));

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
  // changes. Reuses the same `now` every other section on this screen
  // already agrees on (declared once, above).
  //
  // THE QUIZ UNIVERSE IS NOT ALWAYS 18. The comment here used to say it was
  // "stable across rulesets", and the denominator was read off the bare
  // `activeProfile.rules`, which cannot carry the surrender-index flag. With
  // the flag on the quiz draws from 24 and writes `sur*` keys into this very
  // deck, so a learner who had studied twenty of them was told "18 of 18
  // studied" over a box histogram summing to twenty, and a lapsed surrender
  // index appeared in "Most often forgotten" as the raw key `sur15v10`.
  const flashSrSummary = summarizeSrDeck(loadFlashSr(), generateAllCells().length, now);
  // Wave B2 #22: the indexes the drills ask, as on Home (readiness.activeIndices).
  const askedIndices = activeIndices(gradedRules);
  const drillIndex = drillPerIndex(stats);
  const drillDirection = drillIndexDirection(stats);
  const quizSrSummary = summarizeSrDeck(loadQuizSr(), askedIndices.length, now);
  const quizLabelFor = (key: string) =>
    indexSetFor(gradedRules).find((d) => d.id === key)?.label ?? key;

  // ET3 (docs/BACKLOG.md): overall accuracy. #48-51 dropped the "leave"
  // answer; rows from before that still count, and their LEAVE figure is shown
  // only while any are in range.
  const bslHistory = inRange(stats.betSitLeave.history);
  const bslAttempts = bslHistory.length;
  const bslCorrect = bslHistory.filter((h) => h.correct).length;
  const bslLeaveRows = bslHistory.filter((h) => h.correctAction === 'leave');
  const bslLeaveCorrect = bslLeaveRows.filter((h) => h.correct).length;
  // s06: Play's own bet and play-or-sit tallies (undated counters, all time).
  const tally = (c: Category) => {
    const t = play.categories[c];
    return { right: t.right, n: t.right + t.wrong };
  };
  const tableBet = tally('bet');
  const tableWong = tally('wong');
  // Wave J: back-count entries, and which way the misses went.
  const tableWongIn = tally('wongIn');
  const wongInMisses = stats.wongInMisses;
  const entryMissed = typeof wongInMisses?.missed === 'number' ? wongInMisses.missed : 0;
  const entryEarly = typeof wongInMisses?.early === 'number' ? wongInMisses.early : 0;
  // Wave J: of the bet misses, how many were the hand count of a two-hand ramp.
  const betHandsMisses = typeof stats.betHandsMisses === 'number' ? stats.betHandsMisses : 0;
  // Wave B2 #12: the Bet sizing drill (which replaced Bet or sit) writes its
  // own history; it is read here, in range, beside the table's figures.
  const betSizingDrill = inRange(betSizingRows(stats));
  const betSizingRight = betSizingDrill.filter((r) => r?.ok === true).length;


  // ET5: fatigue drift over the COUNTING runs you've logged (count drill + timed
  // challenge — both dated per-run accuracy), grouped into sessions by the
  // configurable gap. Front-half vs back-half accuracy within a session reveals
  // the vigilance decrement — does your count slip late in a long session?
  // The FILTERED rows on both sides. This array mixed an unfiltered
  // countDrill history with an unfiltered timedCount history while
  // `countHistory` twenty lines above was filtered -- so the same runs were
  // counted two different ways on one screen, and "am I drifting this week"
  // was answered from every run ever recorded.
  const countingResults: DatedResult[] = [
    ...countHistory.map((h) => ({ date: h.date, correct: h.correct })),
    ...timedCountRows.map((h) => ({ date: h.date, correct: h.correct })),
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
  // B2 #45: in the selected range, like the Table sessions list -- every
  // session row is dated, and the range note does not list this block among
  // its all-time tallies.
  const profileSessions = inRange(stats.sessions).filter((s) => s.profileId === activeProfile.id);
  // C-R8: play decisions only, on rung 7's basis -- bet/sit and count checks
  // keep their own rows. A pre-B2 row falls back to its graded total.
  const { plays: totalGraded, correct: totalCorrect } = sessionsPlayAccuracy(profileSessions);
  const actualAccuracyPct = totalGraded === 0 ? null : (totalCorrect / totalGraded) * 100;
  // R7 (docs/BACKLOG.md, count-peek accountability / RT#5): the "actual play
  // accuracy" number is uninterpretable if it was silently peek-assisted, so
  // flag the aggregate whenever ANY of this profile's sessions used a peek.
  const totalPeeks = profileSessions.reduce((sum, s) => sum + (s.peeks ?? 0), 0);
  const actualAccuracyAssisted = assistedFlag(totalPeeks);
  // Wave B (B6/W12): the skill figure, units lost to mistakes per 100 hands,
  // replaces the luck-driven units per hour (a bankroll swing is not skill).
  const lossPer100 = sessionsLossPer100(profileSessions);
  const cvcx = activeProfile.cvcx;
  // W15: only the rows with a value.
  const profileRows: [string, string][] = [];
  if (cvcx?.score !== undefined) profileRows.push(['CVCX score', String(cvcx.score)]);
  if (cvcx?.evPerHour !== undefined) profileRows.push(['CVCX EV per hour', formatSigned(cvcx.evPerHour)]);
  if (cvcx?.riskOfRuin !== undefined) profileRows.push(['CVCX risk of ruin', `${cvcx.riskOfRuin}%`]);
  if (cvcx?.simNote) profileRows.push(['CVCX sim note', cvcx.simNote]);
  if (actualAccuracyPct !== null) {
    profileRows.push([
      `Your play accuracy${actualAccuracyAssisted ? ` (${actualAccuracyAssisted})` : ''}`,
      pct(totalCorrect, totalGraded),
    ]);
  }
  // B2, R3/#50: the label says what is priced and the value does not repeat
  // it; bet and sit misses are counted beside the figure, never hidden.
  if (lossPer100 !== null) {
    const bets = betMissText(sessionsBetMisses(profileSessions));
    profileRows.push(['Lost to playing mistakes', bets ? `${formatLossValue(lossPer100)} · ${bets}` : formatLossValue(lossPer100)]);
  }
  // G2 (L-8): its own row -- never part of play accuracy above.
  const dealerErrors = sessionsDealerErrors(profileSessions);
  if (dealerErrors) profileRows.push(['Dealer errors caught', dealerErrorsValue(dealerErrors)]);
  // W3: hard / soft / pairs, as Home's Next step judges them.
  const handRows = handCategoryProgress(stats);

  return (
    <div className="stats-screen" data-active-tab={tab}>
      {/* Wave W: Stats is half of the You tab now; the bar switches to Progress. */}
      <YouHeader current="stats" onNavigate={onNavigate} />
      <h1 className="u-sr-only">Stats</h1>
      {showSetAside && (
        <p className="stats-message stats-quarantine-note" role="status" data-testid="stats-quarantine-note">
          Saved {setAside.join(', ')} could not be read on this phone. The unreadable copy is kept aside and goes into
          every backup (Export backup, at the bottom), so nothing is lost. Export one before you reset anything.
          <button
            type="button"
            className="stats-quarantine-dismiss"
            onClick={() => {
              dismissQuarantineNotice();
              setNoticeDismissed((n) => n + 1);
            }}
          >
            Dismiss
          </button>
        </p>
      )}

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
            ? 'Showing all time.'
            : 'The range applies to dated results. Basic strategy goal adds an in-range line for timed drill answers. Its goal figures are always your latest answers (the last 30 per hand type), and Accuracy by category, Flashcards, Shot clock on vs off, Indexes, Mistake types, the Bet or sit table rows and the spaced-repetition boxes are undated tallies, so they show all time.'}
        </p>
      </div>

      {/*
        W15: the profile block lives on Play only, starts closed, and lists only
        the figures it actually has -- six rows of dashes used to be the first
        thing on every Stats tab.
      */}
      <CollapsibleSection
        title={<>Profile: {activeProfile.name}</>}
        className="stats-section"
        dataTab="play"
        defaultOpen={false}
      >
          {profileRows.length === 0 ? (
            <p className="stats-detail">
              No CVCX figures or table sessions for this profile yet. Add CVCX numbers in the profile
              editor, or play a shoe.
            </p>
          ) : (
            <ul className="mistake-list">
              {profileRows.map(([label, value]) => (
                <li className="mistake-row" key={label}>
                  <span>{label}</span>
                  <span>{value}</span>
                </li>
              ))}
            </ul>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Accuracy by category</>}
        className="stats-section"
        dataTab={SECTION_TAB['Accuracy by category']}
        defaultOpen={false}
      >
          {/* D-R2 (#4): table decisions only. The hand goal Home judges on
              (drills and table alike) is its own section on Progress. */}
          <div className="category-list" data-testid="play-categories">
            {CATEGORY_ORDER.filter((cat) => cat !== 'wongIn' || play.categories.wongIn.right + play.categories.wongIn.wrong > 0).map((cat) => {
              const tally = play.categories[cat];
              const total = tally.right + tally.wrong;
              const pctNum = total === 0 ? 0 : (tally.right / total) * 100;
              return (
                <div className="category-row" key={cat} data-category={cat}>
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
          <p className="stats-detail">Decisions made at the Play table. Drill answers are on the Drills tab.</p>
          {playDecisionMs !== null && (
            <p className="stats-detail" data-testid="play-decision-time">
              Median decision time: {formatLatency(playDecisionMs)}
            </p>
          )}
      </CollapsibleSection>

      {/*
        W3 / s02: hard, soft and pairs against the 90% goal, read from the
        SAME figure Home's Next step judges (handProgress.ts), so the two
        screens cannot disagree. D-R2: it pools drills and table, so it lives
        on Progress, not Play.
      */}
      <CollapsibleSection
        title={<>Basic strategy goal</>}
        className="stats-section"
        dataTab={SECTION_TAB['Basic strategy goal']}
        defaultOpen={false}
      >
          {latencyCut && (
            <p className="u-note stats-latency-cut" data-testid="stats-latency-cut">
              Times read the newest {HISTORY_CAP.toLocaleString('en-US')} timed answers, from {latencyCut}; the accuracy counts
              every answer in the range.
            </p>
          )}
          <div className="category-list">
            {handRows.map((hand) => {
              const cat = HAND_CATEGORIES.find((h) => h.prefix === hand.prefix)!.category;
              const latencyMs = medianLatency(latencyRows.filter((e) => e.category === cat));
              return (
                <HandGoalRow key={hand.prefix} row={hand} latencyText={formatLatency(latencyMs)} rangeText={inRangeText(cat)} />
              );
            })}
          </div>
          <p className="stats-detail">Every hand you answer counts here: the drills and the Play table.</p>
      </CollapsibleSection>

      {/*
        Flashcards had NO section at all, and worse, no way to have one: every
        graded decision -- flashcards, deviation quiz and live table play --
        was pooled into `stats.categories`, so a 70% on "soft" could not be
        attributed to any of them. `bySource` splits the tally; this reads the
        flashcard slice only.

        `bySource` is optional (blobs written before it exists lack it), so an
        absent branch renders the empty state rather than throwing.
      */}
      <CollapsibleSection
        title={<>Flashcards</>}
        className="stats-section"
        dataTab={SECTION_TAB['Flashcards']}
        defaultOpen={false}
      >
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
          {/* #22: answers withdrawn with "Wrong tap" (a drill control). Not
              mistakes -- they were taken out of every tally -- but counted, so
              a habit of mis-tapping stays visible. */}
          <ul className="mistake-list">
            <li className="mistake-row" data-testid="stats-admitted-misses">
              <span>{MISTAKE_LABELS['self-report']}</span>
              <span>{stats.mistakes['self-report'] ?? 0}</span>
            </li>
            <li className="mistake-row" data-testid="stats-misclicks">
              <span>Wrong taps (not counted)</span>
              <span>{stats.misclicks ?? 0}</span>
            </li>
          </ul>
      </CollapsibleSection>

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
      <CollapsibleSection
        title={<>Shot clock on vs off</>}
        className="stats-section"
        dataTab={SECTION_TAB['Flashcards']}
        defaultOpen={false}
      >
          {(() => {
            const split = stats.shotClockSplit;
            const t = split?.timed ?? { right: 0, wrong: 0 };
            const u = split?.untimed ?? { right: 0, wrong: 0 };
            const tn = t.right + t.wrong;
            const un = u.right + u.wrong;
            if (tn === 0 || un === 0) {
              return (
                <p className="stats-detail">
                  Answer hand drills with the shot clock on and with it off to compare the two.
                  Speed under a deadline and what you actually know are different things, and only
                  what you know lasts.
                </p>
              );
            }
            // The verdict, and whether there IS one -- see statsFormat's
            // clockGap. This used to state the difference as fact off one
            // answer per bucket, three lines under a comment warning that a
            // figure "off two cards would invite exactly the wrong
            // conclusion".
            const verdict = clockGap(t, u);
            return (
              <>
                <div className="category-list">
                  {[
                    { label: 'Shot clock on', tally: t, total: tn },
                    { label: 'Shot clock off', tally: u, total: un },
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
                <p
                  className="stats-detail"
                  data-clock-verdict={verdict.distinguishable ? 'stated' : 'too-few'}
                >
                  {verdict.text}
                </p>
              </>
            );
          })()}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Indexes</>}
        className="stats-section"
        dataTab={SECTION_TAB['Indexes']}
        defaultOpen={false}
      >
          {/* E7: every index the profile is graded on (24 with surrender
              indices on), the table's answers only (D-R2): worst first, with
              which way each is missed; unanswered ones are one line. */}
          <IndexTable
            asked={askedIndices}
            tally={play.perIndex}
            direction={play.indexDirection}
            testId="play-index-table"
          />
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Mistake types</>}
        className="stats-section"
        dataTab={SECTION_TAB['Mistake types']}
        defaultOpen={false}
      >
          <ul className="mistake-list">
            {MISTAKE_ORDER.map((cls) => (
              <li className="mistake-row" key={cls}>
                <span>{MISTAKE_LABELS[cls]}</span>
                <span>{cls === 'basic-error' ? handBasicErrors : play.mistakes[cls]}</span>
              </li>
            ))}
            {/* s06: Play files these under basic-error; they are not hand plays. */}
            {NON_HAND_MISSES.filter((k) => nonHandMisses[k] > 0).map((k) => (
              <li className="mistake-row" key={k} data-testid={`stats-misses-${k}`}>
                <span>{NON_HAND_MISS_LABEL[k]}</span>
                <span>{nonHandMisses[k]}</span>
              </li>
            ))}
          </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title={
          <span className="cost-head">
            <span>Cost of mistakes</span>
            {evCost.priced > 0 && (
              <span className="cost-head-meta" data-testid="cost-head">
                {evCost.priced} {evCost.priced === 1 ? 'mistake' : 'mistakes'} · {formatUnits(evCost.unitsTotal)} units
              </span>
            )}
          </span>
        }
        className="stats-section"
        dataTab={SECTION_TAB['Cost of mistakes']}
        defaultOpen={false}
      >
          {evCost.priced === 0 ? (
            <p className="stats-detail">
              No priced mistakes yet. Basic strategy errors in Play and the hand drills are priced in
              units of your base bet, so your most expensive habits show up here.
            </p>
          ) : (
            <>
              <p className="stats-detail">
                In units of your base bet, {formatUnits(evCost.meanUnits!)} per mistake on average.
              </p>
              <ul className="mistake-list">
                {(showAllCosts ? evCost.worst : evCost.worst.slice(0, COST_ROWS_SHOWN)).map((row) => (
                  <li className="mistake-row" key={row.key}>
                    <span>
                      {costHandLabel(row.hand)}: {playLabel(row.taken)} for {playLabel(row.expected)}
                    </span>
                    <span className="mistake-value">
                      ×{row.times}, {formatUnits(row.unitsTotal)} u
                    </span>
                  </li>
                ))}
              </ul>
              {evCost.worst.length > COST_ROWS_SHOWN && (
                <button
                  type="button"
                  className="cost-show-all"
                  aria-expanded={showAllCosts}
                  onClick={() => setShowAllCosts((v) => !v)}
                >
                  {showAllCosts ? `Show top ${COST_ROWS_SHOWN}` : `Show all ${evCost.worst.length}`}
                </button>
              )}
              <p className="stats-detail">
                Ranked by total cost, so a small mistake you repeat outranks one big slip. Prices are
                exact for an infinite deck at a neutral count.
                {unpricedNote}{' '}
                {evCostUndated > 0
                  ? ` ${evCostUndated} priced ${evCostUndated === 1 ? 'mistake has' : 'mistakes have'} no date, so ${evCostUndated === 1 ? 'it shows' : 'they show'} only under "All time".`
                  : ''}
              </p>
            </>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Count drill</>}
        className="stats-section"
        dataTab={SECTION_TAB['Count drill']}
        defaultOpen={false}
      >
          <p className="stats-detail">
            Best clean run:{' '}
            {bestCleanRun.auto === null && bestCleanRun.manual === null
              ? '—'
              : formatCountRun((bestCleanRun.auto ?? bestCleanRun.manual)!)}
          </p>
          {bestCleanRun.auto !== null && bestCleanRun.manual !== null && (
            <p className="stats-detail">Best clean manual run: {formatCountRun(bestCleanRun.manual)}</p>
          )}
          {checkpointsAsked > 0 && (
            <>
              <p className="stats-detail">
                Checkpoints held: {checkpointsHeld}/{checkpointsAsked} (
                {pct(checkpointsHeld, checkpointsAsked)}) over {checkpointRuns.length}{' '}
                {checkpointRuns.length === 1 ? 'run' : 'runs'}
              </p>
              <p className="stats-detail">
                {cancelledRuns === 0
                  ? 'No run has ended on the right count by luck.'
                  : `${cancelledRuns} ${cancelledRuns === 1 ? 'run' : 'runs'} ended on the right count by luck: you missed a checkpoint, but the errors cancelled out by the end.`}
              </p>
            </>
          )}
          {recentRuns.length === 0 ? (
            <p className="stats-detail">No count drill runs yet.</p>
          ) : (
            <>
              <ResultTrend history={countHistory} noun="runs" />
              <ul className="count-history-list">
                {recentRuns.map((run, i) => (
                  <li className="count-history-row" key={i}>
                    <span>{formatDate(run.date)}</span>
                    <span className="count-run-mode">{countRunMode(run)}</span>
                    <span className="count-history-pace">{formatCountRun(run)}</span>
                    <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                      {run.correct ? 'correct' : 'wrong'}
                    </span>
                  </li>
                ))}
              </ul>
              {countHistory.length > HISTORY_ROWS_SHOWN && (
                <button
                  type="button"
                  className="cost-show-all"
                  aria-expanded={showAllRuns}
                  onClick={() => setShowAllRuns((v) => !v)}
                >
                  {showAllRuns ? `Show newest ${HISTORY_ROWS_SHOWN}` : `Show all ${countHistory.length} runs`}
                </button>
              )}
            </>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Timed count challenge</>}
        className="stats-section"
        dataTab={SECTION_TAB['Timed count challenge']}
        defaultOpen={false}
      >
          <p className="stats-detail">
            {timedCountSummary.attempts === 0
              ? 'No timed runs yet.'
              : `${timedCountSummary.correct}/${timedCountSummary.attempts} correct (${pct(timedCountSummary.correct, timedCountSummary.attempts)})`}
          </p>
          {timedCountSummary.attempts > 0 && (
            <p className="stats-detail">
              Best clean speed: {timedCountBest === null ? '—' : `${timedCountBest.toFixed(1)}s / deck`}
            </p>
          )}
          {timedCountRecent.length === 0 ? null : (
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
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Distraction</>}
        className="stats-section"
        dataTab={SECTION_TAB['Distraction']}
        defaultOpen={false}
      >
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
                  {pctOfPercent(distractionSum.answerAccuracyPct)}
                </span>
              </li>
              <li className="mistake-row">
                <span>Count kept</span>
                <span>
                  {pctOfPercent(distractionSum.countKeptPct)}
                </span>
              </li>
            </ul>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Pair cancellation</>}
        className="stats-section"
        dataTab={SECTION_TAB['Pair cancellation']}
        defaultOpen={false}
      >
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
      </CollapsibleSection>

      {/* Wave L: Play's side-bet calls and the side count drill. */}
      <CollapsibleSection
        title={<>Side bets</>}
        className="stats-section"
        dataTab={SECTION_TAB['Side bets']}
        defaultOpen={false}
      >
          <SideBetStatsSection stats={stats} />
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Spaced repetition — Flashcards</>}
        className="stats-section"
        dataTab={SECTION_TAB['Spaced repetition — Flashcards']}
        defaultOpen={false}
      >
          <SrStatusPanel deckLabel="flashcards" summary={flashSrSummary} labelForKey={(k) => k} />
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Spaced repetition — Deviation quiz</>}
        className="stats-section"
        dataTab={SECTION_TAB['Spaced repetition — Deviation quiz']}
        defaultOpen={false}
      >
          <SrStatusPanel deckLabel="deviation-quiz items" summary={quizSrSummary} labelForKey={quizLabelFor} />
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Retention</>}
        className="stats-section"
        dataTab={SECTION_TAB['Retention']}
        defaultOpen={false}
      >
          {retentionReviews === 0 ? (
            <p className="stats-detail">
              No spaced reviews yet. Items come back for review after a gap of a day or more, so
              check back tomorrow.
            </p>
          ) : (
            <>
              <p className="stats-detail">
                Accuracy on items reviewed after a gap. This is the best guide to what you will
                remember at a real table.
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
                  <span>Likely range</span>
                  <span className="mistake-value">{formatInterval(retentionPooled)}</span>
                </li>
              </ul>
              {retentionHasCurve ? (
                <>
                  <h3 className="sr-lapses-title">By gap length</h3>
                  <p className="stats-detail">
                    Memory fades with time, so a three-day gap and a five-week gap are shown
                    separately rather than averaged together.
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
                  Every spaced review so far is at one gap length. A breakdown appears once items
                  come due after longer gaps.
                </p>
              )}
            </>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Bet or sit</>}
        className="stats-section"
        dataTab={SECTION_TAB['Bet or sit']}
        defaultOpen={false}
      >
          {/* s06: the table's own bet and play-or-sit decisions. D-R2: the
              drills' answers are in "Bet sizing drill" on the Drills tab. */}
          {tableBet.n + tableWong.n + tableWongIn.n === 0 ? (
            <p className="stats-detail">
              No bet or sit decisions at the table yet. Play with a bet spread on.
            </p>
          ) : (
            <ul className="mistake-list">
              {tableBet.n > 0 && (
                <li className="mistake-row" data-testid="bsl-table-bet">
                  <span>At the table: bet size when playing</span>
                  <span>
                    {tableBet.right}/{tableBet.n} ({pct(tableBet.right, tableBet.n)})
                  </span>
                </li>
              )}
              {betHandsMisses > 0 && (
                <li className="mistake-row" data-testid="bsl-table-bet-hands">
                  <span>Of those missed: one hand or two</span>
                  <span>{betHandsMisses}</span>
                </li>
              )}
              {tableWong.n > 0 && (
                <li className="mistake-row" data-testid="bsl-table-wong">
                  <span>At the table: stay in or get out</span>
                  <span>
                    {tableWong.right}/{tableWong.n} ({pct(tableWong.right, tableWong.n)})
                  </span>
                </li>
              )}
              {tableWongIn.n > 0 && (
                <li className="mistake-row" data-testid="bsl-table-wong-in">
                  <span>At the table: stay out or get in</span>
                  <span>
                    {tableWongIn.right}/{tableWongIn.n} ({pct(tableWongIn.right, tableWongIn.n)})
                  </span>
                </li>
              )}
              {entryMissed + entryEarly > 0 && (
                <li className="mistake-row" data-testid="bsl-table-wong-in-misses">
                  <span>Entries missed · early</span>
                  <span>
                    {entryMissed} · {entryEarly}
                  </span>
                </li>
              )}
            </ul>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Bet sizing drill</>}
        className="stats-section"
        dataTab={SECTION_TAB['Bet sizing drill']}
        defaultOpen={false}
      >
          {bslAttempts === 0 && betSizingDrill.length === 0 ? (
            <p className="stats-detail">No Bet sizing answers yet. Try the Bet sizing drill.</p>
          ) : (
            <ul className="mistake-list">
              {betSizingDrill.length > 0 && (
                <li className="mistake-row" data-testid="bsl-drill-bet-sizing">
                  <span>Bet sizing drill</span>
                  <span>
                    {betSizingRight}/{betSizingDrill.length} ({pct(betSizingRight, betSizingDrill.length)})
                  </span>
                </li>
              )}
              {bslAttempts > 0 && (
                <>
                  <li className="mistake-row">
                    <span>Bet or sit drill: decisions</span>
                    <span>{bslAttempts}</span>
                  </li>
                  <li className="mistake-row">
                    <span>Bet or sit drill: accuracy</span>
                    <span>{pct(bslCorrect, bslAttempts)}</span>
                  </li>
                </>
              )}
              {bslLeaveRows.length > 0 && (
                <li className="mistake-row">
                  <span>Accuracy when it was time to leave (old)</span>
                  <span>{pct(bslLeaveCorrect, bslLeaveRows.length)}</span>
                </li>
              )}
            </ul>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Fatigue</>}
        className="stats-section"
        dataTab={SECTION_TAB['Fatigue']}
        defaultOpen={false}
      >
          <Stepper
            label="Break that starts a new session"
            value={fatigueGapMin}
            min={5}
            max={120}
            step={5}
            format={(v) => `${v} min`}
            onChange={setFatigueGapMin}
          />
          {fatigue.drift === null ? (
            <p className="stats-detail">
              Not enough back-to-back counting runs yet. Do several count drill or timed count runs
              in one sitting to compare your early and late accuracy.
            </p>
          ) : (
            <>
              <p className="stats-detail">
                Accuracy in the first vs second half of each session: does your count hold up late?
                ({fatigue.sessions} session{fatigue.sessions === 1 ? '' : 's'}, {fatigue.samples} runs)
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
                    {signedFixed(fatigue.drift * 100, 0)}%{' '}
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
              No dated answer times in this range yet. Pace drift needs several flashcard or
              deviation quiz answers in one sitting.
            </p>
          ) : (
            <>
              <p className="stats-detail">
                Answer time in the first vs second half of each session. Slowing down usually shows
                up before accuracy drops. ({pace.sessions} session{pace.sessions === 1 ? '' : 's'},{' '}
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
                    {signedFixed(pace.driftMs / 1000, 1)}s{' '}
                    {paceVerdict ? `(${paceVerdict})` : ''}
                  </span>
                </li>
              </ul>
            </>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>True count drill</>}
        className="stats-section"
        dataTab={SECTION_TAB['True count drill']}
        defaultOpen={false}
      >
          {/* The headline accuracy is ResultTrend's, below the breakdown. */}
          {trueCountSummary.attempts === 0 && <p className="stats-detail">No true count drill attempts yet.</p>}
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
          <ResultTrend history={trueCountRows} noun="answers" />
          {trueCountRecent.length === 0 ? null : (
            <>
              <h3 className="sr-lapses-title">Recent misses</h3>
              <ul className="count-history-list">
                {trueCountRecent.map((run, i) => (
                  <li className="count-history-row" key={i}>
                    <span>{formatDate(run.date)}</span>
                    <span>
                      RC {formatSigned(run.runningCount)} / {run.decksRemaining} decks remaining
                    </span>
                    <span>
                      {run.guess === undefined ? 'self-reported' : `you said ${signed(run.guess)}`}, it was{' '}
                      {signed(run.correctTc)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
      </CollapsibleSection>

      {/* s05: Produce TC was saved and never shown. */}
      <CollapsibleSection
        title={<>Produce TC</>}
        className="stats-section"
        dataTab={SECTION_TAB['Produce TC']}
        defaultOpen={false}
      >
          {produceTcSummary.attempts === 0 ? (
            <p className="stats-detail">No Produce TC attempts yet.</p>
          ) : (
            <>
              <ResultTrend history={produceTcRows} noun="answers" />
              {produceTcMisses.length > 0 && (
                <>
                  <h3 className="sr-lapses-title">Recent misses</h3>
                  <ul className="count-history-list">
                    {produceTcMisses.map((run, i) => (
                      <li className="count-history-row" key={i}>
                        <span>{formatDate(run.date)}</span>
                        <span>
                          {run.produced === undefined ? 'self-reported' : `you said ${signed(run.produced)}`}, it was{' '}
                          {signed(run.correctTc)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Deviation quiz</>}
        className="stats-section"
        dataTab={SECTION_TAB['Deviation quiz']}
        defaultOpen={false}
      >
          {/* H9: the table below pools every drill's index answers (With
              count, Speed, answers from before the quiz kept its own tally),
              so "no answers yet" is said only when it is empty too. */}
          {quizTotal === 0 ? (
            Object.keys(drillIndex).length === 0 ? (
              <p className="stats-detail">No deviation quiz answers yet.</p>
            ) : (
              <p className="stats-detail" data-testid="drill-index-caption">Index answers from drills</p>
            )
          ) : (
            <div className="stats-headline">
              <span className="stats-headline-value">{pct(quizRight, quizTotal)}</span>
              <span className="stats-headline-label">
                {quizRight}/{quizTotal} correct, all time.
              </span>
            </div>
          )}
          {/* D-R2: the drills' per-index answers (the Play tab's Indexes is
              the table's). Rows: the indexes the drills ask (D-R3), in the
              same E7 table: worst first, Early/Late, unanswered as one line.
              An Index-test miss is wrong with no direction. */}
          {Object.keys(drillIndex).length > 0 && (
            <IndexTable
              asked={askedIndices}
              tally={drillIndex}
              direction={drillDirection}
              testId="drill-index-table"
            />
          )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Deck estimation drill</>}
        className="stats-section"
        dataTab={SECTION_TAB['Deck estimation drill']}
        defaultOpen={false}
      >
          <p className="stats-detail">
            {deckEstSummary.attempts === 0
              ? 'No deck estimation attempts yet.'
              : `${deckEstSummary.correct}/${deckEstSummary.attempts} correct (${pct(deckEstSummary.correct, deckEstSummary.attempts)})`}
          </p>
          {deckEstRecent.length === 0 ? null : (
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
      </CollapsibleSection>

      <CollapsibleSection
        title={<>Table sessions</>}
        className="stats-section"
        dataTab={SECTION_TAB['Table sessions']}
        defaultOpen={false}
      >
          {sessions.length === 0 ? (
            <p className="stats-detail">No table sessions yet.</p>
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
                      <span className="session-assisted session-tag"> · {assistedFlag(s.peeks)}</span>
                    )}
                    {sessionTag(s) && <span className="session-tag"> · {sessionTag(s)}</span>}
                  </span>
                  {/* B2 #35: a Hot shoe session's bankroll was not kept (B8), so its
                      change is not shown as a result. */}
                  {s.hotShoe ? (
                    <span className="session-not-kept">not kept</span>
                  ) : (
                    <span className={s.bankrollDelta >= 0 ? 'result-correct' : 'result-wrong'}>
                      {formatSigned(s.bankrollDelta)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </CollapsibleSection>

      <section className="stats-section stats-actions">
        <div className="stats-action-row">
          <button type="button" className="stats-action-btn" onClick={handleExport}>
            Export backup
          </button>
          <button type="button" className="stats-action-btn" onClick={handleImportClick}>
            Import backup
          </button>
          <button type="button" className="stats-action-btn" onClick={handleSpeakSummary}>
            Read summary aloud
          </button>
          <button type="button" className="stats-action-btn stats-danger-btn" onClick={handleReset}>
            Reset stats
          </button>
        </div>
        <p className="stats-last-backup" data-testid="stats-last-backup">
          {lastBackupText(lastBackup, now)}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="stats-file-input"
          onChange={handleFileChange}
        />
        {undo && (
          <div className="stats-action-row">
            <button type="button" className="stats-action-btn" onClick={handleUndoImport}>
              Undo import
            </button>
          </div>
        )}
        {message && <p className="stats-message">{message}</p>}
      </section>
    </div>
  );
}
