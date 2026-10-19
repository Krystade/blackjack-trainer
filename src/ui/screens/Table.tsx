import { strategyRulesFor } from '../../store/profiles';
import { TabSettingsButton } from '../components/TabSettingsButton';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Card } from '../../engine/cards';
import { TELL_MIN_ROUNDS } from '../../engine/coverBets';
import type { DealSlot, Game, PlayerHand, Seat } from '../../engine/game';
import { handPlayNumber } from '../../engine/game';
import type { Action } from '../../engine/deviations';
import type { PlayContext } from '../../engine/strategy';
import type { RuleSet } from '../../engine/ruleset';
import { basicPlay, correctPlay } from '../../engine/strategy';
import { isBust } from '../../engine/hand';
import { useGame } from '../useGame';
import type { CountCheckVerdict, SessionReport } from '../useGame';
import { ResultStrip } from '../components/ResultStrip';
import { countVerdictPart } from '../countVerdictPart';
import { reportSections, countMissText, drillCellIds, playRowText, betRowText, unpricedNote } from '../reportSections';
import { setDrillLaunch, setReviewDeck } from '../drillLaunch';
import type { MistakeRow } from '../reportSections';
import { lossPer100, formatLossPer100, betMissText } from '../sessionFigures';
import { betMissCount } from '../sessionRow';
import './sessionReport.css';
import { useAudio } from '../../audio/useAudio';
import { useVoiceControl } from '../useVoiceControl';
import { useWheelCommand } from '../useWheelCommand';
import {
  detectVoiceSupport,
  VOICE_ACTIONS,
  matchSpokenAlternatives,
} from '../../audio/voiceRecognition';
import { parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../audio/voiceNumber';
import { narrateReadback, narrateTableCountPrompt } from '../../audio/narrate';
import type { VoiceAction } from '../../audio/voiceRecognition';
import { actionUnavailable } from '../../drills/answerGate';
import { enableAudioNow } from '../audioGate';
import { PlayingCard, formatCard } from '../components/PlayingCard';
import { ActionBar } from '../components/ActionBar';
import type { ActionBarMode } from '../components/ActionBar';
import { BottomSheet } from '../components/BottomSheet';
import { DiscardTray } from '../components/DiscardTray';
import { PeekButton } from '../components/PeekButton';
import { MistakeCard } from '../components/MistakeCard';
import { StudyChartOverlay } from '../components/StudyChartOverlay';
import { playMissReason } from './playMissReason';
import { NumPad } from '../components/NumPad';
import { VoiceStatusBar } from '../components/VoiceStatusBar';
import { VOICE_WORDS } from '../voiceLabels';
import { assistedFlag, peekReadout } from '../peekFlag';
import { useVoiceToggle, usePushToTalk, startPushToTalk } from '../voiceSession';
import { CATEGORY_LABELS } from './categoryLabels';
import { LosingShoeBadge } from '../components/LosingShoeBadge';
import { roundBanner } from '../roundBanner';
import { RoundBannerLine } from '../components/RoundBannerLine';
import { signed, MINUS } from '../../drills/signed';
import './tableSeats.css';
import './tableTopbar.css';
import './tableCues.css';
import './tableGlance.css';
import './tableSheet.css';
import './playMissReason.css';
import { dealerFeltRow, playerFeltLayout, type FeltRow } from '../feltLayout';
import { useViewportWidth } from '../useViewportWidth';
import { DEAL_WORDS, isDealWord } from '../dealWord';
import { BACK_COUNT_BIAS, backCountWordIn } from '../backCountWords';
import './backCount.css';
import './tableDock.css';
import './tableCompact.css';
import { spreadHasTwoHands } from '../../engine/wong';
import './feltWrap.css';
import './tableVoiceFit.css';
import './countSheetBanner.css';
import { DealerPaceBar } from '../components/DealerPaceBar';
import { FoulCall } from '../components/FoulCall';
import { DEALER_TRAINING_REPORT, dealerErrorsValue, dealerMistakesModeIn } from '../dealerErrorCopy';
import './dealerTraining.css';
import { createDecisionTimer, holdWhileSpeaking, type DecisionTimer } from '../decisionTimer';
import { dealerPaceMs, isSlowDecision, slowDecisionsText } from '../dealerPace';
import { trackedElapsedMs } from '../../drills/idleAnswer';
import { isAppSpeaking } from '../../audio/speech';
import { useEyesFreeToggle } from '../eyesFreeSession';
import { loadStats } from '../../store/persist';
import { trayMarksShown } from '../trayFade';

/** B5/W4: the row's card slots and fixed chrome, for cardSize.css's clamp. */
function feltStyle(row: FeltRow): CSSProperties {
  return { '--felt-slots': row.slots, '--felt-fixed': `${row.fixedPx}px` } as CSSProperties;
}

type BotActionLogEntry = Game['botActionLog'][number];

/** P1..P5 labels, assigned in seat order (casino order) skipping the player
 * seat — the same seat-order rule for every bot regardless of whether it
 * sits before or after the player. */
function botSeatLabels(seats: Seat[]): Map<number, string> {
  const labels = new Map<number, string>();
  let n = 0;
  seats.forEach((seat, i) => {
    if (seat.kind === 'bot') {
      n += 1;
      labels.set(i, `P${n}`);
    }
  });
  return labels;
}

/** Position of `slot` within the round's `game.dealOrder`, or `undefined` if
 * it never occupied one (any card past the opening two cards of a hand, or
 * past the dealer's first two, is a later hit/double/split/settlement draw
 * and always animates the instant it mounts -- see PlayingCard.tsx). */
function dealIndexOf(order: DealSlot[], slot: DealSlot): number | undefined {
  const idx = order.findIndex((s) => {
    if (s.kind !== slot.kind) return false;
    if (s.kind === 'dealer' && slot.kind === 'dealer') return s.cardIndex === slot.cardIndex;
    if (s.kind === 'player' && slot.kind === 'player') {
      return s.handIndex === slot.handIndex && s.cardIndex === slot.cardIndex;
    }
    if (s.kind === 'bot' && slot.kind === 'bot') {
      return s.seatIndex === slot.seatIndex && s.handIndex === slot.handIndex && s.cardIndex === slot.cardIndex;
    }
    return false;
  });
  return idx === -1 ? undefined : idx;
}

function resultLetter(result: PlayerHand['result']): string | null {
  switch (result) {
    case 'win':
    case 'blackjack':
      return 'W';
    case 'lose':
    case 'surrender':
      return 'L';
    case 'push':
      return 'P';
    default:
      return null;
  }
}

function botActionText(entry: BotActionLogEntry, label: string): string {
  switch (entry.action) {
    case 'hit':
      return entry.card ? `${label} hits ${formatCard(entry.card)}` : `${label} hits`;
    case 'double':
      return entry.card ? `${label} doubles, hits ${formatCard(entry.card)}` : `${label} doubles`;
    case 'stand':
      return `${label} stands`;
    case 'surrender':
      return `${label} surrenders`;
    case 'split':
      return `${label} splits`;
    default:
      return '';
  }
}

/** Builds the paced narration lines for the first `revealed` entries of
 * `game.botActionLog`. A synthetic "{label} busts" line follows a hit/double
 * whenever it was that hand's LAST logged action and the hand's (already
 * fully engine-resolved) final cards are bust — the log itself only records
 * the raw decision, not the outcome. Reveal is by raw log-entry count, so a
 * bust line always rides along with the action that caused it (no extra
 * pacing delay). */
function buildBotNarration(game: Game, revealed: number): string[] {
  const log = game.botActionLog;
  if (log.length === 0) return [];

  const labels = botSeatLabels(game.seats);
  const lastIndexForHand = new Map<string, number>();
  log.forEach((entry, i) => lastIndexForHand.set(`${entry.seat}:${entry.handIndex}`, i));

  const lines: string[] = [];
  for (let i = 0; i < revealed && i < log.length; i++) {
    const entry = log[i];
    const label = labels.get(entry.seat) ?? `P${entry.seat + 1}`;
    lines.push(botActionText(entry, label));

    if (entry.action === 'hit' || entry.action === 'double') {
      const isLastForHand = lastIndexForHand.get(`${entry.seat}:${entry.handIndex}`) === i;
      const hand = game.seats[entry.seat]?.hands[entry.handIndex];
      if (isLastForHand && hand && isBust(hand.cards)) {
        lines.push(`${label} busts`);
      }
    }
  }
  return lines;
}

interface TableProps {
  settings: Settings;
  activeProfile: Profile;
  onNavigate: (screen: Screen) => void;
  /** Present so switching voice on can switch audio on with it, the way the
   * drills' eyes-free toggle does -- answering out loud is worthless without
   * hearing the reply, and a control that sits dead until you visit another
   * screen is the bug that made eyes-free unusable once already. */
  onSettingsChange: (settings: Settings) => void;
}

// What the microphone is doing, in words that say what to do about it. Kept
// identical to the drills' strip: the same failure must not read two ways.
function isE2E(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('e2e') === '1';
}

/** Every signed number on the Table and its report: "+2", "+0", "−3", with a
 * real minus (contract 6). The count-voice value was the Wave A leftover that
 * still printed the ASCII hyphen. */
const formatSigned = (n: number) => signed(n, { plusZero: true });

function countVerdictOk(v: CountCheckVerdict): boolean {
  return v.rcCorrect !== false && v.tcCorrect !== false;
}

/**
 * The count check's verdict on screen (#36 follow-up). It used to be spoken
 * only, so with the sound off a wrong count passed with no sign of what the
 * shoe held: "Count ✓ +3", or "Count ✗ you said +1, it was −5".
 */
function countVerdictText(v: CountCheckVerdict): string {
  const part = countVerdictPart; // B2 #21: repeats the typed figure
  const parts: string[] = [];
  if (v.rcCorrect !== undefined) parts.push(part('Count', v.rcGuess, v.rcCorrect, v.actualRc));
  if (v.tcCorrect !== undefined && v.actualTc !== undefined) {
    parts.push(part('True count', v.tcGuess, v.tcCorrect, v.actualTc));
  }
  return parts.join(' · ');
}

/** How long the End button stays armed after its first tap. */
const END_ARMED_MS = 3000;

/** Units lost, two decimals, real minus: "−0.61"; a rounded-away cost reads "0". */
function unitsText(units: number): string {
  const abs = Math.abs(units).toFixed(2);
  if (abs === '0.00') return signed(0);
  return `${units > 0 ? MINUS : '+'}${abs}`;
}

/** " ×n" for repeats, then " · −0.61 u" when the row was priced. */
function RowTail({ row }: { row: MistakeRow }) {
  return (
    <>
      {row.count > 1 && <span className="report-mistake-count"> &times;{row.count}</span>}
      {row.unitsTotal !== null && <span className="report-row-units"> &middot; {unitsText(row.unitsTotal)} u</span>}
    </>
  );
}

function ReportScreen({
  report,
  coverBetsOn,
  rules,
  onDone,
  onDrill,
}: {
  report: SessionReport;
  /** H7: the session's rules, for the plays' chart-region reasons. */
  rules: RuleSet;
  /** Whether this session graded with cover bets (one rung either side). */
  coverBetsOn: boolean;
  onDone: () => void;
  /** B6: open Custom on exactly the report's missed cells. */
  onDrill?: (cellIds: string[]) => void;
}) {
  // R7 (docs/BACKLOG.md): this screen shows after every End (see handleEnd),
  // so a peek-assisted session's accuracy is flagged right under the headline
  // number it qualifies — the number can't be mistaken for unassisted.
  const assisted = assistedFlag(report.peeks);
  const sections = reportSections(report.mistakes);
  const unpricedPlays = sections.plays.filter((r) => r.unitsTotal === null).reduce((n, r) => n + r.count, 0);
  const gradedCountCheck = report.categories.some((c) => c.category === 'countCheck' && c.right + c.wrong > 0);
  const loss = lossPer100(report.mistakeUnits, report.hands);
  // B2, R3: the figure prices play decisions; bet and sit misses are counted
  // beside it, so a session with only betting errors never reads as clean.
  const betMisses = betMissText(betMissCount(report.mistakes));
  const drillIds = drillCellIds(sections.plays);
  return (
    <div className="report-screen">
      <h1>Session report</h1>
      {report.hotShoe && (
        <p className="report-hot-shoe">Hot shoe: the counts ran high on purpose, so this session&rsquo;s bankroll isn&rsquo;t kept.</p>
      )}
      {/* Wave I: a Training session's error rate is not a real table's. */}
      {report.dealerMistakesTraining && (
        <p className="report-dealer-training" data-testid="report-dealer-training">
          {DEALER_TRAINING_REPORT}
        </p>
      )}
      {(loss !== null || betMisses !== null) && (
        <p className="report-headline" data-units-total={report.mistakeUnits} data-hands={report.hands}>
          {loss !== null && <span className="report-headline-loss">{formatLossPer100(loss)}</span>}
          {betMisses !== null && (
            <span className="report-headline-bets">
              {loss !== null && ' · '}
              {betMisses}
            </span>
          )}
        </p>
      )}
      {unpricedPlays > 0 && <p className="report-unpriced">{unpricedNote(unpricedPlays)}</p>}
      <p className="report-summary">
        {report.correct} / {report.graded} correct
        {!report.hotShoe && <> &middot; bankroll {formatSigned(report.bankrollDelta)}</>}
      </p>
      {assisted && <p className="report-assisted">{assisted}</p>}
      {/* F5: only when the dealer-pace clock ran for some decision. */}
      {/* G2: its own row, outside every accuracy figure above. */}
      {report.dealerErrors && (
        <p
          className="report-dealer-errors"
          data-testid="report-dealer-errors"
          data-made={report.dealerErrors.made}
          data-caught={report.dealerErrors.caught}
        >
          Dealer errors caught {dealerErrorsValue(report.dealerErrors)}
        </p>
      )}
      {report.pacedDecisions > 0 && (
        <p className="report-slow" data-testid="report-slow" data-slow={report.slowDecisions}>
          {slowDecisionsText(report.slowDecisions)}
        </p>
      )}
      {/* RT#11 (docs/BACKLOG.md): perfect conformity to the ramp IS the tell,
          so a session that had it is told so. Shown whether or not cover
          grading is on -- the tolerance makes room for cover, but only this
          says whether any was taken. Silent below the sample floor, where the
          ratio would be noise rather than a pattern. */}
      {/* s06: with cover bets off, every bet off the ramp is graded a
          mistake, so warning about betting the ramp exactly contradicted the
          grading. Off, the ratio is stated plainly with the way to practise
          cover; the warning is kept for a session that allowed cover and
          still took none. */}
      {report.cover.rounds >= TELL_MIN_ROUNDS && (
        <p className={report.cover.isTell && coverBetsOn ? 'report-tell' : 'report-cover'}>
          Bet cover: {report.cover.exact} of {report.cover.rounds} rounds bet the ramp
          exactly ({Math.round(report.cover.ratio * 100)}%)
          {!coverBetsOn
            ? '. Turn on Cover bets in your profile to practise varying it.'
            : report.cover.isTell
              ? '. Betting that close to the count is what gets counters noticed.'
              : '.'}
        </p>
      )}
      <table className="report-categories">
        <thead>
          <tr>
            <th>Category</th>
            <th>Right</th>
            <th>Wrong</th>
            <th>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {report.categories.map((c) => (
            <tr key={c.category}>
              <td>{CATEGORY_LABELS[c.category] ?? c.category}</td>
              <td>{c.right}</td>
              <td>{c.wrong}</td>
              <td>{Math.round(c.accuracy * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Plays</h2>
      {sections.plays.length === 0 ? (
        <p>No play mistakes.</p>
      ) : (
        <ul className="report-mistakes report-plays">
          {sections.plays.map((row, i) => (
            <li
              key={i}
              data-units={row.unitsTotal !== null ? row.unitsTotal : undefined}
              data-cell={row.cellId ?? undefined}
            >
              {playRowText(row.mistake, rules)}
              <RowTail row={row} />
            </li>
          ))}
        </ul>
      )}
      {onDrill && drillIds.length > 0 && (
        <button type="button" className="report-drill-btn" onClick={() => onDrill(drillIds)}>
          Drill these hands
        </button>
      )}
      {gradedCountCheck && (
        <>
          <h2>Count checks</h2>
          {sections.counts.length === 0 ? (
            <p>No count checks missed.</p>
          ) : (
            <ul className="report-mistakes report-counts">
              {sections.counts.map((row, i) => (
                <li key={i}>
                  {countMissText(row.mistake)}
                  {row.count > 1 && <span className="report-mistake-count"> &times;{row.count}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {sections.bets.length > 0 && (
        <>
          <h2>Bets</h2>
          <ul className="report-mistakes report-bets">
            {sections.bets.map((row, i) => (
              <li key={i}>
                {betRowText(row.mistake)}
                {row.count > 1 && <span className="report-mistake-count"> &times;{row.count}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="report-done-btn" onClick={onDone}>
        Back to Home
      </button>
    </div>
  );
}

export function Table({ settings, activeProfile, onNavigate, onSettingsChange }: TableProps) {
  // Cycle-3 Task 4: constructed once here (Table owns `settings`) and
  // threaded into useGame, which wraps every engine call (deal/act/insure/
  // submitCount) and the existing bot-narration pacing timer -- that's
  // where every Phase-A speak()/chime() trigger for the table actually
  // lives. `useAudio` is referentially stable, so this never causes extra
  // re-renders or re-fires of useGame's effects beyond audio settings
  // actually changing.
  const audio = useAudio(settings.audio);

  // Voice input. Per-session and never persisted, so the microphone is never
  // opened by a page load -- only by someone asking for it.
  // Remembered for the life of the page load, not the life of this screen:
  // a toggle forgotten on every navigation is indistinguishable, in a car,
  // from a microphone that failed. See ui/voiceSession.ts.
  const [voiceOn, setVoiceOn] = useVoiceToggle('table');
  const pushToTalkOpen = usePushToTalk();
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  // A spoken count is a PROPOSAL until it is read back and confirmed. Holding
  // it here rather than submitting on hearing it is the whole reason numbers
  // are safe to say out loud: a misheard digit costs one "no", not a
  // corrupted session.
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const {
    game,
    losingShoe,
    hotShoe,
    deal,
    act,
    insure,
    callFoul,
    submitCount,
    requestEnd,
    overlay,
    dismissOverlay,
    report,
    endSession,
    notePeek,
    betMiss,
    botNarrationRevealed,
    fastForwardNarration,
    sitOut,
    dealAnimating,
    skipDeal,
  } = useGame(settings, activeProfile, audio);
  // Cycle-2 Task 8: one selected bet per player hand. `playerHandsCount`
  // comes from the PROFILE's seat config, not `game.hands.length` — the
  // latter still reflects the *previous* round's (possibly split-grown)
  // hand count while we're sitting in the bet phase, before `startRound`
  // rebuilds the seat. The game's own seat config, not the profile's: the
  // Losing shoe (#48-51) deals solo whatever the profile says, and a bets
  // array sized to the profile would make startRound throw.
  const playerHandsCount = game.cfg.seats?.playerHands ?? activeProfile.seats.playerHands;
  const [selectedBets, setSelectedBets] = useState<number[]>(() => new Array(playerHandsCount).fill(1));
  // Wave J: a ramp that spreads to two hands opens each round with one or two.
  const [spreadHands, setSpreadHands] = useState<1 | 2>(1);
  /**
   * Review B1: the bottom dock (peek row + bar) is sticky on a tall screen,
   * and the peek row sits on top of the bar -- at the bar's height, which
   * changes with its mode, so it is measured after every render.
   */
  const screenRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = screenRef.current;
    const bar = el?.querySelector<HTMLElement>(':scope > .action-bar');
    if (!el || !bar) return;
    const h = `${bar.offsetHeight}px`;
    if (el.style.getPropertyValue('--table-bar-h') !== h) el.style.setProperty('--table-bar-h', h);
  });
  /**
   * Fix rounds 2 and 3: what a phone must show is kept between the pinned
   * topbar and the docked bar. A decision needs the dealer's up-card and the
   * hand being played; a settled round, the dealer's hand, the player's hands
   * and the result line; a watched one, the dealer and the Watching spot.
   * tableCompact.css shrinks a crowded table so that region fits; this
   * scrolls the least that puts it in the band -- and if it ever did not fit,
   * keeps its TOP (the dealer) on screen rather than its bottom.
   */
  const handScrollKey = `${game.roundNo}:${game.phase}:${game.hands.length}:${game.active}:${game.watching}`;
  useLayoutEffect(() => {
    const el = screenRef.current;
    const scroller = document.scrollingElement;
    if (!el || !scroller || typeof window.scrollTo !== 'function') return;
    let placedAt = -1;
    const place = () => {
      // Only when the page has grown or shrunk -- never fighting a scroll.
      // Not once the table has gone (the report replaces it in place).
      if (!el.isConnected || scroller.scrollHeight === placedAt) return;
      placedAt = scroller.scrollHeight;
      if (scroller.scrollHeight <= window.innerHeight) return;
      const dealer = el.querySelector<HTMLElement>(':scope > .dealer-area');
      const active = el.querySelector<HTMLElement>('.player-hand.hand-active');
      const spots = active
        ? [active]
        : [...el.querySelectorAll<HTMLElement>('.player-hand, .player-watching, .message-strip .message-result')];
      if (!dealer || spots.length === 0) return;
      const y = window.scrollY;
      const topbar = el.querySelector<HTMLElement>(':scope > .topbar');
      const bandTop = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0;
      // The docked rows sit at the bottom of the viewport whatever the scroll.
      const docked = [...el.querySelectorAll<HTMLElement>(':scope > .peek-dock, :scope > .action-bar')].filter(
        (d) => getComputedStyle(d).position === 'sticky',
      );
      const bandBottom = window.innerHeight - docked.reduce((h, d) => h + d.offsetHeight, 0);
      const regionTop =
        Math.min(...[dealer, ...dealer.querySelectorAll<HTMLElement>('.card')].map((d) => d.getBoundingClientRect().top)) + y;
      const regionBottom = Math.max(...spots.map((s) => s.getBoundingClientRect().bottom)) + y;
      const least = regionBottom - bandBottom; // the smallest scroll showing the bottom
      const most = regionTop - bandTop; // the largest keeping the top
      const target = Math.max(0, least > most ? most : Math.min(Math.max(y, least), most));
      if (Math.abs(target - y) > 0.5) window.scrollTo(0, target);
    };
    place();
    // The narration and the bots' cards keep arriving after the phase
    // changes, so keep placing for a moment -- until the player scrolls.
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const stop = () => ro.disconnect();
    const timer = window.setTimeout(stop, 2000);
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    return () => {
      stop();
      window.clearTimeout(timer);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
    };
  }, [handScrollKey]);
  const setBetForHand = (i: number, units: number) => {
    setSelectedBets((prev) => prev.map((v, idx) => (idx === i ? units : v)));
  };
  const [rcStage, setCountStage] = useState<'rc' | 'tc'>('rc');
  // #3: a true-count-only check (Profile.countCheckAsk 'true') has no
  // running-count stage, so it opens straight on the true count.
  const countStage: 'rc' | 'tc' = game.askRc ? rcStage : 'tc';
  const [pendingRc, setPendingRc] = useState(0);
  const [peeking, setPeeking] = useState(false);
  const [showReport, setShowReport] = useState(false);
  // #7: the strategy chart opened over a wrong play, ringed on its cell.
  const [showChart, setShowChart] = useState(false);

  // R7 (docs/BACKLOG.md, count-peek accountability): one per reveal, so the
  // session report / Stats can flag a peek-assisted accuracy. Counted in
  // useGame (B2, R1), so the provisional session row carries them too.
  /**
   * #40: HOLD to show, release to hide (spec 2026-10-13). It was a toggle,
   * which left the count latched on screen; a hold makes every look at the
   * count a deliberate, bounded act, and each one still counts. The press
   * dedup (one pointerdown per physical press, a rising-edge guard for key
   * repeat) lives in PeekButton.
   */
  const revealPeek = () => {
    if (game.countCheckDue || game.countCheckOpen) return;
    notePeek();
    setPeeking(true);
  };
  const hidePeek = () => setPeeking(false);

  /**
   * A spoken command at the table.
   *
   * Every branch is guarded by what is actually on screen, in the order the
   * screen stacks: a word said while a modal is up must act on the modal, not
   * on the round behind it. Legality comes from the ENGINE rather than from
   * the card list -- only it knows about split depth, doubling after a split,
   * and how many cards the hand already holds -- and an illegal call is
   * refused OUT LOUD, since a greyed-out button means nothing to a driver.
   */
  const handleVoiceCommand = (command: VoiceAction) => {
    if (command === 'repeat') {
      audio.replay();
      return;
    }

    // The chart is modal over a correction that is itself modal over the
    // round. Nothing below it may be reached by voice.
    if (showChart) return;

    // A correction is waiting to be acknowledged. "Yes" is the way past it
    // without a tap; an action word here would otherwise be applied to the
    // round underneath, which is not what was being answered.
    if (overlay) {
      if (command === 'yes') dismissOverlay();
      return;
    }

    // The count check owns the microphone while it is open -- see
    // interpretCountSpeech, which claims every transcript before this runs.
    // Reaching here with it open would mean a stray word playing a hand
    // behind the prompt.
    if (game.countCheckOpen) return;

    if (game.phase === 'insurance') {
      if (command === 'yes') insure(true);
      else if (command === 'no') insure(false);
      return;
    }

    if (game.phase === 'player') {
      if (command === 'yes' || command === 'no') return;
      if (!legal.includes(command)) {
        audio.say(actionUnavailable(command));
        return;
      }
      timedAct(command);
      // Move the recogniser's restart gap into the pause after the action,
      // while the correction is being spoken, rather than leaving it to fall
      // in the middle of the next decision.
      voice.cycleIfStale();
      return;
    }

    // Between rounds. "Yes" deals the next hand, so a whole shoe can be
    // played without touching the screen. Wave J: a watcher's next hand is
    // dealt without them -- "yes" watches, and only "sit in" sits down.
    if ((game.phase === 'idle' || game.phase === 'settled') && command === 'yes') {
      if (game.watching) handleSitOut();
      else handleDeal();
    }
  };

  /**
   * The count check, answered out loud.
   *
   * It claims EVERY transcript while it is open, for two reasons: a number is
   * not in the command vocabulary and would otherwise be discarded as noise,
   * and a stray "hit" must not play the hand waiting behind the prompt.
   *
   * Nothing is submitted on hearing it. A value is read back and has to be
   * confirmed, which is what makes speaking a count safe at all -- the cost
   * of a misheard digit is one "no" rather than a session scored against an
   * answer nobody gave.
   *
   * Parsing runs BEFORE the yes/no vocabulary on purpose: "no, minus three"
   * is a correction, and matching "no" first would clear the value the
   * operator was in the middle of giving.
   */
  const interpretCountSpeech = (heard: string, offered: readonly string[] = [heard]): string | null => {
    if (!game.countCheckOpen) {
      // Wave J: the back-counter's words, between rounds, with the same gates
      // as "deal" below -- which, watching, is one of them (a watch).
      const readings = offered.length > 0 ? offered : [heard];
      if (game.backCountOn && !showChart && !overlay && (game.phase === 'idle' || game.phase === 'settled')) {
        const word = backCountWordIn(readings, game.watching ? 'watching' : 'seated');
        if (word === 'sit-in') {
          handleDeal();
          return 'sit in';
        }
        if (word === 'watch' || word === 'leave') {
          handleSitOut();
          return word;
        }
      }
      // B2 #37: "deal" between rounds deals, exactly as "yes" does there. It
      // is not in the command vocabulary (it means nothing anywhere else), so
      // it is claimed here, with the same gates handleVoiceCommand applies.
      if (
        !showChart &&
        !overlay &&
        (game.phase === 'idle' || game.phase === 'settled') &&
        isDealWord(offered.length > 0 ? offered : [heard])
      ) {
        handleDeal();
        return 'deal';
      }
      return null;
    }

    // A spoken number is ranked over a car microphone exactly as a spoken
    // word is, and "minus three" behind "minus tree" is the same failure with
    // a worse consequence: a running count is harder to say twice than a hand
    // is to play twice. So every reading is tried, best first, and the first
    // one that is actually a number wins.
    let parsed: ReturnType<typeof parseCountSpeech> = null;
    for (const reading of offered.length > 0 ? offered : [heard]) {
      parsed = parseCountSpeech(reading);
      if (parsed) break;
    }
    if (parsed) {
      const next =
        parsed.kind === 'value' ? parsed.value : (pendingCount ?? 0) + parsed.delta;
      setPendingCount(next);
      audio.say(narrateReadback(next));
      return `count ${speakableCount(next)}`;
    }

    // Yes/no is a command like any other, so it gets the runners-up too.
    switch (matchSpokenAlternatives(offered.length > 0 ? offered : [heard])) {
      case 'yes': {
        if (pendingCount === null) {
          audio.say('I have no count yet. What is it?');
          return 'nothing to confirm';
        }
        const confirmed = pendingCount;
        setPendingCount(null);
        handleCountSubmit(confirmed);
        return `submitted ${speakableCount(confirmed)}`;
      }
      case 'no':
        // A rejection clears the proposal outright rather than trying to
        // salvage it: the operator said it was wrong, not nearly right.
        setPendingCount(null);
        audio.say(countPromptText());
        return 'cleared, say it again';
      case 'repeat':
        audio.say(
          pendingCount === null
            ? countPromptText()
            : narrateReadback(pendingCount),
        );
        return 'repeated';
      default:
        return 'not a count';
    }
  };


  // The steering wheel, mapped onto the same affirmative the microphone uses.
  // Deliberately NOT gated on `voiceOn`: the wheel only reaches this app when
  // the microphone is OFF (an open mic switches the car to its hands-free call
  // route and the wheel's buttons go to that call), so gating it on voice would
  // arm it in exactly the state where it cannot work. See audio/wheelCommands.ts.
  // The wheel, in the only vocabulary it has: two directions.
  //
  // Mapped onto the spoken words rather than onto new handlers, so a press and
  // the equivalent utterance cannot drift apart. `back` is `repeat` here
  // because there is nothing on this screen to step backwards THROUGH -- see
  // the count drills, where it walks a number down instead.
  useWheelCommand((command) => {
    // Push-to-talk mode: forward OPENS THE MICROPHONE instead of answering.
    // A mode rather than an extra gesture -- there are two buttons and three
    // things to say with them (see DrillSettings.wheelMode). Back still
    // repeats, which is the one meaning worth keeping in every mode.
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('table');
        // A cue, because the window is invisible and the Bluetooth route
        // takes a moment to flip: without it there is no way to tell
        // "listening now" from "pressed nothing".
        audio.ding('attention');
      } else {
        handleVoiceCommand('repeat');
      }
      return;
    }
    // Wave J, one rule at a back-count table between rounds: FORWARD CARRIES
    // ON ("yes": watching, watch; seated, deal) and BACK CHANGES SEAT (watching,
    // sit in; seated, leave). Both seat changes are on the wheel, so a
    // wheel-only driver can Wong in AND out. Back still repeats in play, in
    // insurance, under the count check and in talk mode; between rounds here
    // the Repeat button and the spoken "repeat" still replay.
    if (
      command === 'back' &&
      game.backCountOn &&
      (game.phase === 'idle' || game.phase === 'settled') &&
      !game.countCheckOpen &&
      !overlay &&
      !showChart
    ) {
      if (game.watching) handleDeal();
      else handleSitOut();
      return;
    }
    handleVoiceCommand(command === 'forward' ? 'yes' : 'repeat');
  });

  const voice = useVoiceControl({
    // The push-to-talk window opens the microphone exactly as the toggle
    // does; the only difference is that something closes it again.
    enabled: voiceOn || pushToTalkOpen,
    onAction: handleVoiceCommand,
    onTranscript: interpretCountSpeech,
    // Eyes-free, a rejection is silence, and silence looks the same as a dead
    // microphone. A short cue says "say it again" without costing a sentence
    // of narration mid-drill; Mute silences it like every other tone.
    onNotUnderstood: () => audio.ding('again'),
    // C-R4: a second miss on the same decision repeats it, a third names the
    // words it takes. Keyed on what is being asked, so a new decision starts
    // the count again.
    escalation: {
      promptKey: `${game.roundNo}|${game.phase}|${game.active}|${game.hands.map((h) => h.cards.length).join(',')}|${overlay ? 'overlay' : ''}`,
      reask: () => audio.replay(),
    },
    // ...and the state before that one. The table is played eyes-free too, and
    // the microphone can take seconds to come up on the first ask of a page.
    onListening: () => audio.dingWhenQuiet('ready'),
    // Biased toward the commands AND the count words at once. The phrase list
    // is fixed for the life of a session, and rebuilding the recogniser as
    // the prompt opens would cost a deaf gap exactly when an answer is due.
    biasPhrases: [
      ...Object.keys(VOICE_ACTIONS),
      ...DEAL_WORDS,
      ...COUNT_BIAS_PHRASES,
      // Wave J: only at a back-count table, which a session never switches.
      // Two-word forms only (review S1): see BACK_COUNT_BIAS.
      ...(game.backCountOn ? BACK_COUNT_BIAS : []),
    ],
    context: 'table',
  });

  const handleDeal = () => {
    // Wave J: one hand or two, each at the selected chip.
    if (game.spreadsHands) {
      deal(new Array<number>(spreadHands).fill(selectedBets[0] ?? 1));
      setCountStage('rc');
      return;
    }
    if (playerHandsCount > 1) {
      deal(activeProfile.betSpreadOn ? selectedBets : undefined);
    } else {
      deal(activeProfile.betSpreadOn ? selectedBets[0] : undefined);
    }
    setCountStage('rc');
  };

  // Wong-out (R5): sit the round out. The engine still plays it (bots + dealer),
  // so the count/penetration advance and the sit-out is graded against the
  // spread — the exit decision the table otherwise can't practice.
  const handleSitOut = () => {
    sitOut();
    setCountStage('rc');
  };

  const countPromptText = (): string => narrateTableCountPrompt(countStage === 'rc' ? 'rc' : 'tc');

  // Ask out loud when the prompt appears, and again if it moves on to the
  // true count. Without this the app simply goes quiet mid-drive and the
  // round looks frozen: the modal is the only thing saying an answer is due.
  const countDue = game.countCheckOpen;
  useEffect(() => {
    if (!voiceOn || !countDue) return;
    audio.say(countPromptText());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, countDue, countStage]);

  // F9 / B2 #31: no peek while a count check is OWED, not only while its sheet
  // is open. The check is owed from the moment the round settles and the sheet
  // opens on the next Deal, so in between the peek read off the exact answer
  // about to be graded. A peek held as the check falls due ends there (the
  // button unmounts under the thumb, so its release never arrives).
  const peekBlocked = game.countCheckDue || game.countCheckOpen;
  useEffect(() => {
    if (peekBlocked) setPeeking(false);
  }, [peekBlocked]);

  // A proposal belongs to one prompt. Carrying it across would offer the
  // running count back as an answer to the true-count question.
  useEffect(() => {
    setPendingCount(null);
  }, [countDue, countStage]);

  const [countVerdict, setCountVerdict] = useState<CountCheckVerdict | null>(null);
  const handleCountSubmit = (n: number) => {
    if (game.askRc && game.askTcToo && countStage === 'rc') {
      setPendingRc(n);
      setCountStage('tc');
      return;
    }
    const { endNow, check } = !game.askRc
      ? submitCount(null, n)
      : game.askTcToo
        ? submitCount(pendingRc, n)
        : submitCount(n);
    setCountVerdict(check);
    setCountStage('rc');
    // The answer released an End that was waiting on it.
    if (endNow) finishSession();
  };

  // End is two taps, like Finish in the field test: it sits at the top of the
  // screen, and one thumb-slip while driving used to end the shoe (and, in
  // Training mode, skip the report). The first tap arms it ("Tap again to
  // end") and it disarms itself after 3s. The report is always shown now.
  const [confirmEnd, setConfirmEnd] = useState(false);
  // B2 #33: two hands take a row each when one row would shrink their cards.
  const viewportW = useViewportWidth();
  const feltLayout = playerFeltLayout(game.hands.map((h) => h.cards.length), viewportW);
  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), END_ARMED_MS);
    return () => clearTimeout(t);
  }, [confirmEnd]);

  const handleEnd = () => {
    if (!confirmEnd) {
      setConfirmEnd(true);
      return;
    }
    setConfirmEnd(false);
    // A count check owed on the last round is asked first; answering it ends
    // the session (handleCountSubmit).
    if (!requestEnd()) return;
    finishSession();
  };

  function finishSession() {
    // F22: nothing was dealt, so there is nothing to report or to keep.
    if (endSession() === null) {
      onNavigate('home');
      return;
    }
    setShowReport(true);
  }

  /**
   * F5 (W2-17): decision timing. A decision starts when its buttons enable
   * (the player phase, on a new hand or a new card) and is held while a modal
   * covers it, and -- eyes-free (the drills' eyes-free switch, or the table's
   * microphone) -- while the app is speaking. ui/decisionTimer.ts.
   */
  const [eyesFreeSwitch] = useEyesFreeToggle('table');
  const eyesFree = eyesFreeSwitch || voiceOn;
  const paceMs = dealerPaceMs(settings, eyesFree);
  // G2 (L-8): read live, like the pace clock -- rounds that settle from here
  // on use it. Off eyes-free. Wave I: at the mode's rate.
  const mistakesMode = dealerMistakesModeIn(settings, eyesFree);
  useLayoutEffect(() => {
    game.setDealerMistakes(mistakesMode);
  }, [game, mistakesMode]);
  const timerRef = useRef<DecisionTimer | null>(null);
  timerRef.current ??= createDecisionTimer();
  const decidingHand = game.phase === 'player' ? game.hands[game.active] : undefined;
  const decisionKey = decidingHand
    ? `${game.roundNo}|${game.active}|${game.hands.length}|${decidingHand.cards.length}`
    : null;
  const modalOverHand = overlay !== null || showChart;
  useLayoutEffect(() => {
    if (decisionKey === null) timerRef.current!.clear();
    else timerRef.current!.start();
  }, [decisionKey]);
  useLayoutEffect(() => {
    timerRef.current!.hold('modal', modalOverHand);
  }, [modalOverHand]);
  useEffect(() => {
    if (!eyesFree) return;
    return holdWhileSpeaking(timerRef.current!, isAppSpeaking);
  }, [eyesFree]);
  const timedAct = (action: Action) => {
    const timer = timerRef.current!;
    // The speech hold is sampled; take its state as of this tap.
    if (eyesFree) timer.hold('speech', isAppSpeaking());
    const measured = timer.take();
    act(action, {
      // An idle hand (#30's cap) still counts as slow, but has no time.
      elapsedMs: measured === null ? undefined : trackedElapsedMs(Math.round(measured), false),
      slow: isSlowDecision(measured, paceMs),
      paced: paceMs !== null && measured !== null,
    });
  };

  // F6 (W2-18): the tray's deck marks fade once deck estimation is on target.
  // Read at mount: nothing at the table writes deck-estimation history.
  const [trayMarks] = useState(() => trayMarksShown(loadStats()));

  // B2 #48: the report opens at its top. The table it replaces may be scrolled
  // (the count check's sheet at End scrolls the page), and that scroll used to
  // carry over and hide the report's title under the status bar.
  useLayoutEffect(() => {
    if (showReport) window.scrollTo(0, 0);
  }, [showReport]);

  const handleReportDone = () => {
    setShowReport(false);
    onNavigate('home');
  };

  // B6 / Wave B2 R5 (#46): Flashcards on exactly the missed cells, handed
  // over in memory as a labelled session deck. The saved Custom deck is not
  // touched (it used to be overwritten with these cells, every other cell
  // marked painted).
  const handleReportDrill = (ids: string[]) => {
    setReviewDeck(ids, 'session');
    setDrillLaunch('flash');
    setShowReport(false);
    onNavigate('drills');
  };

  if (showReport && report) {
    return (
      <ReportScreen
        report={report}
        coverBetsOn={game.cfg.coverBets === true}
        rules={game.rules}
        onDone={handleReportDone}
        onDrill={handleReportDrill}
      />
    );
  }

  const activeHand: PlayerHand | undefined = game.hands[game.active];
  const legal = game.legalActions();

  let advice: Action | undefined;
  if (isE2E() && game.phase === 'player' && activeHand && game.dealerCards[0]) {
    const ctx: PlayContext = {
      canDouble: legal.includes('double'),
      canSplit: legal.includes('split'),
      canSurrender: legal.includes('surrender'),
    };
    const rules = strategyRulesFor(activeProfile);
    // #34: the advice follows what the table grades against.
    advice =
      game.cfg.gradeDeviations === false
        ? basicPlay(activeHand.cards, game.dealerCards[0].rank, ctx, rules).action
        : correctPlay(activeHand.cards, game.dealerCards[0].rank, game.trueCountNow, ctx, rules).action;
  }

  let barMode: ActionBarMode;
  if (game.phase === 'player') {
    barMode = { kind: 'actions', legal, onAction: timedAct, advice };
  } else if ((game.phase === 'idle' || game.phase === 'settled') && !game.countCheckOpen) {
    barMode = {
      kind: 'bet',
      betSpreadOn: activeProfile.betSpreadOn,
      // Listed in order of play (#1): row "Hand 1" stakes the rightmost hand,
      // which is dealt first and played first (the dealer deals from their
      // left, the player's right), so it names the same hand as the felt's
      // label and the result line.
      hands: selectedBets
        .map((units, i) => ({
          selectedBet: units,
          onSelectBet: (u: number) => setBetForHand(i, u),
        }))
        .reverse(),
      onDeal: handleDeal,
      // Wong-out only makes sense against a spread (the same gate the engine
      // uses to grade it); a flat-bet table hides the Sit Out button entirely.
      onSitOut: activeProfile.betSpreadOn ? handleSitOut : undefined,
      // Wave J: watching, the two are Watch and Sit in; seated at a
      // back-count table, sitting out is leaving it.
      ...(game.watching ? { watching: true } : game.backCountOn ? { sitOutLabel: 'Leave' } : {}),
      ...(game.spreadsHands ? { handsChoice: { hands: spreadHands, onHands: setSpreadHands } } : {}),
    };
  } else {
    barMode = { kind: 'hidden' };
  }

  const multiHand = game.hands.length > 1;
  // #41: built every render, but only drawn while the peek is held.
  const peek = peekReadout(game.runningCount, game.exactDecksRemaining);

  // Cycle-2 Task 6: bot seats/narration/fast-forward are a strict no-op when
  // the profile has no bots (v1-solo parity — `game.seats` holds just the
  // player seat and `botActionLog` is always empty, so every value below is
  // empty/false and nothing extra renders).
  const botSeats = game.seats.filter((s) => s.kind === 'bot');
  const hasBots = botSeats.length > 0;
  const botLabels = botSeatLabels(game.seats);
  const botNarrationLines = buildBotNarration(game, botNarrationRevealed);
  const pacingPending = botNarrationRevealed < game.botActionLog.length;
  /**
   * M8: HOW MANY CARDS EACH BOT HAND HAS EARNED ON SCREEN.
   *
   * Bots resolve to completion inside `act()`, so by the time React renders, a
   * bot that hit three times already has five cards laid out -- while the
   * narration is still reading "P2 hits" as its first line. The screen was a
   * round ahead of the commentary describing it, which is the one thing pacing
   * exists to prevent.
   *
   * A hand is keyed by seat AND hand index because a bot can split, and the two
   * halves draw independently. Only entries that actually took a card count: a
   * stand or a surrender narrates without changing what is on the felt.
   */
  const revealedBotDraws = new Map<string, number>();
  for (const entry of game.botActionLog.slice(0, botNarrationRevealed)) {
    if (!entry.card) continue;
    const key = `${entry.seat}:${entry.handIndex}`;
    revealedBotDraws.set(key, (revealedBotDraws.get(key) ?? 0) + 1);
  }
  /**
   * The cards to draw for one bot hand right now.
   *
   * The bypass is pacing being finished -- including a fast-forward, which
   * jumps `botNarrationRevealed` to the end. NOT settlement: with the player at
   * first base every bot acts in `resolveBotsAfter`, so the round is already
   * settled by the time their narration starts, and exempting a settled round
   * would switch this off in exactly the common case.
   *
   * So the only thing this can do is delay a card, never lose one, and the
   * final frame never depends on the arithmetic above being exactly right
   * about a split.
   */
  const visibleBotCards = (hand: { cards: Card[] }, seatIndex: number, handIndex: number): Card[] => {
    if (!pacingPending) return hand.cards;
    const shown = 2 + (revealedBotDraws.get(`${seatIndex}:${handIndex}`) ?? 0);
    return hand.cards.slice(0, Math.min(hand.cards.length, shown));
  };
  // Skips BOTH pacing mechanisms together: a tap/click must never leave one
  // mechanism caught up while the other is still pending, which would keep
  // the fast-forward button rendered after being clicked (see
  // e2e/table-seats.spec.ts's "fast-forward" spec, which asserts the button
  // disappears immediately on click).
  const skipEverything = () => {
    fastForwardNarration();
    skipDeal();
  };

  return (
    <div
      ref={screenRef}
      className={`table-screen${hasBots || game.spreadsHands ? ' table-crowded' : ''}`}
      style={{ ['--deal-speed']: `${settings.dealSpeedMs}ms` } as CSSProperties}
    >
      <div className="topbar">
        <div className="topbar-stat">
          Bankroll: {game.bankroll}
          <span className="topbar-profile-name" style={{ marginLeft: 6, fontSize: '0.7em', opacity: 0.65 }}>
            {activeProfile.name}
          </span>
        </div>
        <div className="topbar-stat">Round {game.roundNo}</div>
        <TabSettingsButton tab="play" />
        {settings.audio.enabled && (
          <button type="button" className="repeat-btn" onClick={audio.replay}>
            Repeat
          </button>
        )}
        {voiceSupported && (
          <button
            type="button"
            className="voice-btn"
            aria-pressed={voiceOn}
            onClick={() => {
              if (!voiceOn && !settings.audio.enabled) {
                enableAudioNow(settings, onSettingsChange);
              }
              setVoiceOn(!voiceOn);
            }}
          >
            Voice
          </button>
        )}
        <button
          type="button"
          className="end-btn"
          aria-label={confirmEnd ? 'Tap again to end the session' : 'End session'}
          title="End session"
          data-armed={confirmEnd ? 'true' : undefined}
          onClick={handleEnd}
        >
          {confirmEnd ? 'Tap again to end' : 'End'}
        </button>
      </div>
      {losingShoe && <LosingShoeBadge />}
      {/* Wave J (review N3): the rig plays solo, so say what it switched off. */}
      {losingShoe &&
        activeProfile.betSpreadOn &&
        (activeProfile.backCount === true || spreadHasTwoHands(activeProfile.spread)) && (
          <p className="losing-shoe-solo-note" data-testid="losing-shoe-solo-note">
            The losing shoe plays solo: back-counting and two hands are off.
          </p>
        )}
      {hotShoe && (
        <div className="hot-shoe-badge" data-testid="hot-shoe-badge">
          {/* B2 #35: the topbar bankroll still moves, so say it is thrown away. */}
          Hot shoe &middot; bankroll not kept
        </div>
      )}

      {voiceOn && (
        <VoiceStatusBar
          status={voice.status}
          hint={
            <>
              Say: {VOICE_WORDS}. &ldquo;Yes&rdquo; or &ldquo;deal&rdquo; deals the next hand; &ldquo;yes&rdquo; takes insurance, &ldquo;no&rdquo; declines it.
              {game.backCountOn && (
                <>
                  {' '}
                  Watching, &ldquo;yes&rdquo;, &ldquo;deal&rdquo; or &ldquo;watch&rdquo; watches and &ldquo;sit in&rdquo; sits
                  you down; seated, &ldquo;leave&rdquo; leaves the table. On the wheel between rounds, forward
                  carries on and back sits in or leaves.
                </>
              )}
              {/* Wave J: the hand count is not a spoken word, as the bet is
                  not: "yes" deals what the toggle and chip are set to. */}
              {game.spreadsHands && <> &ldquo;Yes&rdquo; deals the hands and bet set on screen.</>}
            </>
          }
        />
      )}

      {/* R6 (docs/BACKLOG.md, RT#3): a live discard-tray depth cue. Real tables
          have a visible tray; without one, the table's TC checks give no
          referent to ESTIMATE decks-remaining from, stranding the deck-
          estimation drill as an island. Shows only the fill (deliberately NO
          exact number) so the count-check still requires a real by-eye
          estimate — connecting that drill to its point of use. #38 adds a mark
          per whole deck, labelled decks dealt, so depth reads like a real tray. */}
      <DiscardTray cardsDealt={game.shoe.cardsDealt} decks={activeProfile.rules.decks} marks={trayMarks} />

      <div className="dealer-area" style={feltStyle(dealerFeltRow(game.dealerCards.length))}>
        {game.dealerCards.map((c, i) => (
          <PlayingCard
            key={i}
            card={c}
            faceDown={i === 1 && !game.holeRevealed}
            dealIndex={
              i < 2 && dealAnimating
                ? dealIndexOf(game.dealOrder, { kind: 'dealer', cardIndex: i as 0 | 1 })
                : undefined
            }
          />
        ))}
      </div>

      {hasBots && (
        <div className="bot-seats-row">
          {game.seats.map((seat, seatIndex) => {
            if (seat.kind !== 'bot') return null;
            const label = botLabels.get(seatIndex) ?? `P${seatIndex + 1}`;
            return (
              <div key={seatIndex} className="bot-seat">
                <div className="bot-seat-label">{label}</div>
                {seat.hands.map((hand, handIndex) => (
                  <div key={handIndex} className="bot-hand">
                    <div className="bot-hand-cards">
                      {visibleBotCards(hand, seatIndex, handIndex).map((c, j) => (
                        <PlayingCard
                          key={j}
                          card={c}
                          size="compact"
                          dealIndex={
                            j < 2 && dealAnimating
                              ? dealIndexOf(game.dealOrder, {
                                  kind: 'bot',
                                  seatIndex,
                                  handIndex,
                                  cardIndex: j as 0 | 1,
                                })
                              : undefined
                          }
                        />
                      ))}
                    </div>
                    {game.phase === 'settled' && !pacingPending && resultLetter(hand.result) && (
                      <div className={`bot-result-marker bot-result-${resultLetter(hand.result)}`}>
                        {resultLetter(hand.result)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div
        className="hands-row"
        data-wrap={feltLayout.wrap ? '' : undefined}
        style={feltStyle(feltLayout.row)}
      >
        {/* Wave J: an empty spot while back-counting is the player watching. */}
        {game.watching && game.hands.length === 0 && (
          <div className="player-watching" data-testid="player-watching">
            Watching
          </div>
        )}
        {game.hands.map((hand, i) => (
          <div
            key={i}
            className={`player-hand${i === game.active && game.phase === 'player' ? ' hand-active' : ''}`}
            style={feltLayout.wrap ? feltStyle(feltLayout.hands[i]!) : undefined}
          >
            {/* s06: a split is labelled too, so "Hand 1" in the results names
                a hand on the felt (hand 1 is the RIGHT one: order of play). */}
            {(playerHandsCount > 1 || game.hands.length > 1) && (
              <div className="hand-label">Hand {handPlayNumber(i, game.hands.length)}</div>
            )}
            <div className="hand-cards">
              {hand.cards.map((c, j) => (
                <PlayingCard
                  key={j}
                  card={c}
                  dealIndex={
                    j < 2 && dealAnimating
                      ? dealIndexOf(game.dealOrder, { kind: 'player', handIndex: i, cardIndex: j as 0 | 1 })
                      : undefined
                  }
                />
              ))}
            </div>
            {/* s06: a doubled hand has twice its bet riding on it. */}
            <div className="hand-bet">Bet: {hand.doubled ? hand.bet * 2 : hand.bet}</div>
          </div>
        ))}
      </div>

      <div
        className="message-strip"
        onClick={hasBots || dealAnimating ? skipEverything : undefined}
      >
        {countVerdict && game.roundNo <= countVerdict.round && (
          <ResultStrip
            id={countVerdict.round}
            tone={countVerdictOk(countVerdict) ? 'ok' : 'miss'}
          >
            {countVerdictText(countVerdict)}
          </ResultStrip>
        )}
        {/* B2 #13 (R2): a wrong bet or sit decision, said as it is made and
            kept with its round; it never blocks the hand. */}
        {betMiss && betMiss.round === game.roundNo && (
          <ResultStrip id={`bet-${betMiss.round}`} tone="miss">
            <span className="bet-miss">{betMiss.text}</span>
          </ResultStrip>
        )}
        {game.shuffledLastRound && (
          <div className="message-shuffle">{game.newTableLastRound ? 'New table…' : 'Shuffling…'}</div>
        )}
        {/* s06: the cut card is out, so the next deal shuffles. Said before the
            bet, because that bet is graded at the fresh shoe's count of 0.
            Not while a count check is owed: it grades the count BEFORE the
            shuffle, so "count 0" above the keypad gave the wrong answer.
            Shown once it is answered, and the deal then waits for the bet. */}
        {game.roundNo > 0 &&
          (game.phase === 'idle' || game.phase === 'settled') &&
          game.shuffleDue &&
          !game.countCheckDue && (
          // Wave J: a back-counter who left walks to a new table's fresh shoe.
          game.newTableNext ? (
            <div className="message-cut-card" data-testid="new-table-cue">
              New table: the next hand is off a fresh shoe, count 0.
            </div>
          ) : (
            <div className="message-cut-card" data-testid="cut-card-cue">
              {/* Wave J (S4): every shoe starts with a back-counter watching. */}
              {game.backCountOn
                ? 'Cut card: the next shoe starts with you watching, count 0.'
                : 'Cut card: the next hand is off a fresh shoe, count 0.'}
            </div>
          )
        )}
        {botNarrationLines.map((line, i) => (
          <div key={i} className="message-bot-narration">
            {line}
          </div>
        ))}
        {game.phase === 'settled' && (
          <>
            {/* A settled round with no player hand is a wong-out (R5): the
                round played out (count/penetration advanced) but nothing was
                staked. Uniquely identifiable — every staked round has ≥1 hand,
                and the pre-round state is phase 'idle', never 'settled'. */}
            {game.hands.length === 0 && (
              <div className="message-result message-sat-out">
                {/* Wave J: at a back-count table an empty round is a watched one. */}
                {game.backCountOn ? 'Watching — no bet.' : 'Sat out — no bet.'}
              </div>
            )}
            {/* In order of play (#1): rightmost hand first, as "Hand 1". */}
            {game.hands
              .map((h, i) => ({ h, i }))
              .reverse()
              .map(({ h, i }) => {
                // B5/W5: result and both totals, so the reason for a loss
                // reads off the banner instead of off the felt. B2 #34: a
                // banner that wraps drops the dot instead of hanging it.
                const b = roundBanner(h, handPlayNumber(i, game.hands.length), multiHand, game.dealerCards, game.holeRevealed);
                return <RoundBannerLine key={i} banner={b} />;
              })}
            {game.insuranceNet !== null && (
              <div className="message-result">
                Insurance {formatSigned(game.insuranceNet)}
              </div>
            )}
          </>
        )}
        {/* G2: Foul from settlement until the next deal; a miss is said on the next round. */}
        <FoulCall game={game} onFoul={callFoul} />
      </div>

      {/* #40: the peek under the left thumb, just above the bar. The skip
          control shares the row, so the dock costs no height when it shows. */}
      <div className="peek-dock">
        {/* F9 / B2 #31: no peek while a count check is owed or open -- the
            peeked answer was graded correct. */}
        {!peekBlocked && (
        <PeekButton
          revealed={peeking}
          onReveal={revealPeek}
          onHide={hidePeek}
          dataTc={game.trueCountNow}
          readout={
            <>
              <span className="peek-counts">{peek.counts}</span>
              <span className="peek-depth">
                <span className="peek-sep"> · </span>
                {peek.depth}
              </span>
            </>
          }
        />
        )}
        {((hasBots && pacingPending) || dealAnimating) && (
          <button
            type="button"
            className="fast-forward-btn"
            aria-label="Skip ahead: finish dealing and other players' turns"
            onClick={skipEverything}
          >
            Skip
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
              <path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" fill="currentColor" />
            </svg>
          </button>
        )}
        {paceMs !== null && decisionKey !== null && (
          <DealerPaceBar limitMs={paceMs} restartKey={decisionKey} paused={modalOverHand} />
        )}
      </div>

      <ActionBar mode={barMode} />

      {game.phase === 'insurance' && (
        <BottomSheet title="Insurance?">
          <p>The dealer shows an ace. Take insurance?</p>
          <div className="bottom-sheet-actions">
            <button type="button" onClick={() => insure(true)}>
              Take
            </button>
            <button type="button" onClick={() => insure(false)}>
              Decline
            </button>
          </div>
        </BottomSheet>
      )}

      {game.countCheckOpen && (
        <BottomSheet title={countStage === 'rc' ? 'Running count?' : 'True count?'}>
          {/* C-R10c: the sheet is stuck to the bottom and covers the felt's
              round banner at 375x812, so the round's result is repeated here
              -- the hand just played is what the count is asked after. */}
          {game.phase === 'settled' && (
            <p className="count-sheet-banner" data-testid="count-sheet-banner">
              {game.hands.length === 0
                ? game.backCountOn
                  ? 'Watching — no bet.'
                  : 'Sat out — no bet.'
                : game.hands
                    .map((h, i) => ({ h, i }))
                    .reverse()
                    .map(({ h, i }) => {
                      const b = roundBanner(h, handPlayNumber(i, game.hands.length), multiHand, game.dealerCards, game.holeRevealed);
                      return `${b.head} · ${b.totals}`;
                    })
                    .join(' / ')}
            </p>
          )}
          {/* The spoken proposal, shown as well as said. A driver glancing
              at the screen at a light should be able to see what the app
              thinks it heard, and a passenger should be able to correct it
              by tapping instead of talking. */}
          {voiceOn && (
            <div className="count-voice" data-pending={pendingCount !== null}>
              {pendingCount === null ? (
                <span className="count-voice-hint">
                  Say the count, like &ldquo;minus three&rdquo;. Say &ldquo;plus&rdquo; or
                  &ldquo;minus&rdquo; to change it by one, then &ldquo;yes&rdquo; to submit.
                </span>
              ) : (
                <>
                  <span className="count-voice-value">{formatSigned(pendingCount)}</span>
                  <span className="count-voice-hint">
                    &ldquo;yes&rdquo; to submit &middot; &ldquo;no&rdquo; to start over &middot;
                    &ldquo;plus&rdquo; or &ldquo;minus&rdquo; to change by one
                  </span>
                </>
              )}
            </div>
          )}
          {/* The keypad stays. Voice is an addition, not a replacement: it
              has to survive a refused microphone, a passenger, and a browser
              that cannot listen at all. */}
          <NumPad
            key={countStage}
            label={countStage === 'rc' ? 'Enter running count' : 'Enter true count'}
            onSubmit={handleCountSubmit}
          />
        </BottomSheet>
      )}

      {overlay && (
        // Docked to the bottom rather than a centred Modal: the hands stay
        // visible above it and Continue lands in the thumb zone.
        <div
          className="modal-backdrop wrong-play-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Wrong play"
        >
          <div className="wrong-play-sheet">
          {/* Same panel the drills use, so a correction reads identically
              wherever it is earned -- the table and the flashcards were
              previously two different vocabularies for the same event. */}
          <MistakeCard
            taken={overlay.taken}
            expected={overlay.expected}
            variant="table"
            // E6: a basic error reads its chart region and the dealer's bust
            // chance; index errors keep the engine's index label.
            reason={playMissReason({
              reason: overlay.reason,
              classification: overlay.classification,
              cards: overlay.cards,
              dealerUp: overlay.dealerUp,
              canSplit: overlay.canSplit,
              rules: game.rules,
            })}
            tc={overlay.tc}
            hand={overlay.hand}
            classification={overlay.classification}
            onShowTable={() => setShowChart(true)}
          />
          {/* Dismissal stays the table's own Continue button rather than the
              panel's Next: at the table this closes an overlay and hands
              control back to a round already in progress, which is a
              different act from advancing to the next drill item. */}
          <button type="button" className="overlay-continue-btn" onClick={dismissOverlay}>
            Continue
          </button>
          </div>
        </div>
      )}

      {showChart && overlay && (
        <StudyChartOverlay
          activeProfile={activeProfile}
          cards={overlay.cards ?? null}
          dealerUp={overlay.dealerUp ?? null}
          // Snapshotted at grade time, NOT read from `legal` here: by now the
          // engine has applied the action, so `legal` describes a different
          // (or no) hand. See OverlayInfo.canSplit.
          canSplit={overlay.canSplit}
          graded={{ expected: overlay.expected, reason: overlay.reason, tc: overlay.tc }}
          onClose={() => setShowChart(false)}
        />
      )}
    </div>
  );
}
