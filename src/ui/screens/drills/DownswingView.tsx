import { useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { Game } from '../../../engine/game';
import type { GameConfig, SeatConfig } from '../../../engine/game';
import type { PlayerHand } from '../../../engine/game';
import { makeDownswingShoe } from '../../../drills/downswingShoe';
import { PlayingCard } from '../../components/PlayingCard';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';

const ROUNDS = 25; // length of a downswing session (v1)
const SOLO_SEATS: SeatConfig = { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 };
const BET_CHIPS = [1, 2, 4, 8, 10, 12];

type Phase = 'bet' | 'play' | 'settled' | 'done';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * ET1 (docs/BACKLOG.md): the tilt-inoculation downswing session. Plays a rigged
 * run of REAL but reliably-losing hands (drills/downswingShoe.ts) with the bet
 * spread forced ON, so every bet is graded against your ramp. The count runs
 * negative, so the ramp calls for the MINIMUM bet — the discipline this trains
 * is holding that minimum and NOT chasing the losses. At the end it reports
 * spread-conformity: did you keep to your ramp through the drawdown? (Operator:
 * rigged real hands + spread-conformity grading only — no temptations/self-report.)
 */
export function DownswingView({
  settings,
  activeProfile,
  onBack,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
}) {
  const audio = useAudio(settings.audio);

  const gameRef = useRef<Game | null>(null);
  if (gameRef.current === null) {
    const cfg: GameConfig = {
      // High penetration on purpose: the rigged shoe is a fixed losing sequence
      // meant to be played to the end. A mid-session reshuffle would reset the
      // running count (desyncing the bet the player was shown from the count
      // their bet is graded against), so we push the cut card past where the
      // session ends — the shoe's built-in buffer guarantees no underflow.
      penetration: 0.99,
      betSpreadOn: true, // force the ramp on: bets are graded against it
      spread: activeProfile.spread,
      bankrollStart: activeProfile.bankrollStart,
      countCheckEvery: 0,
      rules: activeProfile.rules,
      seats: SOLO_SEATS,
    };
    gameRef.current = Game.withRiggedShoe(cfg, makeDownswingShoe(ROUNDS, randomSeed()));
  }
  const game = gameRef.current;

  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const [phase, setPhase] = useState<Phase>('bet');
  const [round, setRound] = useState(1);
  const [selectedBet, setSelectedBet] = useState(BET_CHIPS[0]);
  // Spread-conformity tally: how many of your bets matched the ramp for the count.
  const conformRef = useRef({ correct: 0, total: 0 });
  const startBankrollRef = useRef(game.bankroll);

  const deal = () => {
    const before = game.events.length;
    game.startRound(selectedBet);
    // The engine emits one 'bet' GradedEvent per staked hand when betSpreadOn.
    const betEvent = game.events.slice(before).find((e) => e.kind === 'bet');
    if (betEvent) {
      conformRef.current.total += 1;
      if (betEvent.correct) conformRef.current.correct += 1;
    }
    setPhase(game.phase === 'player' ? 'play' : 'settled');
    if (game.phase !== 'player') audio.ding('bad');
    bump();
  };

  const stand = () => {
    while (game.phase === 'player') game.act('stand');
    audio.ding('bad'); // it's a rigged loss
    setPhase('settled');
    bump();
  };

  const next = () => {
    if (round >= ROUNDS) {
      // V3-1: persist the completed session so it's visible on Stats (it used to
      // vanish on Back). One row per session: ramp-conformity + units lost.
      const c = conformRef.current;
      const stats = loadStats();
      saveStats({
        ...stats,
        downswing: {
          history: [
            ...stats.downswing.history,
            {
              date: new Date().toISOString(),
              correct: c.correct,
              total: c.total,
              drawdown: startBankrollRef.current - game.bankroll,
            },
          ],
        },
      });
      setPhase('done');
      return;
    }
    setRound((r) => r + 1);
    setPhase('bet');
    bump();
  };

  const activeHand: PlayerHand | undefined = game.hands[0];
  const drawdown = startBankrollRef.current - game.bankroll;
  const conform = conformRef.current;
  const conformPct = conform.total > 0 ? Math.round((conform.correct / conform.total) * 100) : 100;

  if (phase === 'done') {
    return (
      <div className="drill-screen">
        <div className="drill-topbar">
          <button type="button" className="drill-back-btn" onClick={onBack}>
            Back
          </button>
          <div className="drill-heading">Downswing</div>
        </div>
        <div className="drill-result">
          <div className={conformPct >= 90 ? 'result-correct' : 'result-wrong'}>
            {conformPct >= 90 ? 'You held your discipline.' : 'You broke from your ramp.'}
          </div>
          <div className="result-detail">
            Spread-conformity through the drawdown: <strong>{conformPct}%</strong> ({conform.correct}/
            {conform.total} bets matched your ramp).
          </div>
          <div className="result-detail">
            You rode out a {drawdown}-unit downswing over {ROUNDS} hands — through negative counts
            where the play was to bet the minimum, and positive counts where the ramp called for a big
            bet that lost anyway. The disciplined play was to keep betting your ramp for the count, the
            whole way down.
          </div>
          <button type="button" className="drill-back-btn" onClick={onBack}>
            Back to Drills
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Downswing</div>
      </div>

      <div className="downswing-hud">
        <span>
          Hand {round}/{ROUNDS}
        </span>
        <span className="downswing-count">TC {formatSigned(game.trueCountNow)}</span>
        <span className="downswing-bankroll">Bankroll {game.bankroll}</span>
        <span className={drawdown > 0 ? 'result-wrong' : ''}>−{drawdown}u</span>
      </div>

      {phase !== 'bet' && (
        <>
          <div className="dealer-area">
            {game.dealerCards.map((c, i) => (
              <PlayingCard key={i} card={c} faceDown={i === 1 && !game.holeRevealed} />
            ))}
          </div>
          <div className="hands-row">
            <div className="player-hand">
              <div className="hand-cards">
                {activeHand?.cards.map((c, i) => (
                  <PlayingCard key={i} card={c} />
                ))}
              </div>
              <div className="hand-bet">Bet: {activeHand?.bet}</div>
            </div>
          </div>
        </>
      )}

      <div className="message-strip">
        {phase === 'settled' && activeHand && (
          <div className="result-wrong">
            {activeHand.result === 'lose' ? `Lost ${Math.abs(activeHand.net ?? 0)}u` : String(activeHand.result)}
          </div>
        )}
      </div>

      {phase === 'bet' && (
        <div className="action-bar action-bar-bet">
          <div className="settings-row settings-note-row">
            Bet your ramp for the count (shown above) — hold it through the losses; don’t chase, don’t
            shrink from a big bet at a good count.
          </div>
          <div className="bet-chips">
            {BET_CHIPS.map((units) => (
              <button
                key={units}
                type="button"
                className={`chip-btn${selectedBet === units ? ' chip-selected' : ''}`}
                onClick={() => setSelectedBet(units)}
              >
                {units}
              </button>
            ))}
          </div>
          <button type="button" className="deal-btn" onClick={deal}>
            Deal
          </button>
        </div>
      )}

      {phase === 'play' && (
        <div className="action-bar">
          <button type="button" className="action-btn" onClick={stand}>
            Stand
          </button>
        </div>
      )}

      {phase === 'settled' && (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={next}>
            {round >= ROUNDS ? 'See result' : 'Next hand'}
          </button>
        </div>
      )}
    </div>
  );
}
