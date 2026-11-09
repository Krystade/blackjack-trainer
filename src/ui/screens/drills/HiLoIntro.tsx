import { useState } from 'react';
import { hiLoTag } from '../../../engine/count';
import { HILO_TAP_ALONG, hiLoLabel } from '../../../drills/hiLoAid';
import { signed } from '../../../drills/signed';
import { PlayingCard } from '../../components/PlayingCard';
import { DrillPrimaryBar } from '../../components/DrillPrimaryBar';
import { Term } from '../../glossary';
import './hiLoIntro.css';

const TAGS = [1, 0, -1] as const;

const RULE_ROWS: { cards: string; tag: number }[] = [
  { cards: '2 to 6', tag: 1 },
  { cards: '7 to 9', tag: 0 },
  { cards: '10 to A', tag: -1 },
];

/**
 * T2-2B: "Learn Hi-Lo", in place of the count drill's setup the first time
 * a beginner reaches counting (hiLoIntroDue). The rule, why it works, and a
 * six-card tap-along that ends on a running count of 0 -- then straight into
 * Easy first run, or Skip to the normal setup. Either marks it seen.
 */
export function HiLoIntro({ onStartEasy, onSkip }: { onStartEasy: () => void; onSkip: () => void }) {
  const [at, setAt] = useState(0);
  const [total, setTotal] = useState(0);
  const [last, setLast] = useState<{ right: boolean; tag: number; label: string } | null>(null);
  const done = at >= HILO_TAP_ALONG.length;
  const card = HILO_TAP_ALONG[at];

  const answer = (tag: number) => {
    if (!card) return;
    const actual = hiLoTag(card.rank);
    setLast({ right: tag === actual, tag: actual, label: hiLoLabel(card) });
    setTotal((t) => t + actual);
    setAt((i) => i + 1);
  };

  return (
    <div className="count-setup hilo-intro" data-testid="hilo-intro">
      <section className="hilo-intro-card">
        <h2 className="hilo-intro-title">
          Learn <Term id="hi-lo">Hi-Lo</Term>
        </h2>
        <table className="hilo-intro-rule">
          <tbody>
            {RULE_ROWS.map((r) => (
              <tr key={r.cards}>
                <th scope="row">{r.cards}</th>
                <td>{signed(r.tag)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hilo-intro-why">
          Low cards help the dealer and high cards help you. When more low cards are gone, the cards left
          are rich in 10s and aces: more blackjacks, better doubles, more dealer busts. So you bet more.
        </p>
      </section>

      <section className="hilo-intro-card hilo-tap" aria-label="Try it">
        {!done && card && (
          <>
            <div className="hilo-tap-head">
              Try it: card {at + 1} of {HILO_TAP_ALONG.length}
            </div>
            <div className="hilo-tap-card">
              <PlayingCard card={card} size="compact" />
            </div>
            <div className="hilo-tap-buttons" role="group" aria-label="Hi-Lo value">
              {TAGS.map((t) => (
                <button key={t} type="button" className="hilo-tap-btn" onClick={() => answer(t)}>
                  {signed(t)}
                </button>
              ))}
            </div>
          </>
        )}
        {last && (
          <div className={`hilo-tap-feedback${last.right ? ' is-right' : ' is-wrong'}`} data-testid="hilo-tap-feedback">
            {last.right ? 'Right' : 'Not quite'}: that card is {last.label}.
          </div>
        )}
        <div className="hilo-tap-total" data-testid="hilo-tap-total">
          {done ? (
            <>
              <Term id="rc">Running count</Term>: {signed(total)}. You just counted.
            </>
          ) : (
            <>Running count so far: {signed(total)}</>
          )}
        </div>
      </section>

      <DrillPrimaryBar label="Start easy first run" variant="start" onPrimary={onStartEasy} secondaryLabel="Skip" onSecondary={onSkip} />
    </div>
  );
}
