import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import {
  makePairCancel,
  isCancellingPair,
  pairCancelBias,
  PAIR_CANCEL_NETS,
} from '../../../drills/pairCancellation';
import type { PairCancelRound } from '../../../drills/pairCancellation';
import { PlayingCard } from '../../components/PlayingCard';
import { cardJitter, jitterTransform } from '../../../drills/cardJitter';
import { useAudio } from '../../../audio/useAudio';
import { loadStats, saveStats } from '../../../store/persist';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * R8 / TS#6 (docs/BACKLOG.md): the pair-cancellation drill. Two cards are shown
 * at once and the user picks their NET Hi-Lo tag (-2..+2) — training the
 * expert habit of reading a pair as one recognized chunk (a +1 low and a -1
 * high "cancel" to 0 and are skipped) rather than adding each card serially.
 * Deliberately VISUAL-ONLY (no eyes-free): the whole point is gestalt pair
 * recognition, which serial audio would defeat (see the red-team's item 10).
 * Continuous flow like Flashcards — answer, see feedback, Next — for rapid reps.
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
  const [feedback, setFeedback] = useState<{ correct: boolean; guess: number } | null>(null);
  // R1-style latency: prompt-shown → answered, captured in the component (never
  // a pure helper) so telemetry can track chunk-recognition speed over time.
  const shownAtRef = useRef(performance.now());

  const answer = (guess: number) => {
    if (feedback) return; // already answered; wait for Next
    const correct = guess === round.net;
    const elapsedMs = performance.now() - shownAtRef.current;
    setFeedback({ correct, guess });
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
  };

  const next = () => {
    roundIndexRef.current += 1;
    setRound(makePairCancel(randomSeed(), pairCancelBias(roundIndexRef.current)));
    setFeedback(null);
    shownAtRef.current = performance.now();
  };

  // Keyboard: 1–5 map to the five nets in ascending order (1 → −2 … 5 → +2);
  // Enter/Space advances once feedback is showing. Skipped while a native
  // input has focus (none here, but consistent with the other drills).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!feedback) {
        const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
        if (idx >= 0) {
          e.preventDefault();
          answer(PAIR_CANCEL_NETS[idx]);
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, round]);

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Pair Cancellation</div>
      </div>

      <div className="settings-row settings-note-row">
        Read the pair as one chunk — what&apos;s the net count?
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
        {feedback && (
          <>
            <div className={feedback.correct ? 'result-correct' : 'result-wrong'}>
              {feedback.correct ? 'Correct!' : `Wrong — net ${formatSigned(round.net)}`}
            </div>
            <div className="pair-cancel-detail">
              {isCancellingPair(round)
                ? 'These cancel — skip the pair.'
                : `Net ${formatSigned(round.net)}.`}
            </div>
          </>
        )}
      </div>

      {!feedback ? (
        <div className="action-bar pair-cancel-answers">
          {PAIR_CANCEL_NETS.map((net) => (
            <button key={net} type="button" className="action-btn" onClick={() => answer(net)}>
              {formatSigned(net)}
            </button>
          ))}
        </div>
      ) : (
        <div className="action-bar">
          <button type="button" className="drill-next-btn" onClick={next}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
