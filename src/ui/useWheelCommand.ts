import { useEffect, useRef } from 'react';
import { setWheelCommandHandler, type WheelCommand } from '../audio/wheelCommands';

/**
 * Claim the car's steering wheel for this screen while it is mounted.
 *
 * The whole point is stated in audio/wheelCommands.ts: a drill the wheel can
 * advance needs no microphone, and no microphone is the only state in which the
 * wheel reaches the app at all. So every screen that can be answered by voice
 * should also be answerable from the wheel, and this is the one line that does
 * it.
 *
 * The handler is held in a ref for the same reason useVoiceControl holds its
 * own: it closes over drill state that changes every render, and re-registering
 * on every card would be pointless churn on a module-level slot.
 */
export function useWheelCommand(handler: (command: WheelCommand) => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    setWheelCommandHandler((command) => ref.current(command));
    // Release on unmount, so a press never lands on a drill the driver left.
    return () => setWheelCommandHandler(null);
  }, [enabled]);
}
