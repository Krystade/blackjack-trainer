import { useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { Game } from '../../../engine/game';
import type { GameConfig, SeatConfig } from '../../../engine/game';
import type { PlayerHand } from '../../../engine/game';
import { buildDownswingScript } from '../../../drills/downswingShoe';
import type { Action } from '../../../engine/deviations';
import { handValue } from '../../../engine/hand';
import { PlayingCard } from '../../components/PlayingCard';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';

const ROUNDS = 25; // length of a downswing session (v1)
const SOLO_SEATS: SeatConfig = { bots: 0, playerHands: 1, playerPosition: 0, botMistakePct: 0 };

/** V3-1c: the selectable bets are the profile's OWN ramp units (deduped, sorted),
 * not a hardcoded set — so the chips match the spread the bets are graded against. */
function betChipsFor(spread: { units: number }[]): number[] {
  const units = [...new Set(spread.map((r) => r.units))].filter((u) => u > 0).sort((a, b) => a - b);
  return units.length > 0 ? units : [1];
}

type Phase = 'bet' | 'play' | 'settled' | 'done';

const ACTION_LABEL: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * ET1 (docs/BACKLOG.md): the tilt-inoculation downswing session. Plays a rigged
 * run of REAL but reliably-losing hands (drills/downswingShoe.ts) with the bet
 * spread forced ON, so every bet is graded against your ramp. The count runs
 * negative, so the ramp calls for the MINIMUM bet — the discipline this trains
 * is holding that minimum and NOT chasing the losses. At the end it reports
 * spread-conformity: did you keep to your ramp through the drawdown? (Operator:
 * rigged real hands + spread-conformity grading only — no temptations/self-report.)
 *
 * V3-7: the PLAY is graded too now. It used to be a stand-only wall — every
 * hand was a made 17-19, so the only button was Stand and tilt had nothing to
 * corrupt but the bet. Chasing is not only a betting behaviour; it is hitting a
 * stiff you should stand and doubling to get it all back in one hand. The rig's
 * decision hands (downswingShoe.ts's DECISION_LOSSES) lose down every line, so
 * playing them correctly is rewarded with a loss — which is the point.
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
  // Where each scripted round ends, in cards dealt. See the realignment in
  // `next()` -- without it one off-script line turns every later hand into the
  // previous hand's leftovers.
  const scriptRef = useRef<number[]>([]);
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
    const built = buildDownswingScript(ROUNDS, randomSeed());
    scriptRef.current = built.boundaries;
    gameRef.current = Game.withRiggedShoe(cfg, built.cards);
  }
  const game = gameRef.current;

  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const betChips = betChipsFor(activeProfile.spread);
  const [phase, setPhase] = useState<Phase>('bet');
  const [round, setRound] = useState(1);
  const [selectedBet, setSelectedBet] = useState(betChips[0]);
  // Spread-conformity tally: how many of your bets matched the ramp for the count.
  const conformRef = useRef({ correct: 0, total: 0 });
  // V3-7: the same tally for the PLAY. Only hands that offered a real decision
  // count -- a made 17 where Stand is the only sane button is not evidence of
  // discipline, and padding the denominator with them would let a session look
  // composed because most of its hands could not be got wrong.
  const playRef = useRef({ correct: 0, total: 0 });
  const [lastPlay, setLastPlay] = useState<{ taken: string; expected: string } | null>(null);
  const startBankrollRef = useRef(game.bankroll);

  const deal = () => {
    setLastPlay(null);
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

  /**
   * Play the hand out with `action`, then read the engine's own verdict on it.
   *
   * Grading is not re-derived here. The engine already emits a GradedEvent per
   * action carrying `correct` and what it expected -- the same verdict table
   * play is scored against, deviations and all -- and a second opinion computed
   * in a drill view is a second thing to keep in sync with the charts.
   */
  const play = (action: Action) => {
    // Measured BEFORE the action, because afterwards the hand has an extra
    // card and a different total.
    //
    // A STIFF is what counts as a decision here, not "more than one legal
    // button" -- hit, stand, double and surrender are all legal on any two-card
    // hand, so that test is true even on a made 19 and would mark the whole
    // session as decisions. It is the 12-16 range where the answer is genuinely
    // uncomfortable and where tilt actually shows up; grading the pat hands
    // alongside them would let a wall of forced Stands read as discipline.
    const cards = game.hands[0]?.cards ?? [];
    const wasDecision = cards.length > 0 && handValue(cards).total < 17;
    const before = game.events.length;

    game.act(action);
    // Anything still live rides on stand: the rig's decision hands are one card
    // from resolved down every line, and this drill grades the DECISION rather
    // than a multi-card play-out.
    while (game.phase === 'player') game.act('stand');

    if (wasDecision) {
      const graded = game.events.slice(before).find((e) => e.kind === 'action');
      if (graded) {
        playRef.current.total += 1;
        if (graded.correct) playRef.current.correct += 1;
        else setLastPlay({ taken: graded.taken, expected: graded.expected });
      }
    }

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
              // Omitted rather than zeroed when the rig dealt no decisions, so
              // Stats can tell "played nothing wrong" from "had nothing to get
              // wrong" -- see the field's own note in store/types.ts.
              ...(playRef.current.total === 0
                ? {}
                : { playCorrect: playRef.current.correct, playTotal: playRef.current.total }),
            },
          ],
        },
      });
      setPhase('done');
      return;
    }
    // V3-7: REALIGN THE SCRIPT.
    // Each scripted round costs a fixed number of cards down every line basic
    // strategy can take, but a player is free to take another one (surrender
    // ends a decision hand a card early). Skip forward to the next round
    // boundary at or after what was actually dealt, binning the difference
    // unseen, so the next hand starts on its own first card instead of on the
    // tail of this one.
    const dealt = game.shoe.cardsDealt;
    const nextBoundary = scriptRef.current.find((b) => b >= dealt);
    if (nextBoundary !== undefined && nextBoundary > dealt) {
      game.discardRiggedCards(nextBoundary - dealt);
    }

    setRound((r) => r + 1);
    setPhase('bet');
    setLastPlay(null);
    bump();
  };

  const activeHand: PlayerHand | undefined = game.hands[0];
  const drawdown = startBankrollRef.current - game.bankroll;
  const conform = conformRef.current;
  const conformPct = conform.total > 0 ? Math.round((conform.correct / conform.total) * 100) : 100;
  const playTally = playRef.current;
  const playPct =
    playTally.total > 0 ? Math.round((playTally.correct / playTally.total) * 100) : null;

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
          <div
            className={
              conformPct >= 90 && (playPct === null || playPct >= 90)
                ? 'result-correct'
                : 'result-wrong'
            }
          >
            {conformPct < 90
              ? 'You broke from your ramp.'
              : playPct !== null && playPct < 90
                ? 'You held your ramp, but not your play.'
                : 'You held your discipline.'}
          </div>
          <div className="result-detail">
            Spread-conformity through the drawdown: <strong>{conformPct}%</strong> ({conform.correct}/
            {conform.total} bets matched your ramp).
          </div>
          {/*
            V3-7: the two halves of tilt, reported apart. Chasing with the bet
            and chasing with the play are different failures with different
            fixes, and one blended score would let a player who kept their ramp
            perfectly while hitting every stiff read as disciplined.
          */}
          <div className="result-detail downswing-play-score">
            Correct play under pressure:{' '}
            {playPct === null ? (
              <strong>no decisions dealt</strong>
            ) : (
              <>
                <strong>{playPct}%</strong> ({playTally.correct}/{playTally.total} stiff hands
                played correctly)
              </>
            )}
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
        {/*
          Named on the hand it happened on. A play score revealed only at the
          end would tell a player they tilted without telling them where, and
          the whole value of a rigged run is that the hand is still on screen.
        */}
        {lastPlay && (
          <div className="result-wrong">
            You played {lastPlay.taken} — the correct play was {lastPlay.expected}.
          </div>
        )}
        {phase === 'settled' && activeHand && (
          <div className="result-wrong">
            {activeHand.result === 'lose' ? `Lost ${Math.abs(activeHand.net ?? 0)}u` : String(activeHand.result)}
          </div>
        )}
      </div>

      {phase === 'bet' && (
        <div className="action-bar action-bar-bet">
          <div className="settings-row settings-note-row">
            Keep your own count through the losses and bet your ramp for it — the count is NOT shown.
            Don’t chase, and don’t shrink from a big bet at a good count.
          </div>
          <div className="bet-chips">
            {betChips.map((units) => (
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
          {/*
            Every action the hand legally offers, not just Stand. The drill used
            to render one button because every hand was a made 17-19; a stiff
            hand with only a Stand button would be telling the player what to do
            on the exact decision the session exists to test.
          */}
          {game.legalActions().map((action) => (
            <button
              key={action}
              type="button"
              className="action-btn"
              onClick={() => play(action)}
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
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
