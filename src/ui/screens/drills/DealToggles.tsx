import type { Settings } from '../../../store/types';
import { saveSettings } from '../../../store/persist';
import './handDeckControls.css';
import './dealToggles.css';

/**
 * #27 / #53: what the deal adds on top of the deck, under the scope row.
 *
 * - Fallbacks: about 15% of double / surrender cells are dealt so the double
 *   or surrender is gone (drills/fallbackHand.ts).
 * - With count (flashcards only): each card shows a true count and is graded
 *   at it (drills/withCount.ts).
 *
 * Saved like the scope row: persisted here, then handed to the drill so the
 * next hand is drawn with it.
 */
export function DealToggles({
  settings,
  onChange,
  withCount = false,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  /** Offer the "With count" toggle (flashcards). */
  withCount?: boolean;
}) {
  const set = (patch: Partial<Settings['drill']>) => {
    const next = { ...settings, drill: { ...settings.drill, ...patch } };
    saveSettings(next);
    onChange(next);
  };
  const chip = (label: string, on: boolean, toggle: () => void) => (
    <button
      type="button"
      className={`scope-chip deal-toggle${on ? ' scope-chip-on' : ''}`}
      aria-pressed={on}
      onClick={toggle}
    >
      {label}
    </button>
  );
  const fallbacks = settings.drill.fallbacks === true;
  const count = settings.drill.withCount === true;
  return (
    <div className="deal-toggles" role="group" aria-label="Deal">
      {chip('Fallbacks', fallbacks, () => set({ fallbacks: !fallbacks }))}
      {withCount && chip('With count', count, () => set({ withCount: !count }))}
    </div>
  );
}
