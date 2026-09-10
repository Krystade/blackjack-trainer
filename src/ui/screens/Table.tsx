import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { DealSlot, Game, PlayerHand, Seat } from '../../engine/game';
import type { Action } from '../../engine/deviations';
import type { PlayContext } from '../../engine/strategy';
import { correctPlay } from '../../engine/strategy';
import { isBust } from '../../engine/hand';
import { useGame } from '../useGame';
import type { SessionReport } from '../useGame';
import { useAudio } from '../../audio/useAudio';
import { useVoiceControl } from '../useVoiceControl';
import {
  detectVoiceSupport,
  VOICE_ACTIONS,
  matchSpokenAlternatives,
} from '../../audio/voiceRecognition';
import { parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../audio/voiceNumber';
import type { VoiceAction } from '../../audio/voiceRecognition';
import type { ListenState, HeardVerdict } from '../../audio/voiceControl';
import { actionUnavailable } from '../../drills/answerGate';
import { enableAudioNow } from '../audioGate';
import { PlayingCard, formatCard } from '../components/PlayingCard';
import { ActionBar } from '../components/ActionBar';
import type { ActionBarMode } from '../components/ActionBar';
import { Modal } from '../components/Modal';
import { MistakeCard } from '../components/MistakeCard';
import { StudyChartOverlay } from '../components/StudyChartOverlay';
import { NumPad } from '../components/NumPad';
import { assistedFlag } from '../peekFlag';

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
const VOICE_STATE_LABEL: Record<ListenState, string> = {
  off: 'Voice off',
  starting: 'Starting…',
  listening: 'Listening',
  // Named rather than hidden: a word spoken during a restart is genuinely
  // lost, and claiming to be listening throughout would be a lie.
  restarting: 'Reconnecting…',
  denied: 'Microphone blocked — allow it in your browser',
  unsupported: 'This browser cannot listen',
  error: 'No response from the microphone — switch it off and on',
};

const VOICE_WORDS = Object.keys(VOICE_ACTIONS).join(' · ');

function describeVerdict(verdict: HeardVerdict | null): string {
  if (verdict === null) return '';
  if (verdict === 'rejected') return 'not a command';
  // Distinct from "not a command": it means the microphone heard the APP, so
  // the answer is to wait rather than to repeat yourself louder.
  if (verdict === 'suppressed') return 'ignored (the app was speaking)';
  return verdict;
}

function isE2E(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('e2e') === '1';
}

function resultMessage(hand: PlayerHand, idx: number, multi: boolean): string {
  const prefix = multi ? `Hand ${idx + 1}: ` : '';
  switch (hand.result) {
    case 'win':
      return `${prefix}Win +${hand.net}`;
    case 'lose':
      return `${prefix}Lose ${hand.net}`;
    case 'push':
      return `${prefix}Push`;
    case 'blackjack':
      return `${prefix}Blackjack! +${hand.net}`;
    case 'surrender':
      return `${prefix}Surrender ${hand.net}`;
    default:
      return '';
  }
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function ReportScreen({ report, onDone }: { report: SessionReport; onDone: () => void }) {
  // R7 (docs/BACKLOG.md): this screen only shows in TEST mode (see handleEnd),
  // so a peek-assisted session's accuracy is flagged right under the headline
  // number it qualifies — the number can't be mistaken for unassisted.
  const assisted = assistedFlag(report.peeks);
  return (
    <div className="report-screen">
      <h1>Session Report</h1>
      <p className="report-summary">
        {report.correct} / {report.graded} correct &middot; bankroll {formatSigned(report.bankrollDelta)}
      </p>
      {assisted && <p className="report-assisted">{assisted}</p>}
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
              <td>{c.category}</td>
              <td>{c.right}</td>
              <td>{c.wrong}</td>
              <td>{Math.round(c.accuracy * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Mistakes</h2>
      {report.mistakes.length === 0 ? (
        <p>No mistakes this session.</p>
      ) : (
        <ul className="report-mistakes">
          {report.mistakes.map((m, i) => (
            <li key={i}>
              {m.hand ?? m.kind} &middot; TC {formatSigned(m.tc)} &middot; took {m.taken} &middot; correct {m.expected}
              {' — '}
              {m.reason}
            </li>
          ))}
        </ul>
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
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceSupported] = useState(() => detectVoiceSupport().api);
  // A spoken count is a PROPOSAL until it is read back and confirmed. Holding
  // it here rather than submitting on hearing it is the whole reason numbers
  // are safe to say out loud: a misheard digit costs one "no", not a
  // corrupted session.
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const {
    game,
    deal,
    act,
    insure,
    submitCount,
    overlay,
    dismissOverlay,
    report,
    endSession,
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
  // rebuilds the seat.
  const playerHandsCount = activeProfile.seats.playerHands;
  const [selectedBets, setSelectedBets] = useState<number[]>(() => new Array(playerHandsCount).fill(1));
  const setBetForHand = (i: number, units: number) => {
    setSelectedBets((prev) => prev.map((v, idx) => (idx === i ? units : v)));
  };
  const [countStage, setCountStage] = useState<'rc' | 'tc'>('rc');
  const [pendingRc, setPendingRc] = useState(0);
  const [peeking, setPeeking] = useState(false);
  const [showReport, setShowReport] = useState(false);
  // #7: the strategy chart opened over a wrong play, ringed on its cell.
  const [showChart, setShowChart] = useState(false);

  // R7 (docs/BACKLOG.md, count-peek accountability): tally each peek-button
  // activation so the session report / Stats can flag a peek-assisted accuracy.
  // The button fires BOTH onTouchStart and (synthesized) onMouseDown for a
  // single tap on touch devices, so a naive per-handler increment would
  // double-count. `peekingRef` mirrors the `peeking` state synchronously and is
  // the rising-edge guard: only the press that transitions hidden->revealed
  // increments; the trailing synthesized event finds the ref already true and
  // is a no-op. A genuinely separate peek requires a release (mouseup/
  // touchend/mouseleave clears the ref) in between, so it counts as a new one.
  const [peeks, setPeeks] = useState(0);
  /**
   * TOGGLE, not press-and-hold (operator request). Holding a button steady
   * while reading two numbers is awkward one-handed and impossible while the
   * hand is doing anything else, so a tap now latches the readout on and a
   * second tap clears it.
   *
   * This also deletes a whole class of bug rather than working around it. The
   * hold version had to dedup input: a single tap on a phone produced
   * touchstart -> touchend -> synthesized mousedown, which double-counted every
   * peek, and the fix was to move to pointer events (one per physical
   * interaction). A click handler fires exactly once by construction, so no
   * rising-edge guard and no ref mirror are needed at all.
   *
   * R7 accountability is preserved and arguably sharpened: one increment per
   * REVEAL. Turning the readout off is not a peek, so a peek still means
   * "a moment the operator chose to be shown the count".
   */
  const togglePeek = () => {
    // The increment is deliberately OUTSIDE the setPeeking updater. Nesting it
    // there double-counted every reveal: React invokes state updaters twice in
    // StrictMode to surface impure ones, so a side effect inside the updater
    // ran twice per tap and the assisted-session flag overstated every peek.
    // Updaters must be pure; this reads the rendered value instead, which a
    // click handler can rely on.
    if (!peeking) setPeeks((n) => n + 1);
    setPeeking((on) => !on);
  };

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
    if (game.countCheckDue) return;

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
      act(command);
      // Move the recogniser's restart gap into the pause after the action,
      // while the correction is being spoken, rather than leaving it to fall
      // in the middle of the next decision.
      voice.cycleIfStale();
      return;
    }

    // Between rounds. "Yes" deals the next hand, so a whole shoe can be
    // played without touching the screen.
    if ((game.phase === 'idle' || game.phase === 'settled') && command === 'yes') {
      handleDeal();
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
    if (!game.countCheckDue) return null;

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
      audio.say(`${speakableCount(next)}. Correct?`);
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
            : `${speakableCount(pendingCount)}. Correct?`,
        );
        return 'repeated';
      default:
        return 'not a count';
    }
  };

  const voice = useVoiceControl({
    enabled: voiceOn,
    onAction: handleVoiceCommand,
    onTranscript: interpretCountSpeech,
    // Biased toward the commands AND the count words at once. The phrase list
    // is fixed for the life of a session, and rebuilding the recogniser as
    // the prompt opens would cost a deaf gap exactly when an answer is due.
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    context: 'table',
  });

  const handleDeal = () => {
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

  const countPromptText = (): string =>
    countStage === 'rc' ? 'Running count?' : 'True count?';

  // Ask out loud when the prompt appears, and again if it moves on to the
  // true count. Without this the app simply goes quiet mid-drive and the
  // round looks frozen: the modal is the only thing saying an answer is due.
  const countDue = game.countCheckDue;
  useEffect(() => {
    if (!voiceOn || !countDue) return;
    audio.say(countPromptText());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, countDue, countStage]);

  // A proposal belongs to one prompt. Carrying it across would offer the
  // running count back as an answer to the true-count question.
  useEffect(() => {
    setPendingCount(null);
  }, [countDue, countStage]);

  const handleCountSubmit = (n: number) => {
    if (game.askTcToo && countStage === 'rc') {
      setPendingRc(n);
      setCountStage('tc');
      return;
    }
    if (game.askTcToo) {
      submitCount(pendingRc, n);
    } else {
      submitCount(n);
    }
    setCountStage('rc');
  };

  const handleEnd = () => {
    endSession(peeks);
    if (settings.feedbackMode === 'test') {
      setShowReport(true);
    } else {
      onNavigate('home');
    }
  };

  const handleReportDone = () => {
    setShowReport(false);
    onNavigate('home');
  };

  if (showReport && report) {
    return <ReportScreen report={report} onDone={handleReportDone} />;
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
    advice = correctPlay(activeHand.cards, game.dealerCards[0].rank, game.trueCountNow, ctx, activeProfile.rules).action;
  }

  let barMode: ActionBarMode;
  if (game.phase === 'player') {
    barMode = { kind: 'actions', legal, onAction: act, advice };
  } else if ((game.phase === 'idle' || game.phase === 'settled') && !game.countCheckDue) {
    barMode = {
      kind: 'bet',
      betSpreadOn: activeProfile.betSpreadOn,
      hands: selectedBets.map((units, i) => ({
        selectedBet: units,
        onSelectBet: (u: number) => setBetForHand(i, u),
      })),
      onDeal: handleDeal,
      // Wong-out only makes sense against a spread (the same gate the engine
      // uses to grade it); a flat-bet table hides the Sit Out button entirely.
      onSitOut: activeProfile.betSpreadOn ? handleSitOut : undefined,
    };
  } else {
    barMode = { kind: 'hidden' };
  }

  const multiHand = game.hands.length > 1;

  // Cycle-2 Task 6: bot seats/narration/fast-forward are a strict no-op when
  // the profile has no bots (v1-solo parity — `game.seats` holds just the
  // player seat and `botActionLog` is always empty, so every value below is
  // empty/false and nothing extra renders).
  const botSeats = game.seats.filter((s) => s.kind === 'bot');
  const hasBots = botSeats.length > 0;
  const botLabels = botSeatLabels(game.seats);
  const botNarrationLines = buildBotNarration(game, botNarrationRevealed);
  const pacingPending = botNarrationRevealed < game.botActionLog.length;
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
    <div className="table-screen" style={{ ['--deal-speed']: `${settings.dealSpeedMs}ms` } as CSSProperties}>
      <div className="topbar">
        <div className="topbar-stat">
          Bankroll: {game.bankroll}
          <span className="topbar-profile-name" style={{ marginLeft: 6, fontSize: '0.7em', opacity: 0.65 }}>
            {activeProfile.name}
          </span>
        </div>
        <div className="topbar-stat">Round {game.roundNo}</div>
        {settings.countPeek && (
          <button
            type="button"
            className="tc-peek-btn"
            // A plain click: see togglePeek for why this replaced the
            // pointer-event hold, and why it needs no dedup.
            aria-pressed={peeking}
            onClick={togglePeek}
          >
            {peeking ? `RC ${formatSigned(game.runningCount)} / TC ${formatSigned(game.trueCountNow)}` : 'TC'}
          </button>
        )}
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
        <button type="button" className="end-btn" onClick={handleEnd}>
          End
        </button>
      </div>

      {voiceOn && (
        <div className="voice-status" data-voice-state={voice.status.state}>
          <span className="voice-status-state">{VOICE_STATE_LABEL[voice.status.state]}</span>
          {voice.status.heard && (
            <span className="voice-status-heard">
              &ldquo;{voice.status.heard}&rdquo; &rarr; {describeVerdict(voice.status.verdict)}
            </span>
          )}
          <span className="voice-status-words">
            Say: {VOICE_WORDS} &mdash; &ldquo;yes&rdquo; deals the next hand and answers insurance
          </span>
        </div>
      )}

      {/* R6 (docs/BACKLOG.md, RT#3): a live discard-tray depth cue. Real tables
          have a visible tray; without one, the table's TC checks give no
          referent to ESTIMATE decks-remaining from, stranding the deck-
          estimation drill as an island. Shows only the fill (deliberately NO
          exact number) so the count-check still requires a real by-eye
          estimate — connecting that drill to its point of use. */}
      {(() => {
        const dealt = game.shoe.cardsDealt;
        const totalCards = activeProfile.rules.decks * 52;
        const fillPct = Math.min(98, Math.max(1, (dealt / totalCards) * 100));
        return (
          <div className="table-discard-tray" aria-label="Discard tray">
            <span className="table-discard-label">Discard</span>
            <div className="table-discard-frame">
              <div className="table-discard-fill" style={{ width: `${fillPct}%` }} />
            </div>
          </div>
        );
      })()}

      <div className="dealer-area">
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
                      {hand.cards.map((c, j) => (
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
                    {game.phase === 'settled' && resultLetter(hand.result) && (
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

      <div className="hands-row">
        {game.hands.map((hand, i) => (
          <div
            key={i}
            className={`player-hand${i === game.active && game.phase === 'player' ? ' hand-active' : ''}`}
          >
            {playerHandsCount > 1 && <div className="hand-label">Hand {i + 1}</div>}
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
            <div className="hand-bet">Bet: {hand.bet}</div>
          </div>
        ))}
      </div>

      <div
        className="message-strip"
        onClick={hasBots || dealAnimating ? skipEverything : undefined}
      >
        {game.shuffledLastRound && <div className="message-shuffle">Shuffling…</div>}
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
              <div className="message-result message-sat-out">Sat out — no bet.</div>
            )}
            {game.hands.map((h, i) => (
              <div key={i} className="message-result">
                {resultMessage(h, i, multiHand)}
              </div>
            ))}
            {game.insuranceNet !== null && (
              <div className="message-result">
                Insurance {formatSigned(game.insuranceNet)}
              </div>
            )}
          </>
        )}
      </div>

      {((hasBots && pacingPending) || dealAnimating) && (
        <button
          type="button"
          className="fast-forward-btn"
          aria-label="Fast-forward bot actions and dealing"
          onClick={skipEverything}
        >
          ⏩
        </button>
      )}

      <ActionBar mode={barMode} />

      {game.phase === 'insurance' && (
        <Modal title="Insurance?">
          <p>Dealer shows an Ace. Take insurance?</p>
          <div className="modal-actions">
            <button type="button" onClick={() => insure(true)}>
              Take
            </button>
            <button type="button" onClick={() => insure(false)}>
              Decline
            </button>
          </div>
        </Modal>
      )}

      {game.countCheckDue && (
        <Modal title={countStage === 'rc' ? 'Running Count?' : 'True Count?'}>
          {/* The spoken proposal, shown as well as said. A driver glancing
              at the screen at a light should be able to see what the app
              thinks it heard, and a passenger should be able to correct it
              by tapping instead of talking. */}
          {voiceOn && (
            <div className="count-voice" data-pending={pendingCount !== null}>
              {pendingCount === null ? (
                <span className="count-voice-hint">
                  Say the count &mdash; &ldquo;minus three&rdquo;. Then &ldquo;plus&rdquo; or
                  &ldquo;minus&rdquo; to nudge it by one, &ldquo;yes&rdquo; to submit.
                </span>
              ) : (
                <>
                  <span className="count-voice-value">{formatSigned(pendingCount)}</span>
                  <span className="count-voice-hint">
                    &ldquo;yes&rdquo; to submit &middot; &ldquo;no&rdquo; to start over &middot;
                    &ldquo;plus&rdquo;/&ldquo;minus&rdquo; to nudge
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
        </Modal>
      )}

      {overlay && (
        <Modal title="Wrong Play">
          {/* Same panel the drills use, so a correction reads identically
              wherever it is earned -- the table and the flashcards were
              previously two different vocabularies for the same event. */}
          <MistakeCard
            taken={overlay.taken}
            expected={overlay.expected}
            reason={overlay.reason}
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
        </Modal>
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
          onClose={() => setShowChart(false)}
        />
      )}
    </div>
  );
}
