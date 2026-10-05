/**
 * The one primary action of a drill screen: Start on a setup screen, Next /
 * New run on a result. Full width, 56px, gold, pinned to the bottom of the
 * screen (sticky, so it also stays put when the content above it is taller
 * than the phone). One component so every drill reads the same and the
 * operator, who is often not looking, always finds it in the same place.
 *
 * `variant` keeps the historical class on the button (drill-start-btn,
 * drill-replay-btn, drill-next-btn) because specs and styles still key on it.
 * The optional secondary is a quiet text button, deliberately not a second
 * full-weight button: a result screen has exactly one obvious primary.
 */
export function DrillPrimaryBar({
  label,
  onPrimary,
  variant = 'replay',
  secondaryLabel,
  onSecondary,
}: {
  label: string;
  onPrimary: () => void;
  variant?: 'start' | 'replay' | 'next';
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="drill-primary-bar">
      <button
        type="button"
        className={`drill-primary-btn drill-${variant}-btn`}
        onClick={onPrimary}
      >
        {label}
      </button>
      {secondaryLabel && onSecondary && (
        <button type="button" className="drill-secondary-btn" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
