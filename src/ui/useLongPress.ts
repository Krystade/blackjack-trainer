import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

/** How long a press must be held, and how far it may drift, to count. */
export const LONG_PRESS_MS = 500;
const MAX_DRIFT_PX = 10;

/**
 * #31: pointer handlers that call `onLongPress` once a press has been held
 * for LONG_PRESS_MS without wandering (a drift is a scroll, not a press).
 *
 * Pointer events rather than touch events, so a finger, a stylus and a mouse
 * all work, and a test can drive it. The context menu is refused, because
 * on Android and desktop a long press IS a context-menu gesture; the iOS
 * callout and text selection are switched off in the element's CSS.
 */
export function useLongPress(onLongPress: () => void, ms: number = LONG_PRESS_MS) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancel();
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        origin.current = null;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MAX_DRIFT_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  };
}
