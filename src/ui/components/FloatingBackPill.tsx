import './floatingBackPill.css';

/**
 * #2: a Back control that never scrolls away.
 *
 * The study chart overlay is three tall grids, and its Back lived in the
 * header -- so the moment the overlay scrolled to the ringed cell (often in
 * PAIRS, at the bottom) the only way back to the hand was to scroll all the
 * way up again. Pinned bottom-centre instead, in thumb reach, and named after
 * where it goes rather than "Back".
 *
 * Fixed to the viewport, so it stays put however far the overlay scrolls; the
 * overlay pads its own bottom (floatingBackPill.css) so the last rows can be
 * scrolled clear of it.
 */
export function FloatingBackPill({
  label,
  onClick,
  forward = false,
}: {
  label: string;
  onClick: () => void;
  /** #55: a forward action (the intro's "Start quiz") points forward, after its label. */
  forward?: boolean;
}) {
  const arrow = (
    <span className="floating-back-pill-arrow" aria-hidden="true">
      {forward ? '→' : '←'}
    </span>
  );
  return (
    <button type="button" className="floating-back-pill" onClick={onClick}>
      {!forward && arrow}
      {label}
      {forward && arrow}
    </button>
  );
}
