import { useState } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { Game, PlayerHand, Seat } from '../../engine/game';
import type { Action } from '../../engine/deviations';
import type { PlayContext } from '../../engine/strategy';
import { correctPlay } from '../../engine/strategy';
import { isBust } from '../../engine/hand';
import { useGame } from '../useGame';
import type { SessionReport } from '../useGame';
import { PlayingCard, formatCard } from '../components/PlayingCard';
import { ActionBar } from '../components/ActionBar';
import type { ActionBarMode } from '../components/ActionBar';
import { Modal } from '../components/Modal';
import { NumPad } from '../components/NumPad';

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
  return (
    <div className="report-screen">
      <h1>Session Report</h1>
      <p className="report-summary">
        {report.correct} / {report.graded} correct &middot; bankroll {formatSigned(report.bankrollDelta)}
      </p>
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

export function Table({ settings, activeProfile, onNavigate }: TableProps) {
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
  } = useGame(settings, activeProfile);
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

  // `deal` (from useGame) is typed as (betUnits?: number) => void, mirroring
  // the engine's v1/solo scalar path; `game.startRound` underneath also
  // accepts a per-hand `number[]` (Cycle-2 Task 4). Widening the call here
  // (rather than useGame.ts's exported type) keeps this task's edits inside
  // Table.tsx/ActionBar.tsx/app.css only.
  const dealMulti = deal as unknown as (bets?: number | number[]) => void;

  const handleDeal = () => {
    if (playerHandsCount > 1) {
      dealMulti(activeProfile.betSpreadOn ? selectedBets : undefined);
    } else {
      deal(activeProfile.betSpreadOn ? selectedBets[0] : undefined);
    }
    setCountStage('rc');
  };

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
    endSession();
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

  return (
    <div className="table-screen">
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
            onMouseDown={() => setPeeking(true)}
            onMouseUp={() => setPeeking(false)}
            onMouseLeave={() => setPeeking(false)}
            onTouchStart={() => setPeeking(true)}
            onTouchEnd={() => setPeeking(false)}
          >
            {peeking ? `RC ${formatSigned(game.runningCount)} / TC ${formatSigned(game.trueCountNow)}` : 'TC'}
          </button>
        )}
        <button type="button" className="end-btn" onClick={handleEnd}>
          End
        </button>
      </div>

      <div className="dealer-area">
        {game.dealerCards.map((c, i) => (
          <PlayingCard key={i} card={c} faceDown={i === 1 && !game.holeRevealed} />
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
                        <PlayingCard key={j} card={c} size="compact" />
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
                <PlayingCard key={j} card={c} />
              ))}
            </div>
            <div className="hand-bet">Bet: {hand.bet}</div>
          </div>
        ))}
      </div>

      <div
        className="message-strip"
        onClick={hasBots ? fastForwardNarration : undefined}
      >
        {game.shuffledLastRound && <div className="message-shuffle">Shuffling…</div>}
        {botNarrationLines.map((line, i) => (
          <div key={i} className="message-bot-narration">
            {line}
          </div>
        ))}
        {game.phase === 'settled' && (
          <>
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

      {hasBots && pacingPending && (
        <button
          type="button"
          className="fast-forward-btn"
          aria-label="Fast-forward bot actions"
          onClick={fastForwardNarration}
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
          <NumPad
            key={countStage}
            label={countStage === 'rc' ? 'Enter running count' : 'Enter true count'}
            onSubmit={handleCountSubmit}
          />
        </Modal>
      )}

      {overlay && (
        <Modal title="Wrong Play">
          <p>
            You: {overlay.taken.toUpperCase()} — Correct: {overlay.expected.toUpperCase()}
          </p>
          <p>{overlay.reason}</p>
          <p>(TC was {formatSigned(overlay.tc)})</p>
          <button type="button" className="overlay-continue-btn" onClick={dismissOverlay}>
            Continue
          </button>
        </Modal>
      )}
    </div>
  );
}
