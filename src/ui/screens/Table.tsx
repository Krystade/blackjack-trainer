import { useState } from 'react';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import type { PlayerHand } from '../../engine/game';
import type { Action } from '../../engine/deviations';
import type { PlayContext } from '../../engine/strategy';
import { correctPlay } from '../../engine/strategy';
import { useGame } from '../useGame';
import type { SessionReport } from '../useGame';
import { PlayingCard } from '../components/PlayingCard';
import { ActionBar } from '../components/ActionBar';
import type { ActionBarMode } from '../components/ActionBar';
import { Modal } from '../components/Modal';
import { NumPad } from '../components/NumPad';

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
  const { game, deal, act, insure, submitCount, overlay, dismissOverlay, report, endSession } = useGame(
    settings,
    activeProfile,
  );
  const [selectedBet, setSelectedBet] = useState(1);
  const [countStage, setCountStage] = useState<'rc' | 'tc'>('rc');
  const [pendingRc, setPendingRc] = useState(0);
  const [peeking, setPeeking] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const handleDeal = () => {
    deal(activeProfile.betSpreadOn ? selectedBet : undefined);
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
      selectedBet,
      onSelectBet: setSelectedBet,
      onDeal: handleDeal,
    };
  } else {
    barMode = { kind: 'hidden' };
  }

  const multiHand = game.hands.length > 1;

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

      <div className="hands-row">
        {game.hands.map((hand, i) => (
          <div
            key={i}
            className={`player-hand${i === game.active && game.phase === 'player' ? ' hand-active' : ''}`}
          >
            <div className="hand-cards">
              {hand.cards.map((c, j) => (
                <PlayingCard key={j} card={c} />
              ))}
            </div>
            <div className="hand-bet">Bet: {hand.bet}</div>
          </div>
        ))}
      </div>

      <div className="message-strip">
        {game.shuffledLastRound && <div className="message-shuffle">Shuffling…</div>}
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
