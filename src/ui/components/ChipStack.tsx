import { chipBreakdown } from '../chips';
import './chips.css';

/** The most chips drawn in one column; the rest are counted ("×7"). */
const MAX_DRAWN = 5;

/**
 * Track 3: `amount` dollars as a dealer would stack them -- a column per
 * denomination, highest on the left (ui/chips.ts chipBreakdown). A picture of
 * a figure always printed beside it, so hidden from screen readers (and from
 * the accessible name of a button it sits in).
 */
export function ChipStack({ amount, size = 'md' }: { amount: number; size?: 'sm' | 'md' }) {
  const cols = chipBreakdown(amount);
  if (cols.length === 0) return null;
  return (
    <span
      className={`chip-stack${size === 'sm' ? ' chip-stack-sm' : ''}`}
      aria-hidden="true"
      data-dollars={amount}
    >
      {cols.map(({ denom, count }) => (
        <span key={denom} className="chip-col" data-chip={String(denom)} data-count={count}>
          {Array.from({ length: Math.min(count, MAX_DRAWN) - 1 }, (_, i) => (
            <span key={i} className="chip-edge" />
          ))}
          <span className="chip-face" />
          {count > MAX_DRAWN && <span className="chip-more">×{count}</span>}
        </span>
      ))}
    </span>
  );
}
