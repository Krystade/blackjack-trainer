import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import './peekButton.css';
import './peekReadout.css';

interface PeekButtonProps {
  /** Whether the readout is showing. Owned by the caller, which also counts. */
  revealed: boolean;
  /** Called once per press: the moment the readout goes from hidden to shown. */
  onReveal: () => void;
  /** Called when the press ends, however it ends. */
  onHide: () => void;
  /** What a held press shows. */
  readout: ReactNode;
  /** The graded integer TC, carried as a test seam (e2e/tc-rounding.spec.ts):
   * the readout itself shows the exact quotient, not the convention. */
  dataTc?: number;
}

/**
 * #40: the count peek, held rather than toggled, from the thumb's corner.
 *
 * POINTER EVENTS ONLY, never touch + mouse. A phone tap delivers touchstart,
 * touchend and then a synthesized mousedown/mouseup; listening to both counted
 * every press twice, which was the original R7 double-count. One pointerdown
 * per physical press is the whole dedup, and `heldRef` is the rising-edge
 * guard for the keyboard path, where a held key auto-repeats keydown.
 *
 * The pointer is captured on press, so sliding a thumb off the button still
 * ends the peek on release -- and `lostpointercapture` covers the cases where
 * the browser takes the pointer away (a scroll gesture, a system sheet).
 *
 * The width is fixed in peekButton.css: revealing must not move anything on
 * the table, or the act of peeking would shift the very cards being counted.
 * The readout is a positioned sibling (so it moves nothing either), on the
 * side the thumb is not and well clear of it (peekReadout.css).
 */
/**
 * D-extra: ON A SHORT PHONE THE FLOATING READOUT LANDED ON A CARD.
 *
 * Held at 320x568, the readout's place 60px above the button is inside the
 * player's hand, covering part of the first card -- the very information the
 * peek exists not to cover. Nothing on that screen is both info-free and 60px
 * clear of the thumb except the topbar's controls row (Repeat, Voice, End),
 * which a thumb busy holding the peek is not about to press. So when the
 * readout would overlap a card, it is moved up to that row, still at the far
 * gutter from the thumb. Where it
 * fits (375x812 and up) it stays exactly where peekReadout.css puts it.
 */
function keepOffTheCards(el: HTMLElement): void {
  el.style.top = '';
  el.style.bottom = '';
  el.style.left = '';
  el.style.right = '';
  const screen = el.closest('.table-screen');
  const host = el.offsetParent as HTMLElement | null;
  if (!screen || !host) return;
  const r = el.getBoundingClientRect();
  const onCard = [...screen.querySelectorAll('.card')].some((c) => {
    const b = c.getBoundingClientRect();
    return b.width > 0 && r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom;
  });
  if (!onCard) return;
  const row = screen.querySelector(':scope > .topbar .voice-btn') ?? screen.querySelector(':scope > .topbar .end-btn');
  if (!row) return;
  const a = row.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const s = screen.getBoundingClientRect();
  el.style.top = `${Math.round(a.top + (a.height - r.height) / 2 - h.top)}px`;
  el.style.bottom = 'auto';
  // Still on the side away from the thumb, from the same gutter as before,
  // and over WHOLE controls: a half-covered Voice reads as a broken label. A
  // right thumb leaves End showing (Repeat and Voice covered); a left thumb
  // leaves Repeat showing.
  const gutter = 16;
  const bar = screen.querySelector(':scope > .topbar');
  const left = el.closest('.peek-dock')?.getAttribute('data-hand') === 'left';
  const keep = bar?.querySelector(left ? '.repeat-btn' : '.end-btn')?.getBoundingClientRect();
  if (left) {
    el.style.left = keep ? `${Math.round(keep.right + 8 - h.left)}px` : 'auto';
    el.style.right = `${Math.round(h.right - (s.right - gutter))}px`;
  } else {
    el.style.left = `${Math.round(s.left + gutter - h.left)}px`;
    el.style.right = keep ? `${Math.round(h.right - (keep.left - 8))}px` : 'auto';
  }
}

export function PeekButton({ revealed, onReveal, onHide, readout, dataTc }: PeekButtonProps) {
  const heldRef = useRef(false);
  const readoutRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (revealed && readoutRef.current) keepOffTheCards(readoutRef.current);
  }, [revealed]);

  const press = () => {
    if (heldRef.current) return;
    heldRef.current = true;
    onReveal();
  };
  const release = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    onHide();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    // Primary button only: a right-click is not a press.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; release still ends the peek */
    }
    press();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    // Space would otherwise fire a click on keyup and Enter one on keydown;
    // neither means anything here, and Space scrolls the page.
    e.preventDefault();
    press();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    release();
  };

  return (
    <>
    <button
      type="button"
      className="tc-peek-btn peek-hold-btn"
      aria-pressed={revealed}
      data-tc={revealed ? dataTc : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={release}
      // A long press on iOS opens the callout / text selection; this is a
      // hold control, so the press itself is the whole gesture.
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="peek-label">{revealed ? 'Peeking' : 'Hold to peek'}</span>
    </button>
    {/* Wave X (item 3): "If I'm holding it I'm covering the info." The
        readout is away from the holding thumb (peekReadout.css), never on
        or beside the button itself. */}
    {revealed && (
      <div ref={readoutRef} className="peek-readout" role="status" data-testid="peek-readout">
        {readout}
      </div>
    )}
    </>
  );
}
