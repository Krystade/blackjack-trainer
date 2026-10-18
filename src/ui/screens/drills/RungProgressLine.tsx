import type { Profile } from '../../../store/types';
import { loadStats } from '../../../store/persist';
import type { RungId } from '../nextStep';
import { rungProgressLine } from './rungProgress';
import './rungProgress.css';

/**
 * L-3: the Home-ladder rung a drill feeds, on its result screen -- the same
 * kind of one-line progress Flashcards shows (B7). Read at render, after the
 * answer has been saved; nothing for a drill that feeds no rung.
 */
export function RungProgressLine({ rung, profile }: { rung: RungId | null; profile?: Profile }) {
  if (!rung) return null;
  const text = rungProgressLine(loadStats(), rung, profile);
  if (!text) return null;
  return (
    <div className="rung-progress" data-testid="rung-progress" data-rung={rung}>
      {text}
    </div>
  );
}
