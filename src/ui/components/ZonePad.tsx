import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { hitTestZone, ZONE_LABEL } from '../../audio/zones';
import type { ZoneId, ZoneMode } from '../../audio/zones';

export interface ZonePadProps {
  mode: ZoneMode;
  onAnswer: (zone: ZoneId | 'take' | 'decline') => void;
  onRepeat: () => void; // fired by a long-press (>=600ms) anywhere
  // true (default) => zones are shown with labels, learnable before use.
  // false => transparent but still tappable, for genuine eyes-free driving
  // ("Dim screen" opt-in).
  visible: boolean;
}

const LONG_PRESS_MS = 600;

const INSURANCE_LABEL: Record<'take' | 'decline', string> = {
  take: 'Take',
  decline: 'Decline',
};

/**
 * Full-screen five-zone blind-tap overlay. Every zone decision is delegated
 * to `hitTestZone` (src/audio/zones.ts) — this component contains no
 * geometry of its own, only pointer-event plumbing and long-press timing.
 */
export function ZonePad({ mode, onAnswer, onRepeat, visible }: ZonePadProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const clearLongPressTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Clean up any pending long-press timer on unmount.
  useEffect(() => clearLongPressTimer, []);

  const handlePointerDown = (_e: ReactPointerEvent<HTMLDivElement>) => {
    longPressFiredRef.current = false;
    clearLongPressTimer();
    timerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      timerRef.current = null;
      onRepeat();
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wasLongPress = longPressFiredRef.current;
    clearLongPressTimer();
    longPressFiredRef.current = false;
    // A long press already fired onRepeat; the release must NOT also answer.
    if (wasLongPress) return;

    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const zone = hitTestZone(x, y, rect.width, rect.height, mode);
    onAnswer(zone);
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
    longPressFiredRef.current = false;
  };

  return (
    <div
      ref={rootRef}
      className={`zone-pad${visible ? '' : ' zone-pad-hidden'}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {mode === 'insurance' ? (
        <div className="zone-pad-halves">
          <div className="zone-pad-half zone-pad-take">{INSURANCE_LABEL.take}</div>
          <div className="zone-pad-half zone-pad-decline">{INSURANCE_LABEL.decline}</div>
        </div>
      ) : (
        <>
          <div className="zone-pad-quadrants">
            <div className="zone-pad-quad zone-pad-quad-hit">{ZONE_LABEL.hit}</div>
            <div className="zone-pad-quad zone-pad-quad-stand">{ZONE_LABEL.stand}</div>
            <div className="zone-pad-quad zone-pad-quad-double">{ZONE_LABEL.double}</div>
            <div className="zone-pad-quad zone-pad-quad-split">{ZONE_LABEL.split}</div>
          </div>
          <div className="zone-pad-circle">{ZONE_LABEL.surrender}</div>
        </>
      )}
    </div>
  );
}
