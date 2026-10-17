import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import {
  makePairCancel,
  isCancellingPair,
  pairCancelBias,
  pairResultText,
  PAIR_CANCEL_NETS,
} from '../../../drills/pairCancellation';
import type { PairCancelRound } from '../../../drills/pairCancellation';
import { PlayingCard } from '../../components/PlayingCard';
import { cardJitter, jitterTransform } from '../../../drills/cardJitter';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';
import { focusSwallowsKey } from '../../keyboardFocus';
import { ResultStrip } from '../../components/ResultStrip';
import { releaseAnswerFocus } from '../../handResult';
import { answerTooSoon } from '../../answerBounce';
import { signed } from '../../../drills/signed';
import './pairCancelStrip.css';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Wave A: a real minus sign (U+2212). */
function formatSigned(n: number): string {
  return signed(n);
}

/**
 * R8 / TS#6 (docs/BACKLOG.md): the pair-cancellation drill. Two cards are shown
 * at once and the user picks their NET Hi-Lo tag (-2..+2) — training the
 * expert habit of reading a pair as one recognized chunk (a +1 low and a -1
 * high "cancel" to 0 and are skipped) rather than adding each card serially.
 * Deliberately VISUAL-ONLY (no eyes-free): the whole point is gestalt pair
 * recognition, which serial audio would defeat (see the red-team's item 10).
 * Continuous flow for rapid reps (#21): an answer deals the next pair at once,
 * and a one-line strip under it says how the last one went. No Next tap, no
 * Enter.
 */
export function PairCancelView({ settings, onBack }: { settings: Settings; onBack: () => void }) {
  const audio = useAudio(settings.audio);
  // TS#6 content-weighting: oversample genuine cancelling pairs early (the
  // canonical chunk a random draw under-represents), decaying toward the
  // natural distribution as the session progresses (see pairCancelBias).
  const roundIndexRef = useRef(0);
  const [round, setRound] = useState<PairCancelRound>(() =>
    makePairCancel(randomSeed(), pairCancelBias(0)),
  );
  // #21: the answered pair, frozen, shown under the next one. `id` restarts
  // the strip's fade even when two answers in a row read the same.
  const [last, setLast] = useState<{ id: number; cards: PairCancelRound['cards']; correct: boolean; text: string } | null>(
    null,
  );
  // R1-style latency: prompt-shown → answered, captured in the component (never
  // a pure helper) so telemetry can track chunk-recognition speed over time.
  const shownAtRef = useRef(performance.now());

  const answer = (guess: number) => {
    // Review fix (c): a bounced double tap would grade a pair nobody saw.
    if (answerTooSoon(shownAtRef.current)) return;
    const correct = guess === round.net;
    const elapsedMs = performance.now() - shownAtRef.current;
    audio.ding(correct ? 'good' : 'bad');

    const stats = loadStats();
    saveStats({
      ...stats,
      pairCancel: {
        history: [
          ...stats.pairCancel.history,
          {
            date: new Date().toISOString(),
            net: round.net,
            guess,
            correct,
            cancelling: isCancellingPair(round),
            elapsedMs,
          },
        ],
      },
    });

    setLast((prev) => ({
      id: (prev?.id ?? 0) + 1,
      cards: round.cards,
      correct,
      text: pairResultText(round.net, guess, isCancellingPair(round)),
    }));
    // The answer buttons stay put for the next pair, so a focused one would
    // turn a stray Enter into an answer on a pair not yet looked at.
    releaseAnswerFocus();
    next();
  };

  const next = () => {
    roundIndexRef.current += 1;
    setRound(makePairCancel(randomSeed(), pairCancelBias(roundIndexRef.current)));
    shownAtRef.current = performance.now();
  };

  // Keyboard: 1–5 map to the five nets in ascending order (1 → −2 … 5 → +2).
  // Skipped while a native input has focus (none here, but consistent with
  // the other drills).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;
      const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
      if (idx >= 0) {
        e.preventDefault();
        answer(PAIR_CANCEL_NETS[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Pair cancellation</div>
      </div>

      <div className="settings-row settings-note-row">
        Read both cards as one: what do they add to the running count?
      </div>

      <div className="pair-cancel-cards">
        {round.cards.map((c, i) => {
          if (!settings.drill.messyCards) return <PlayingCard key={i} card={c} />;
          // R9: seed the jitter deterministically from the pair itself so it's
          // stable while shown and changes with each new pair — no stored seed.
          const jitterSeed = round.cards.reduce(
            (h, card) => (h * 31 + card.rank.charCodeAt(0) + card.suit.charCodeAt(0)) >>> 0,
            7,
          );
          return (
            <span
              key={i}
              className="messy-card"
              style={{ display: 'inline-block', transform: jitterTransform(cardJitter(jitterSeed, i)) }}
            >
              <PlayingCard card={c} />
            </span>
          );
        })}
      </div>

      <div className="message-strip">
        {last && (
          <ResultStrip id={last.id} tone={last.correct ? 'ok' : 'miss'}>
            <div className="pair-result" data-testid="pair-result">
              <span className="pair-result-hand">{last.cards.map((c) => c.rank).join(',')}</span>
              <span className={last.correct ? 'result-correct' : 'result-wrong'}>{last.text}</span>
            </div>
          </ResultStrip>
        )}
      </div>

      <div className="action-bar pair-cancel-answers">
        {PAIR_CANCEL_NETS.map((net) => (
          <button key={net} type="button" className="action-btn" onClick={() => answer(net)}>
            {formatSigned(net)}
          </button>
        ))}
      </div>
    </div>
  );
}
