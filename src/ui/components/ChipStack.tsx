import { chipBreakdown, type ChipDenom } from '../chips';
import './chips.css';

/** What a chip's face says: "1k", "100", "2½", "½". */
export function chipFaceLabel(d: ChipDenom): string {
  if (d === 1000) return '1k';
  if (d === 2.5) return '2½';
  if (d === 0.5) return '½';
  return String(d);
}

/**
 * Track 3: `amount` dollars as a dealer would pay it -- one chip per
 * denomination, seen from above with its value on the face, highest on the
 * left, and "×3" on a chip that stands for a stack of three (ui/chips.ts
 * chipBreakdown). A picture of a figure always printed beside it, so hidden
 * from screen readers (and from the accessible name of a button it sits in).
 */
export function ChipStack({ amount, size = 'md' }: { amount: number; size?: 'sm' | 'md' }) {
  const cols = chipBreakdown(amount);
  if (cols.length === 0) return null;
  return (
    <span className={`chip-stack${size === 'sm' ? ' chip-stack-sm' : ''}`} aria-hidden="true" data-dollars={amount}>
      {cols.map(({ denom, count }) => (
        <span key={denom} className="chip-col" data-chip={String(denom)} data-count={count}>
          <span className="chip-face">{chipFaceLabel(denom)}</span>
          {count > 1 && <span className="chip-more">×{count}</span>}
        </span>
      ))}
    </span>
  );
}
