import type { Card } from '../../../engine/cards';
import { countRunRows, type CountRunCheckpoint } from '../../../drills/countRun';
import { signed } from '../../../drills/signed';
import { formatCard } from '../../components/PlayingCard';
import './countRun.css';

/**
 * Wave E E5 (W2-8): "Show the run" on the count drill's result.
 *
 * Closed by default, so New run stays where it always is; open, it lists every
 * dealt card (or group, or table round) with its Hi-Lo tag and the running
 * count after it, and marks each checkpoint with what was said against the
 * count at that point. Screen only: eyes-free narration is unchanged.
 */
export function CountRunList({
  groups,
  checkpoints,
  hidden,
}: {
  groups: readonly (readonly Card[])[];
  checkpoints?: readonly CountRunCheckpoint[];
  /** Countdown's undealt card, listed last. */
  hidden?: Card;
}) {
  if (groups.length === 0) return null;
  const rows = countRunRows(groups, checkpoints, hidden);
  const cards = groups.reduce((n, g) => n + g.length, 0) + (hidden ? 1 : 0);
  const grouped = groups.some((g) => g.length > 1);
  return (
    <details className="count-run" data-testid="count-run">
      <summary>
        Show the run <span className="count-run-size">({cards} cards)</span>
      </summary>
      <div className="count-run-head" aria-hidden="true">
        <span>#</span>
        <span>{grouped ? 'Cards' : 'Card'}</span>
        <span>Tag</span>
        <span>Count</span>
      </div>
      <ol className="count-run-list">
        {rows.map((r) => (
          <li
            key={r.n}
            className={`count-run-row${r.hidden ? ' count-run-hidden' : ''}${r.checkpoint ? ' count-run-has-cp' : ''}`}
            data-row={r.n}
          >
            <span className="count-run-n">{r.n}</span>
            <span className="count-run-cards">
              {r.hidden && <span className="count-run-hidden-label">Hidden </span>}
              {r.cards.map(formatCard).join(' ')}
            </span>
            <span className="count-run-tag">{signed(r.tag)}</span>
            <span className="count-run-total">{signed(r.total)}</span>
            {r.checkpoint && (
              <span
                className={`count-run-cp ${r.checkpoint.right ? 'checkpoint-hit' : 'checkpoint-miss'}`}
                data-said={r.checkpoint.said}
                data-was={r.checkpoint.was}
              >
                Checkpoint: you said {signed(r.checkpoint.said)}, the count was {signed(r.checkpoint.was)}.
              </span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
