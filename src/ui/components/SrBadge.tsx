import type { SrCard } from '../../drills/spacedRepetition';
import { MAX_BOX } from '../../drills/spacedRepetition';
import './srBadge.css';

/**
 * Owner 2026-11-06: a small spaced-repetition meter on the hand, top left
 * (the rules chip has the top right). Filled dots: how far along the
 * schedule this hand is. "New" before its first answer; amber when due.
 */
export function SrBadge({ card, now }: { card: SrCard | undefined; now: number }) {
  if (!card || card.reviews === 0) {
    return (
      <div className="sr-badge-row">
        <span className="sr-badge sr-badge-new" data-testid="sr-badge" data-state="new" aria-label="New hand">
          New
        </span>
      </div>
    );
  }
  const due = card.dueAt <= now;
  const filled = Math.max(0, Math.min(MAX_BOX, card.box));
  return (
    <div className="sr-badge-row">
      <span
        className={`sr-badge${due ? ' sr-badge-due' : ''}`}
        data-testid="sr-badge"
        data-state={due ? 'due' : 'learning'}
        data-box={filled}
        role="img"
        aria-label={`Spaced repetition: ${filled} of ${MAX_BOX}${due ? ', due' : ''}`}
      >
        {Array.from({ length: MAX_BOX }, (_, i) => (
          <span key={i} className={`sr-dot${i < filled ? ' sr-dot-on' : ''}`} />
        ))}
      </span>
    </div>
  );
}

/** How many of `deck`'s seen cards are due now. */
export function dueCount(deck: Record<string, SrCard>, now: number): number {
  let n = 0;
  for (const c of Object.values(deck)) if (c.reviews > 0 && c.dueAt <= now) n++;
  return n;
}
